#!/usr/bin/env node
import {
  DB_PATH,
  ensureSqliteNode,
  fail
} from './lib.mjs';
import {
  embedTexts,
  searchVectors,
  hasVectorConfig,
  vectorBackend,
  embeddingModel,
  filtersForBackend
} from './vector-lib.mjs';

ensureSqliteNode();
let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch (error) {
  fail(`无法加载 node:sqlite：${error.message}`);
}

const USAGE =
  '用法: node bin/search.mjs <关键词...> [--area X] [--project X] [--status X] [--platform X] [--tag X] [--limit N] [--any] [--json] [--text-only]';

const opts = parseArgs(process.argv.slice(2));
if (opts.terms.length === 0) fail(USAGE);

let rows = [];
let localIndexNotice = null;
try {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  rows = db.prepare('SELECT * FROM cases').all();
  db.close();
} catch (error) {
  localIndexNotice = `本地索引不可用（${error.message}）；本次仅使用远程向量结果`;
}

const rowById = new Map(rows.map((row) => [row.id, row]));
const filteredRows = rows.filter((row) => {
  if (opts.area && row.area !== opts.area) return false;
  if (opts.project && row.project !== opts.project) return false;
  if (opts.status && row.status !== opts.status) return false;
  if (opts.platform && row.platform !== opts.platform) return false;
  if (opts.tag && !safeArray(row.tags).includes(opts.tag)) return false;
  return true;
});

const textHits = [];
for (const row of filteredRows) {
  const title = String(row.title || '');
  const tags = safeArray(row.tags).join(' ');
  const signature = `${row.symptom || ''} ${safeArray(row.error_signatures).join(' ')}`;
  const content = String(row.content || '');
  let textScore = 0;
  let matched = 0;
  for (const term of opts.terms) {
    const n =
      countOccurrences(title, term) * 5 +
      countOccurrences(tags, term) * 3 +
      countOccurrences(signature, term) * 3 +
      countOccurrences(content, term);
    if (n > 0) {
      matched += 1;
      textScore += n;
    }
  }
  const ok = opts.any ? matched > 0 : matched === opts.terms.length;
  if (!ok) continue;
  textHits.push({
    id: row.id,
    textScore,
    rank: textHits.length + 1,
    row
  });
}
textHits.sort((a, b) => b.textScore - a.textScore || String(b.row.date).localeCompare(String(a.row.date)));
textHits.forEach((hit, index) => {
  hit.rank = index + 1;
});

let vectorHits = [];
let notice = null;
if (!opts.textOnly && hasVectorConfig()) {
  try {
    const queryEmbedding = (await embedTexts([opts.terms.join(' ')])).at(0);
    vectorHits = await searchVectors(queryEmbedding, filtersForBackend(opts), Math.max(10, opts.limit * 5));
    vectorHits.forEach((hit, index) => {
      hit.rank = index + 1;
    });
  } catch (error) {
    notice = error.message;
  }
} else if (!opts.textOnly) {
  notice = localIndexNotice || `未配置 ${vectorBackend()} 连接或 embedding key，本次仅文本检索`;
}

const merged = new Map();
for (const hit of textHits) {
  merged.set(hit.id, {
    id: hit.id,
    row: hit.row,
    textScore: hit.textScore,
    textRank: hit.rank,
    vectorScore: 0,
    vectorRank: null
  });
}
for (const hit of vectorHits) {
  const existing = merged.get(hit.id);
  if (existing) {
    existing.vectorScore = Number(hit.score || 0);
    existing.vectorRank = hit.rank;
  } else {
    const row = rowById.get(hit.id) || rowFromPayload(hit.payload);
    if (!row) continue;
    merged.set(hit.id, {
      id: hit.id,
      row,
      textScore: 0,
      textRank: null,
      vectorScore: Number(hit.score || 0),
      vectorRank: hit.rank
    });
  }
}

const candidates = [...merged.values()].map((item) => {
  const rrf =
    (item.textRank === null ? 0 : 1 / (60 + item.textRank)) +
    (item.vectorRank === null ? 0 : 1 / (60 + item.vectorRank));
  item.score = rrf;
  item.snippet = snippetFor(item.row, opts.terms);
  return item;
});

candidates.sort(
  (a, b) =>
    b.score - a.score ||
    b.textScore - a.textScore ||
    b.vectorScore - a.vectorScore ||
    String(b.row.date).localeCompare(String(a.row.date))
);
const limited = candidates.slice(0, opts.limit).filter((item) => item.score > 0);
const mode = vectorHits.length
  ? (textHits.length ? 'hybrid-rrf' : 'vector-rrf')
  : 'text';

if (opts.textOnly && localIndexNotice) {
  notice = localIndexNotice;
}

if (opts.json) {
  console.log(
    JSON.stringify(
      {
        query: opts.terms,
        filters: {
          area: opts.area,
          project: opts.project,
          status: opts.status,
          platform: opts.platform,
          tag: opts.tag
        },
        mode,
        backend: hasVectorConfig() ? vectorBackend() : null,
        vector_model: hasVectorConfig() ? embeddingModel() : null,
        notice,
        count: limited.length,
        total: candidates.length,
        hits: limited.map((hit) => ({
          id: hit.id,
          date: hit.row.date,
          area: hit.row.area,
          project: hit.row.project,
          platform: hit.row.platform,
          status: hit.row.status,
          title: hit.row.title,
          fix: hit.row.fix || '',
          path: hit.row.path,
          rrf_score: Number(hit.score.toFixed(6)),
          text_score: hit.textScore,
          text_rank: hit.textRank,
          vector_score: hit.vectorRank === null ? null : Number(hit.vectorScore.toFixed(4)),
          vector_rank: hit.vectorRank,
          snippet: hit.snippet
        }))
      },
      null,
      2
    )
  );
} else if (limited.length === 0) {
  console.log('no hits');
} else {
  console.log(`${limited.length}/${candidates.length} hit(s) · ${opts.terms.join(' ')} · ${mode}`);
  limited.forEach((hit, index) => {
    const meta = [hit.row.date, hit.row.status, hit.row.project].filter(Boolean).join(', ');
    const vectorPart = hit.vectorRank === null ? '' : ` vec=${hit.vectorScore.toFixed(3)}(${hit.vectorRank})`;
    const textPart = hit.textRank === null ? ' vec-only' : ` text=${hit.textScore}(${hit.textRank})`;
    console.log(`\n${index + 1}. [${hit.row.area}] ${hit.row.title}  (${meta})`);
    console.log(`   ${hit.row.path}  rrf=${hit.score.toFixed(4)}${textPart}${vectorPart}`);
    if (hit.row.fix) console.log(`   修复: ${hit.row.fix}`);
    if (hit.snippet) console.log(`   ${hit.snippet}`);
  });
  if (notice) console.log(`\nnotice: ${notice}`);
}

function parseArgs(argv) {
  const parsed = {
    terms: [],
    area: null,
    project: null,
    status: null,
    platform: null,
    tag: null,
    limit: 10,
    json: false,
    any: false,
    textOnly: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) fail(`${arg} 需要值`);
      i += 1;
      return value;
    };
    if (arg === '--area') parsed.area = next();
    else if (arg === '--project') parsed.project = next();
    else if (arg === '--status') parsed.status = next();
    else if (arg === '--platform') parsed.platform = next();
    else if (arg === '--tag') parsed.tag = next();
    else if (arg === '--limit') parsed.limit = Number(next());
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--any') parsed.any = true;
    else if (arg === '--text-only') parsed.textOnly = true;
    else if (arg.startsWith('--')) fail(`未知参数 ${arg}\n${USAGE}`);
    else parsed.terms.push(arg);
  }
  if (!Number.isInteger(parsed.limit) || parsed.limit < 1) fail('--limit 必须是正整数');
  return parsed;
}

function safeArray(value) {
  try {
    const parsed = JSON.parse(value ?? '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function countOccurrences(haystack, needle) {
  const h = String(haystack || '').toLowerCase();
  const n = String(needle || '').toLowerCase();
  if (!n) return 0;
  let count = 0;
  let idx = 0;
  for (;;) {
    idx = h.indexOf(n, idx);
    if (idx === -1) return count;
    count += 1;
    idx += n.length;
  }
}

function snippetFor(row, terms) {
  const sources = [row.symptom, row.content, row.title];
  for (const source of sources) {
    const text = String(source || '');
    if (!text) continue;
    const lower = text.toLowerCase();
    for (const term of terms) {
      const idx = lower.indexOf(String(term).toLowerCase());
      if (idx === -1) continue;
      const start = Math.max(0, idx - 40);
      const end = Math.min(text.length, idx + String(term).length + 60);
      const head = start > 0 ? '…' : '';
      const tail = end < text.length ? '…' : '';
      return `${head}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${tail}`;
    }
  }
  return '';
}

function rowFromPayload(payload = {}) {
  return {
    id: payload.case_id || payload.id || '',
    date: payload.date || '',
    area: payload.area || 'other',
    project: payload.project || '',
    platform: payload.platform || '',
    status: payload.status || '',
    title: payload.title || '',
    symptom: payload.symptom || '',
    fix: payload.fix || '',
    error_signatures: Array.isArray(payload.error_signatures) ? payload.error_signatures : [],
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    path: payload.path || '',
    content: ''
  };
}

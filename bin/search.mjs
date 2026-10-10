#!/usr/bin/env node
import { DB_PATH, ensureSqliteNode, fail } from './lib.mjs';

ensureSqliteNode();
let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch (error) {
  fail(`无法加载 node:sqlite：${error.message}`);
}

const USAGE =
  '用法: node bin/search.mjs <关键词...> [--area X] [--project X] [--status X] [--platform X] [--tag X] [--limit N] [--any] [--json]';

const opts = parseArgs(process.argv.slice(2));
if (opts.terms.length === 0) fail(USAGE);

let rows;
try {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  rows = db.prepare('SELECT * FROM cases').all();
  db.close();
} catch (error) {
  fail(`无法读取索引（先运行 node bin/reindex.mjs）：${error.message}`);
}

const filtered = rows.filter((row) => {
  if (opts.area && row.area !== opts.area) return false;
  if (opts.project && row.project !== opts.project) return false;
  if (opts.status && row.status !== opts.status) return false;
  if (opts.platform && row.platform !== opts.platform) return false;
  if (opts.tag && !safeArray(row.tags).includes(opts.tag)) return false;
  return true;
});

const hits = [];
for (const row of filtered) {
  const title = String(row.title || '');
  const tags = safeArray(row.tags).join(' ');
  const signature = `${row.symptom || ''} ${safeArray(row.error_signatures).join(' ')}`;
  const content = String(row.content || '');
  let score = 0;
  let matched = 0;
  for (const term of opts.terms) {
    const n =
      countOccurrences(title, term) * 5 +
      countOccurrences(tags, term) * 3 +
      countOccurrences(signature, term) * 3 +
      countOccurrences(content, term);
    if (n > 0) {
      matched += 1;
      score += n;
    }
  }
  const ok = opts.any ? matched > 0 : matched === opts.terms.length;
  if (!ok) continue;
  hits.push({
    id: row.id,
    date: row.date,
    area: row.area,
    project: row.project,
    platform: row.platform,
    status: row.status,
    title: row.title,
    fix: row.fix || '',
    path: row.path,
    score,
    snippet: snippetFor(row, opts.terms)
  });
}
hits.sort((a, b) => b.score - a.score || String(b.date).localeCompare(String(a.date)));
const limited = hits.slice(0, opts.limit);

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
        count: limited.length,
        total: hits.length,
        hits: limited
      },
      null,
      2
    )
  );
} else if (limited.length === 0) {
  console.log('no hits');
} else {
  console.log(`${limited.length}/${hits.length} hit(s) · ${opts.terms.join(' ')}`);
  limited.forEach((h, i) => {
    const meta = [h.date, h.status, h.project].filter(Boolean).join(', ');
    console.log(`\n${i + 1}. [${h.area}] ${h.title}  (${meta})`);
    console.log(`   ${h.path}  score=${h.score}`);
    if (h.fix) console.log(`   修复: ${h.fix}`);
    if (h.snippet) console.log(`   ${h.snippet}`);
  });
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
    any: false
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

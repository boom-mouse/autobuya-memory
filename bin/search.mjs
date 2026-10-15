#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DB_PATH, ROOT, ensureSqliteNode, fail, walkCases } from './lib.mjs';

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

function indexNeedsRebuild() {
  if (!fs.existsSync(DB_PATH)) return true;
  let indexMtime;
  try {
    indexMtime = fs.statSync(DB_PATH).mtimeMs;
  } catch {
    return true;
  }
  let newestCaseMtime = 0;
  for (const file of walkCases()) {
    newestCaseMtime = Math.max(newestCaseMtime, fs.statSync(file).mtimeMs);
  }
  return newestCaseMtime > indexMtime;
}

function rebuildIndex() {
  console.error('info: index 缺失、过期或 schema 过旧，先自动重建索引');
  const result = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'reindex.mjs')], {
    stdio: ['ignore', 'ignore', 'inherit']
  });
  if (result.status !== 0) fail('索引重建失败，无法检索');
}

function schemaOk(db) {
  const row = db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('cases') WHERE name = 'search_text'").get();
  return Number(row?.n ?? 0) === 1;
}

function openIndex() {
  if (indexNeedsRebuild()) rebuildIndex();
  let db;
  try {
    db = new DatabaseSync(DB_PATH, { readOnly: true });
  } catch (error) {
    fail(`无法读取索引（先运行 node bin/reindex.mjs）：${error.message}`);
  }
  if (!schemaOk(db)) {
    db.close();
    rebuildIndex();
    db = new DatabaseSync(DB_PATH, { readOnly: true });
  }
  if (!schemaOk(db)) fail('索引 schema 异常，无法检索');
  return db;
}

const db = openIndex();
const where = [];
const params = [];
let nextIndex = 0;

if (opts.area) {
  where.push(`area = ?${++nextIndex}`);
  params.push(opts.area);
}
if (opts.project) {
  where.push(`project = ?${++nextIndex}`);
  params.push(opts.project);
}
if (opts.status) {
  where.push(`status = ?${++nextIndex}`);
  params.push(opts.status);
}
if (opts.platform) {
  where.push(`platform = ?${++nextIndex}`);
  params.push(opts.platform);
}
if (opts.tag) {
  where.push(`instr(tags, ?${++nextIndex}) > 0`);
  params.push(JSON.stringify(opts.tag));
}

const termChecks = [];
const normalizedTerms = [];
for (const term of opts.terms) {
  const normalized = String(term).toLowerCase();
  if (!normalized) continue;
  normalizedTerms.push(normalized);
  const termIndex = ++nextIndex;
  params.push(normalized);
  termChecks.push(`instr(search_text, ?${termIndex}) > 0`);
}
if (termChecks.length > 0) {
  where.push(`(${termChecks.join(opts.any ? ' OR ' : ' AND ')})`);
}
const whereParams = params.slice();
const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

const scoreParts = [];
for (const normalized of normalizedTerms) {
  const instrIndex = ++nextIndex;
  const replaceIndex = ++nextIndex;
  const lengthIndex = ++nextIndex;
  params.push(normalized, normalized, normalized);
  scoreParts.push(
    `(CASE WHEN instr(search_text, ?${instrIndex}) > 0 ` +
      `THEN (length(search_text) - length(replace(search_text, ?${replaceIndex}, ''))) / length(?${lengthIndex}) ` +
      'ELSE 0 END)'
  );
}

const total = Number(
  db.prepare(`SELECT COUNT(*) AS total FROM cases ${whereSql}`).get(...whereParams)?.total ?? 0
);
const limitIndex = ++nextIndex;
params.push(opts.limit);
const scoreSql = scoreParts.length > 0 ? scoreParts.join(' + ') : '0';
const limited = db
  .prepare(
    `SELECT id, date, area, project, platform, status, title, symptom, fix, path, content, ${scoreSql} AS score ` +
      `FROM cases ${whereSql} ORDER BY score DESC, date DESC, id LIMIT ?${limitIndex}`
  )
  .all(...params);
db.close();

const hits = limited.map((row) => ({
  id: String(row.id),
  date: String(row.date),
  area: String(row.area),
  project: String(row.project),
  platform: String(row.platform),
  status: String(row.status),
  title: String(row.title),
  fix: String(row.fix || ''),
  path: String(row.path),
  score: Number(row.score),
  snippet: snippetFor(row, opts.terms)
}));

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
        count: hits.length,
        total,
        hits: limited
      },
      null,
      2
    )
  );
} else if (limited.length === 0) {
  console.log('no hits');
} else {
  console.log(`${hits.length}/${total} hit(s) · ${opts.terms.join(' ')}`);
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
  const sources = [row.title, row.symptom, row.content];
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

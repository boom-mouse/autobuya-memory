#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ROOT,
  loadCases,
  vectorTextForCase,
  fail
} from './lib.mjs';
import {
  embedTexts,
  buildVectorRecord,
  ensureVectorStore,
  upsertVectors,
  vectorBackend,
  embeddingModel,
  hasVectorConfig
} from './vector-lib.mjs';

const USAGE =
  '用法: node bin/sync-vectors.mjs [--backend qdrant|pgvector] [--all] [--file <case path> ...] [--since <commit>] [--dry-run]';

const opts = parseArgs(process.argv.slice(2));
if (opts.backend) {
  if (!['qdrant', 'pgvector'].includes(opts.backend)) fail('--backend 只能是 qdrant 或 pgvector');
  process.env.VECTOR_BACKEND = opts.backend;
}

if (!hasVectorConfig()) {
  fail(`未配置向量服务：backend=${vectorBackend()}，需要 QDRANT_URL 或 PG 连接（DATABASE_URL/PGHOST/PGDATABASE）`);
}

const allCases = loadCases();
const files = opts.files.map((p) => path.resolve(ROOT, p));
const fileSet = new Set(files);
let cases = allCases;
if (fileSet.size) {
  cases = cases.filter((c) => fileSet.has(path.resolve(ROOT, c.path)));
} else if (opts.since) {
  const changed = changedSince(opts.since);
  if (changed) {
    const changedSet = new Set(changed);
    cases = cases.filter((c) => changedSet.has(path.resolve(ROOT, c.path)));
  }
}

if (!opts.all && fileSet.size === 0 && !opts.since) {
  console.log('sync requires --all, --file, or --since; no full sync without explicit intent');
  process.exit(0);
}

if (opts.dryRun) {
  console.log(JSON.stringify({
    backend: vectorBackend(),
    model: embeddingModel(),
    cases: cases.length,
    files: opts.files,
    since: opts.since,
    action: 'embed-and-upsert'
  }, null, 2));
  process.exit(0);
}

if (cases.length === 0) {
  console.log('no cases to sync');
  process.exit(0);
}

const texts = cases.map((c) => vectorTextForCase(c));
console.log(`embedding ${cases.length} case(s) with ${embeddingModel()} -> ${vectorBackend()}`);
const embeddings = await embedTexts(texts);
const records = cases.map((c, index) => buildVectorRecord(c, embeddings[index]));

await ensureVectorStore(records);
await upsertVectors(records, { deleteStale: opts.all });
console.log(`synced ${records.length} vector(s) -> ${vectorBackend()} (${embeddingModel()})`);

function changedSince(commit) {
  const result = spawnSync('git', ['diff', '--name-only', `${commit}...HEAD`, '--', 'cases'], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  if (result.status !== 0) return null;
  return result.stdout.split('\n').filter(Boolean).map((p) => path.resolve(ROOT, p));
}

function parseArgs(argv) {
  const parsed = {
    backend: null,
    files: [],
    all: false,
    since: null,
    dryRun: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) fail(`${arg} 需要值`);
      i += 1;
      return value;
    };
    if (arg === '--backend') parsed.backend = next();
    else if (arg === '--all') parsed.all = true;
    else if (arg === '--file') parsed.files.push(next());
    else if (arg === '--since') parsed.since = next();
    else if (arg === '--dry-run') parsed.dryRun = true;
    else fail(`未知参数 ${arg}\n${USAGE}`);
  }
  return parsed;
}

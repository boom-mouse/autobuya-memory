#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { DB_PATH, INDEX_DIR, ensureSqliteNode, fail, loadCases } from './lib.mjs';

ensureSqliteNode();
let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch (error) {
  fail(`无法加载 node:sqlite：${error.message}`);
}

const cases = loadCases();

const seen = new Set();
for (const c of cases) {
  if (seen.has(c.id)) fail(`duplicate case id: ${c.id}`);
  seen.add(c.id);
  if (!/^\d{4}-\d{2}-\d{2}-.+\.md$/.test(`${c.id}.md`)) {
    console.warn(`warn: ${c.path} 文件名应为 YYYY-MM-DD-slug.md`);
  }
}

fs.mkdirSync(INDEX_DIR, { recursive: true });
const tmpPath = `${DB_PATH}.tmp-${process.pid}`;
fs.rmSync(tmpPath, { force: true });

const db = new DatabaseSync(tmpPath);
db.exec(`
  CREATE TABLE cases (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    area TEXT NOT NULL,
    project TEXT NOT NULL DEFAULT '',
    platform TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    title TEXT NOT NULL,
    symptom TEXT NOT NULL DEFAULT '',
    error_signatures TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    path TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT ''
  );
`);

const insert = db.prepare('INSERT INTO cases VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
for (const c of cases) {
  insert.run(
    c.id,
    c.date,
    c.area,
    c.project,
    c.platform,
    c.status,
    c.title,
    c.symptom,
    JSON.stringify(c.error_signatures),
    JSON.stringify(c.tags),
    c.path,
    c.content
  );
}
db.close();

fs.rmSync(DB_PATH, { force: true });
fs.renameSync(tmpPath, DB_PATH);
console.log(`indexed ${cases.length} case(s) -> ${path.relative(process.cwd(), DB_PATH) || DB_PATH}`);

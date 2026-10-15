#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CASES_DIR, ROOT, fail } from './lib.mjs';

const USAGE =
  '用法: node bin/new-case.mjs --title "一句话标题" --area <area> [--text|--file|--stdin] [--slug x] [--project x] [--platform x] [--status x] [--commit]';

const args = process.argv.slice(2);
let title = '';
let area = '';
let slug = '';
let project = '';
let platform = '';
let status = 'open';
let rawText = '';
let rawFile = '';
let useStdin = false;
let commit = false;
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  const next = () => {
    const value = args[i + 1];
    if (value === undefined) fail(`${arg} 需要值`);
    i += 1;
    return value;
  };
  if (arg === '--title') title = next();
  else if (arg === '--area') area = next();
  else if (arg === '--slug') slug = next();
  else if (arg === '--project') project = next();
  else if (arg === '--platform') platform = next();
  else if (arg === '--status') status = next();
  else if (arg === '--text') rawText = next();
  else if (arg === '--file') rawFile = next();
  else if (arg === '--stdin') useStdin = true;
  else if (arg === '--commit') commit = true;
  else fail(`未知参数 ${arg}\n${USAGE}`);
}
if (!title) fail(`--title 必填\n${USAGE}`);
if (!area) fail(`--area 必填\n${USAGE}`);

if (rawFile) {
  try {
    rawText = fs.readFileSync(rawFile, 'utf8');
  } catch (error) {
    fail(`无法读取 --file ${rawFile}: ${error.message}`);
  }
} else if (!rawText && (useStdin || !process.stdin.isTTY)) {
  try {
    rawText = fs.readFileSync(0, 'utf8');
  } catch {
    rawText = '';
  }
}
rawText = String(rawText || '').trim();

const date = new Date().toLocaleDateString('sv-SE');
const ascii = title
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48);
const base = slug || ascii || 'case';

fs.mkdirSync(CASES_DIR, { recursive: true });
let file = path.join(CASES_DIR, `${date}-${base}.md`);
let n = 2;
while (fs.existsSync(file)) {
  file = path.join(CASES_DIR, `${date}-${base}-${n}.md`);
  n += 1;
}

const rawSection = rawText ? `\n## 原始记录\n\n${rawText}\n` : '';
const content = `---
date: ${date}
area: ${area}
project: "${project}"
platform: ${platform || 'ios'}
status: ${status}
title: ${title}
symptom: ""
fix: ""
error_signatures: []
tags: []
---

## 背景

## 现象

## 定位

## 修复

## 适用边界

## 复盘（可迁移的规则）
${rawSection}`;

fs.writeFileSync(file, content, { flag: 'wx' });
console.log(`created ${path.relative(ROOT, file)}`);

const reindex = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'reindex.mjs')], { stdio: 'inherit' });
if (reindex.status !== 0) {
  console.warn('warn: 索引重建失败（案例文件已写入，可手动运行 node bin/reindex.mjs）');
}

if (commit) {
  for (const gitArgs of [
    ['pull', '--rebase'],
    ['add', '-A'],
    ['commit', '-m', `case: ${title}`],
    ['push']
  ]) {
    const result = spawnSync('git', gitArgs, { cwd: ROOT, stdio: 'inherit' });
    if (result.status !== 0) fail(`git ${gitArgs.join(' ')} 失败（文件已写入 ${path.relative(ROOT, file)}）`);
  }
  console.log('committed & pushed');
} else {
  console.log(`编辑后提交: cd ${ROOT} && git pull --rebase && git add -A && git commit -m "case: ${title}" && git push`);
}


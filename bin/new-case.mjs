#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { CASES_DIR, fail } from './lib.mjs';

const USAGE = '用法: node bin/new-case.mjs --title "一句话标题" --area <area> [--slug x] [--project x] [--platform x]';

const args = process.argv.slice(2);
let title = '';
let area = '';
let slug = '';
let project = '';
let platform = '';
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
  else fail(`未知参数 ${arg}\n${USAGE}`);
}
if (!title) fail(`--title 必填\n${USAGE}`);
if (!area) fail(`--area 必填\n${USAGE}`);

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

const content = `---
date: ${date}
area: ${area}
project: "${project}"
platform: ${platform || 'ios'}
status: open
title: ${title}
symptom: ""
error_signatures: []
tags: []
---

## 背景

## 现象

## 定位

## 修复

## 复盘（可迁移的规则）
`;

fs.writeFileSync(file, content, { flag: 'wx' });
console.log(`created ${path.relative(process.cwd(), file)}`);
console.log('编辑后运行: node bin/reindex.mjs');


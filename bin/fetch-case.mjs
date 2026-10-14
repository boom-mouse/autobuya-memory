#!/usr/bin/env node
import { fail } from './lib.mjs';

const args = process.argv.slice(2);
const pathArg = args.find((arg) => !arg.startsWith('--'));
if (!pathArg) fail('用法: node bin/fetch-case.mjs <cases/xxx.md> [--raw]');

const repo = process.env.GITHUB_REPOSITORY || 'zjyzhj/autobuya-memory';
const ref = process.env.GITHUB_REF || 'main';
const url = `https://raw.githubusercontent.com/${repo}/${ref}/${pathArg}`;
const headers = {};
if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) {
  headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN || process.env.GH_TOKEN}`;
}
const response = await fetch(url, { headers });
if (!response.ok) fail(`拉取失败 ${response.status}: ${await response.text().catch(() => '')}`);
process.stdout.write(await response.text());

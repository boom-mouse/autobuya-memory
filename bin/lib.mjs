import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CASES_DIR = path.join(ROOT, 'cases');
export const INDEX_DIR = path.join(ROOT, 'index');
export const DB_PATH = path.join(INDEX_DIR, 'cases.sqlite');

const SKIP_NAMES = new Set(['README.md', 'TEMPLATE.md']);

export function fail(message, code = 1) {
  console.error(`error: ${message}`);
  process.exit(code);
}

export function ensureSqliteNode() {
  if (process.env.AUTOBUYA_MEMORY_BOOTSTRAPPED === '1') return;
  const major = Number(process.versions.node.split('.')[0]);
  const flags = [];
  if (major < 24) {
    const probe = spawnSync(process.execPath, ['--experimental-sqlite', '-e', "require('node:sqlite')"], {
      stdio: 'ignore'
    });
    if (probe.status !== 0) {
      fail(`需要 Node 24+（当前 ${process.versions.node}），且该版本不支持 --experimental-sqlite 回退；可先 nvm use 24`);
    }
    flags.push('--experimental-sqlite');
  }
  const result = spawnSync(
    process.execPath,
    [...flags, '--disable-warning=ExperimentalWarning', process.argv[1], ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, AUTOBUYA_MEMORY_BOOTSTRAPPED: '1' } }
  );
  process.exit(result.status ?? 1);
}

// Restricted front-matter parser: key: value, quoted strings, inline arrays
// [a, b], and "- item" block lists. Deliberately no YAML dependency.
export function parseFrontMatter(raw) {
  if (!raw.startsWith('---\n')) return { meta: {}, body: raw };
  const end = raw.indexOf('\n---', 4);
  if (end === -1) return { meta: {}, body: raw };
  const fm = raw.slice(4, end);
  const body = raw.slice(end + 4).replace(/^\n/, '');
  const meta = {};
  let currentListKey = null;
  for (const line of fm.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const listItem = line.match(/^\s*-\s+(.*)$/);
    if (listItem && currentListKey) {
      meta[currentListKey].push(unquote(listItem[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const value = kv[2].trim();
    if (value === '') {
      meta[key] = [];
      currentListKey = key;
      continue;
    }
    if (value.startsWith('[') && value.endsWith(']')) {
      meta[key] = value
        .slice(1, -1)
        .split(',')
        .map((s) => unquote(s.trim()))
        .filter(Boolean);
      currentListKey = null;
      continue;
    }
    meta[key] = unquote(value);
    currentListKey = null;
  }
  return { meta, body };
}

function unquote(value) {
  const v = String(value ?? '').trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

export function walkCases(dir = CASES_DIR) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkCases(full));
    else if (entry.isFile() && entry.name.endsWith('.md') && !SKIP_NAMES.has(entry.name)) out.push(full);
  }
  return out.sort();
}

export function loadCases() {
  return walkCases().map((file) => {
    const raw = fs.readFileSync(file, 'utf8');
    const { meta, body } = parseFrontMatter(raw);
    const id = path.basename(file, '.md');
    return {
      id,
      path: path.relative(ROOT, file),
      date: String(meta.date || id.slice(0, 10)),
      area: String(meta.area || 'other'),
      project: String(meta.project || ''),
      platform: String(meta.platform || ''),
      status: String(meta.status || 'open'),
      title: String(meta.title || id),
      symptom: String(meta.symptom || ''),
      fix: String(meta.fix || ''),
      error_signatures: Array.isArray(meta.error_signatures) ? meta.error_signatures : [],
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      content: body
    };
  });
}

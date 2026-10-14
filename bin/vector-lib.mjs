import crypto from 'node:crypto';
import { vectorTextForCase, sha256Hex, fail } from './lib.mjs';

const EMBEDDING_BATCH = 16;
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
const DEFAULT_COLLECTION = 'autobuya_memory';
const DEFAULT_TABLE = 'case_vectors';

export function embeddingModel() {
  return process.env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
}

export function vectorBackend() {
  return String(process.env.VECTOR_BACKEND || 'qdrant').toLowerCase();
}

export function hasVectorConfig() {
  const backend = vectorBackend();
  if (backend === 'pgvector') {
    return Boolean(process.env.DATABASE_URL || process.env.PGHOST || process.env.PGDATABASE);
  }
  return Boolean(process.env.QDRANT_URL);
}

export async function embedTexts(texts) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.EMBEDDING_API_KEY;
  if (!apiKey) fail('未配置 OPENAI_API_KEY / EMBEDDING_API_KEY');
  const apiBase = String(process.env.EMBEDDING_API_BASE || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = embeddingModel();
  const output = [];
  for (let offset = 0; offset < texts.length; offset += EMBEDDING_BATCH) {
    const batch = texts.slice(offset, offset + EMBEDDING_BATCH);
    const response = await fetch(`${apiBase}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        input: batch,
        encoding_format: 'float'
      })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      fail(`embedding API ${response.status}: ${detail.slice(0, 240)}`);
    }
    const payload = await response.json();
    if (!Array.isArray(payload?.data)) fail('embedding API 返回缺少 data');
    const ordered = [...payload.data].sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
    if (ordered.length !== batch.length) fail(`embedding API 返回 ${ordered.length} 条，期望 ${batch.length} 条`);
    output.push(...ordered.map((item) => Array.isArray(item.embedding) ? item.embedding : []));
  }
  return output;
}

export function buildVectorRecord(c, embedding) {
  const text = vectorTextForCase(c);
  return {
    id: c.id,
    path: c.path,
    date: c.date,
    model: embeddingModel(),
    dimensions: embedding.length,
    text_hash: sha256Hex(text),
    area: c.area,
    project: c.project,
    platform: c.platform,
    status: c.status,
    title: c.title,
    symptom: c.symptom,
    fix: c.fix,
    tags: c.tags || [],
    error_signatures: c.error_signatures || [],
    updated_at: new Date().toISOString(),
    vector: embedding
  };
}

export async function ensureVectorStore(records) {
  if (vectorBackend() === 'pgvector') return ensurePg(records[0]?.dimensions || 1536);
  return ensureQdrant(records[0]?.dimensions || 1536);
}

export async function upsertVectors(records, { deleteStale = true } = {}) {
  if (vectorBackend() === 'pgvector') return upsertPg(records, { deleteStale });
  return upsertQdrant(records);
}

export async function searchVectors(vector, filters = {}, limit = 20) {
  if (vectorBackend() === 'pgvector') return searchPg(vector, filters, limit);
  return searchQdrant(vector, filters, limit);
}

function uuidFromText(input) {
  const hex = crypto.createHash('sha1').update(String(input)).digest('hex');
  const h = hex.slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function qdrantBase() {
  const base = process.env.QDRANT_URL;
  if (!base) fail('QDRANT_URL 未配置');
  return String(base).replace(/\/+$/, '');
}

function qdrantCollection() {
  return process.env.QDRANT_COLLECTION || DEFAULT_COLLECTION;
}

function apiHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.QDRANT_API_KEY) headers.Authorization = `Bearer ${process.env.QDRANT_API_KEY}`;
  return headers;
}

async function ensureQdrant(dimensions) {
  const base = qdrantBase();
  const collection = qdrantCollection();
  const response = await fetch(`${base}/collections/${collection}`, { headers: apiHeaders() });
  if (response.status === 404) {
    const created = await fetch(`${base}/collections/${collection}`, {
      method: 'PUT',
      headers: apiHeaders(),
      body: JSON.stringify({ vectors: { size: Number(dimensions), distance: 'Cosine' } })
    });
    if (!created.ok) {
      const detail = await created.text().catch(() => '');
      fail(`Qdrant 创建集合失败 ${created.status}: ${detail.slice(0, 240)}`);
    }
    return;
  }
  if (!response.ok) fail(`Qdrant 读取集合失败 ${response.status}`);
  const payload = await response.json();
  const size = payload?.result?.config?.params?.vectors?.size;
  if (size !== undefined && Number(size) !== Number(dimensions)) {
    fail(`Qdrant 向量维度不匹配：集合 ${size}，embedding ${dimensions}`);
  }
}

async function upsertQdrant(records) {
  const points = records.map((record) => ({
    id: uuidFromText(record.id),
    vector: record.vector,
    payload: {
      case_id: record.id,
      path: record.path,
      date: record.date,
      model: record.model,
      dimensions: record.dimensions,
      text_hash: record.text_hash,
      area: record.area,
      project: record.project,
      platform: record.platform,
      status: record.status,
      title: record.title,
      symptom: record.symptom,
      fix: record.fix,
      tags: record.tags,
      error_signatures: record.error_signatures,
      updated_at: record.updated_at
    }
  }));
  const response = await fetch(
    `${qdrantBase()}/collections/${qdrantCollection()}/points?wait=true`,
    {
      method: 'PUT',
      headers: apiHeaders(),
      body: JSON.stringify({ points })
    }
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    fail(`Qdrant upsert 失败 ${response.status}: ${detail.slice(0, 240)}`);
  }
}

async function searchQdrant(vector, filters, limit) {
  const must = [];
  for (const [field, value] of Object.entries(filters || {})) {
    if (value !== undefined && value !== null && value !== '') {
      must.push({ key: field, match: { value } });
    }
  }
  const body = {
    vector,
    limit: Math.max(1, Math.min(Number(limit), 200)),
    with_payload: true
  };
  if (must.length) body.filter = { must };
  const response = await fetch(
    `${qdrantBase()}/collections/${qdrantCollection()}/points/search`,
    {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify(body)
    }
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    fail(`Qdrant search 失败 ${response.status}: ${detail.slice(0, 240)}`);
  }
  const payload = await response.json();
  return (payload.result || []).map((point) => ({
    id: String(point.payload?.case_id || point.id),
    score: Number(point.score || 0),
    payload: point.payload || {}
  }));
}

async function pgPool() {
  const { default: pg } = await import('pg');
  return new pg.Pool({
    connectionString: process.env.DATABASE_URL || undefined,
    max: 5
  });
}

function pgTable() {
  return process.env.PGVECTOR_TABLE || DEFAULT_TABLE;
}

async function ensurePg(dimensions) {
  const pool = await pgPool();
  const client = await pool.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${pgTable()} (
         id TEXT PRIMARY KEY,
         path TEXT NOT NULL,
         model TEXT NOT NULL,
         dimensions INTEGER NOT NULL,
         text_hash TEXT NOT NULL,
         area TEXT NOT NULL DEFAULT '',
         project TEXT NOT NULL DEFAULT '',
         platform TEXT NOT NULL DEFAULT '',
         status TEXT NOT NULL DEFAULT '',
         title TEXT NOT NULL,
         symptom TEXT NOT NULL DEFAULT '',
         fix TEXT NOT NULL DEFAULT '',
         tags JSONB NOT NULL DEFAULT '[]',
         error_signatures JSONB NOT NULL DEFAULT '[]',
         updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         embedding vector(${Number(dimensions)})
       )`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS ${pgTable()}_embedding_hnsw
       ON ${pgTable()} USING hnsw (embedding vector_cosine_ops)`
    );
  } finally {
    client.release();
    await pool.end();
  }
}

async function upsertPg(records, { deleteStale }) {
  const pool = await pgPool();
  const client = await pool.connect();
  const table = pgTable();
  const vectorLiteral = (vector) => `[${vector.join(',')}]`;
  try {
    await client.query('BEGIN');
    for (const record of records) {
      await client.query(
        `INSERT INTO ${table} (
           id, path, model, dimensions, text_hash, area, project, platform, status,
           title, symptom, fix, tags, error_signatures, embedding
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (id) DO UPDATE SET
           path=EXCLUDED.path, model=EXCLUDED.model, dimensions=EXCLUDED.dimensions,
           text_hash=EXCLUDED.text_hash, area=EXCLUDED.area, project=EXCLUDED.project,
           platform=EXCLUDED.platform, status=EXCLUDED.status, title=EXCLUDED.title,
           symptom=EXCLUDED.symptom, fix=EXCLUDED.fix, tags=EXCLUDED.tags,
           error_signatures=EXCLUDED.error_signatures, embedding=EXCLUDED.embedding,
           updated_at=now()`,
        [
          record.id,
          record.path,
          record.model,
          record.dimensions,
          record.text_hash,
          record.area,
          record.project,
          record.platform,
          record.status,
          record.title,
          record.symptom,
          record.fix,
          JSON.stringify(record.tags),
          JSON.stringify(record.error_signatures),
          vectorLiteral(record.vector)
        ]
      );
    }
    if (deleteStale) {
      const ids = records.map((record) => record.id);
      if (ids.length) {
        await client.query(`DELETE FROM ${table} WHERE id <> ALL($1::text[])`, [ids]);
      } else {
        await client.query(`DELETE FROM ${table}`);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function searchPg(vector, filters, limit) {
  const pool = await pgPool();
  const table = pgTable();
  const params = [embeddingModel(), `[${vector.join(',')}]`, Math.max(1, Math.min(Number(limit), 200))];
  const clauses = ['model = $1', 'id IS NOT NULL'];
  if (filters?.area) { params.push(filters.area); clauses.push(`area = $${params.length}`); }
  if (filters?.project) { params.push(filters.project); clauses.push(`project = $${params.length}`); }
  if (filters?.platform) { params.push(filters.platform); clauses.push(`platform = $${params.length}`); }
  if (filters?.status) { params.push(filters.status); clauses.push(`status = $${params.length}`); }
  if (filters?.tag) { params.push(filters.tag); clauses.push(`tags ? $${params.length}`); }
  const sql = `
    SELECT id, path, date, title, fix, symptom, error_signatures, tags, area, project, platform, status,
           1 - (embedding <=> $2::vector) AS score
    FROM ${table}
    WHERE ${clauses.join(' AND ')}
    ORDER BY embedding <=> $2::vector
    LIMIT $3
  `;
  try {
    const result = await pool.query(sql, params);
    return result.rows.map((row) => ({
      id: row.id,
      score: Number(row.score || 0),
      payload: row
    }));
  } finally {
    await pool.end();
  }
}

export function filtersForBackend(opts) {
  return {
    area: opts.area,
    project: opts.project,
    platform: opts.platform,
    status: opts.status,
    tag: opts.tag
  };
}

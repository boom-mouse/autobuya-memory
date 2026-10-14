CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS case_vectors (
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
  embedding vector(1536)
);

CREATE INDEX IF NOT EXISTS case_vectors_embedding_hnsw
  ON case_vectors USING hnsw (embedding vector_cosine_ops);

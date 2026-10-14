# autobuya-memory

AutobuyA 交付（改包 / 产包）的案例记忆库：把人工审查、验收、改包过程中发现的 bug、问题与教训，沉淀成可检索案例，供后续任务开工前检索、收尾时归档。

## 架构

- 事实源：`cases/*.md`，推 GitHub。
- 文本索引：`index/cases.sqlite`，派生、本地可重建、不入库。
- 向量存储：Qdrant 或 pgvector，远程服务，不在本地常驻。
- Embedding：OpenAI 兼容 `/embeddings`，默认 `text-embedding-3-small`。
- 检索：关键词文本召回 + 向量召回，RRF 融合。

## 布局

```text
cases/        案例 markdown，事实源
rules/        稳定规则
schema/       pgvector 建表 SQL
bin/          reindex / new-case / sync-vectors / search
index/        cases.sqlite（派生，gitignore）
```

## 安装

```bash
npm install
```

## 配置

Qdrant：

```bash
export VECTOR_BACKEND=qdrant
export QDRANT_URL=https://your-qdrant.example:6333
export QDRANT_API_KEY=...
export QDRANT_COLLECTION=autobuya_memory
export OPENAI_API_KEY=...
export EMBEDDING_MODEL=text-embedding-3-small
```

pgvector：

```bash
export VECTOR_BACKEND=pgvector
export DATABASE_URL=postgres://user:pass@host:5432/db
export PGVECTOR_TABLE=case_vectors
export OPENAI_API_KEY=...
export EMBEDDING_MODEL=text-embedding-3-small
```

pgvector 首次可用 `schema/vector.sql` 建表；脚本也会自动执行 `CREATE EXTENSION IF NOT EXISTS vector` 和 HNSW 索引。

## 使用

### 只查询（不下载案例内容）

只拉脚本和 schema，不 clone `cases/`：

```bash
git clone --depth 1 --filter=blob:none --sparse \
  https://github.com/zjyzhj/autobuya-memory.git /tmp/autobuya-memory
cd /tmp/autobuya-memory
git sparse-checkout set bin package.json package-lock.json schema
npm ci
```

检索：

```bash
node bin/search.mjs 深色模式 弹窗
node bin/search.mjs 弹窗 --area layout --json
node bin/search.mjs 溢出 --tag 小屏 --limit 20
```

读取命中案例的单个原文：

```bash
node bin/fetch-case.mjs cases/xxx.md
```

### 写入（新增 / 修改案例）

完整或稀疏包含 `cases/` 的 checkout：

```bash
git clone https://github.com/zjyzhj/autobuya-memory.git /tmp/autobuya-memory
cd /tmp/autobuya-memory && npm ci
```

文本索引：

```bash
node bin/reindex.mjs
```

同步向量到 Qdrant/pgvector：

```bash
node bin/sync-vectors.mjs --all
node bin/sync-vectors.mjs --file cases/xxx.md
node bin/sync-vectors.mjs --since <commit>
node bin/sync-vectors.mjs --dry-run --all
```

GitHub push 后，仓库里的 `.github/workflows/sync-vectors.yml` 会在 GitHub Actions 上增量同步；使用方不需要全量 clone 案例库来更新向量。

新增案例：

```bash
node bin/new-case.mjs \
  --title "某弹窗深色模式不可见" \
  --area layout \
  --text "审查发现：深色模式弹窗与背景同色" \
  --sync
git add -A && git commit -m "case: ..." && git push
```

默认有向量服务就混合检索，`--text-only` 强制只走文本。

## 仓库边界

- Skill：独立仓库 `zjyzhj/autobuya-memory-skill`。
- 案例/向量系统：本仓库 + Qdrant/pgvector 服务。
- 向量存储不放在本地，也不需要本地常驻仓库；需要时按需 checkout 脚本，原始案例按命中路径单独拉取。

## 契约

- 只人工显式触发；不进入持续改包流程。
- 一条案例 = 一个问题（症状 → 修复 → 可迁移规则）。
- 写前 `git pull --rebase`；写完 push；同一时间一个写者。
- 不写客户/个人敏感信息。

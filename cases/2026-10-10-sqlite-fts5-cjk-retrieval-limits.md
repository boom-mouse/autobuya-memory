---
date: 2026-10-10
area: tooling
project: ""
platform: tooling
status: fixed
title: SQLite FTS5 对中文检索的真实限制（决定案例库用子串评分起步）
symptom: 案例库想用 FTS5 做中文检索；实测 2 字词（溢出/闪退）在 unicode61 与 trigram 分词下都查不到
fix: 案例库检索改用子串评分（不用 FTS5 分词）；FTS5 留作规模升级选项
error_signatures: ["no such module: fts5", "SQLITE_ERROR"]
tags: [中文检索, fts5, sqlite, node]
---

## 背景

设计案例记忆库检索层时，评估 SQLite FTS5 能否直接承担中文检索（Node 24 内置 `node:sqlite`，零依赖路线）。

## 现象

同机实测（2026-10-10，Node v24.14.1 / macOS 自带 sqlite3）：

- macOS 自带 `sqlite3` CLI：`CREATE VIRTUAL TABLE t USING fts5(x)` → `no such module: fts5`（未编译 FTS5）。
- `node:sqlite`：FTS5 可用；但 `unicode61` 把整句中文当作一个 token——查"溢出" 0 命中，查整句才命中。
- `trigram` 分词：仅 ≥3 字连续匹配——"布局在" 命中，"溢出" 0 命中。

## 结论

2 字高频词（溢出/闪退/黑屏/卡死）是中文检索的分水岭；百级案例规模下，子串评分扫描毫秒级且行为最稳，作为起步方案；FTS5 留作规模上来后的可选升级（trigram + 真分词器），markdown 格式与 CLI 接口不变。

## 复盘

**工具自检要用真实语言样本**：仅验证"FTS5 可用"会掩盖中文分词失效；判断检索方案前必须用实际查询词（含 2 字词）做端到端命中测试。

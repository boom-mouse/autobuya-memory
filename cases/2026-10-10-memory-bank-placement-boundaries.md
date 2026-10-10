---
date: 2026-10-10
area: tooling
project: ""
platform: tooling
status: fixed
title: 案例记忆库放置边界：技能包 / 产品仓库 / runtime root 都不可写
symptom: 给改包流程沉淀审查发现时，记忆库放错位置会触发技能 bundle 守卫，或随交付仓外泄
fix: 记忆库独立为 git 仓库（技能包外），仅人工显式触发读写；不接入持续改包流程
error_signatures: ["HOOK_INSTALLED_SKILL_WRITE_FORBIDDEN", "bundle hash mismatch"]
tags: [记忆库, write-guard, runtime-root, retention]
---

## 背景

改包后的人工审查发现需要沉淀为可复用知识。候选位置：技能包内、产品仓库内、Supervisor runtime root、独立仓库。

## 结论（放置边界）

- 技能包（源码目录、`~/.claude/skills`、`~/.codex/skills`）：禁止。`installed_skill_write_guard.mjs` 会拒绝 Worker 写入技能根；技能 bundle 有哈希守卫，改动会让下次激活时全机 Job fail。
- 产品仓库：禁止。会随 `git_push` 进交付仓，且按产品碎片化，无法跨项目复用。
- runtime root（`AUTOBUYA_CONTINUOUS_RUNTIME_ROOT`）：不适合。机器绑定，且 retention 默认会清 `jobs/*/attempts/*`（30 天）和诊断事件（7 天）。
- 独立 git 仓库（本仓库）：正确。放本机 `~/autobuya-memory`，私有 GitHub 远端做备份与多机同步。

## 读写模型（2026-10-10 操作员决定：纯人工触发，不接入持续改包流程）

- 写：仅人工显式触发（`new-case`，可 `--commit`）；不接 Supervisor closeout、不自动生成。
- 读：仅人工显式触发（`search`）；不接 Worker 派发、不自动检索。
- 沉淀材料只来自用户当场提供的文字/文件；不主动去 runtime root / Job 产物取材。

## 复盘

**知识库要放在"守卫之外、生命周期更长"的存储层**：技能包是可分发的代码层（hash 守卫 + 只读），runtime root 是可再生的运行态（retention 会清理），只有独立仓库能同时满足可写、可审计、跨机器。

---
name: autobuya-memory
description: AutobuyA 交付案例记忆库的读写入口。用户说"沉淀到记忆库 / 记一下这个问题 / 查一下以前有没有同类问题 / 这个 bug 以前修过吗"时使用：沉淀 = 把人工审查、修复中发现的问题落成结构化案例；查库 = 检索历史案例的"同类问题 + 当时修复"。仅在用户显式要求沉淀或检索时使用，不介入普通改包任务。
---

# AutobuyA Memory（案例记忆库）

数据与 CLI 都在 `~/autobuya-memory`（私有 GitHub：`zjyzhj/autobuya-memory`）。本 skill 是它的交互入口，软链到仓库的 `skill/` 目录——改仓库即改 skill。

库不存在时先克隆：

    git clone git@github.com:zjyzhj/autobuya-memory.git ~/autobuya-memory
    node ~/autobuya-memory/bin/reindex.mjs

Node：24 首选；22.5–23 自动回退（脚本内处理）。

## 消费：查"同类问题 → 修复"

用户问"有没有同类问题 / 以前怎么修的"时执行：

    node ~/autobuya-memory/bin/search.mjs <2-3 个核心词> [--any] [--area layout] [--project X] [--tag 小屏] [--json]

- 看结果里的 `修复:` 一行快速判断；需要细节再读命中的 `cases/*.md`（重点看「现象 / 定位 / 修复 / 复盘」）。
- 命中 0 条：换同义词再查（溢出/遮挡/重叠、闪退/崩溃/黑屏），或用 `--any`；仍无 → 明确告诉用户"记忆库没有记录"。
- 给用户的回述：命中时给出「问题 + 修复 + 是否可复用」三句式，并附案例文件路径。

## 沉淀：把审查/修复发现落库

1. **先查重**：`search.mjs <症状核心词> --any`。同一问题同根因已有案例 → 追加到既有案例；不新建重复条目。
2. 从对话/用户文字提取字段：`title`（一句话问题）、`area`（layout|functional|iap|privacy|build|dispatch|review|tooling|other）、`project`、`symptom`（用户可见表现）、`fix`（一句话修复；未修完可空、status=open）、`tags`（带同义词）。
3. 建文件（原始记录写入「## 原始记录」并自动重建索引）：

    node ~/autobuya-memory/bin/new-case.mjs --title "…" --area layout --project <包名> --text "<原始记录>" [--status open|fixed]

   `--file <path>` / `--stdin` 也可传原始记录；中文标题 slug 默认 `case`，可用 `--slug` 指定。
4. 编辑生成的文件：补全 现象 / 定位 / 修复 / 复盘（可迁移规则），并填 front-matter 的 `symptom` / `fix` / `tags`。
5. 提交推送：

    cd ~/autobuya-memory && git add -A && git commit -m "case: …" && git push

   或第 3 步直接 `--commit`（自动 add/commit/push；注意它会 `git add -A`）。

## 守则

- 一条案例 = 一个问题（症状 → 修复 → 可迁移规则）；不要一次审查生成一条大杂烩。
- `fix` 必须是一句话；检索结果靠它快速判断。
- 写前 `git pull --rebase`；写完 push；同一时间只一个写者。
- 脱敏：不写客户/个人敏感信息。
- 只写 `~/autobuya-memory`；绝不写入交付技能包（`~/.claude/skills`、`~/.codex/skills`、技能源码目录）和产品仓库。

## 维护

- 本 skill 目录 = `~/autobuya-memory/skill` 的软链；改动走仓库 git。
- 换机器：clone 仓库后重建软链（见仓库 README「作为 Skill 使用」）。


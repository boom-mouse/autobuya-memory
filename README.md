# autobuya-memory

AutobuyA 交付（改包 / 产包）的**案例记忆库**：把人工审查、验收、改包过程中发现的 bug、问题与教训，沉淀成可检索的案例，供后续任务开工前检索、收尾时归档。

- **事实源**：本仓库的 markdown 文件（可 audit、可 diff、可 review、可回滚）
- **检索层**：当前会话模型阅读案例；CLI 只做关键词辅助
- **服务**：无。Git 仓库即后端，无需向量库、embedding API 或常驻进程

## 布局

    cases/    一条案例一个文件，文件名即 id：YYYY-MM-DD-slug.md
    rules/    从案例归纳出的稳定规则；高价值规则定期提升进技能 references/（走技能发版）
    schema/   案例 schema 与模板
    bin/      reindex / search / new-case
    index/    cases.sqlite（.gitignore，可重建）

## 使用

入库（人工触发；生成时自动重建索引）：

    node bin/new-case.mjs --title "某弹窗深色模式不可见" --area layout --project MyApp \
      --text "审查发现：深色模式弹窗与背景同色，看不清"     # 原始记录写入「## 原始记录」
    #    编辑生成的文件：填 现象 / 定位 / 修复 / 复盘（front-matter 的 fix 填一句话修复）
    git add -A && git commit -m "case: 某弹窗深色模式不可见" && git push

    可选项：--commit 生成时自动 add/commit/push；--file <path> 或 --stdin 传入原始记录。

开工前检索（人或 agent）：

    git clone --depth 1 https://github.com/zjyzhj/autobuya-memory.git /tmp/autobuya-memory
    cd /tmp/autobuya-memory
    # 由当前会话模型阅读 cases/*.md，判断是否同根因
    # CLI 可辅助：node bin/search.mjs 深色模式 弹窗 --any

    node bin/search.mjs 深色模式 弹窗                 # 关键词（默认 AND）
    node bin/search.mjs 弹窗 --area layout --json     # 结构化过滤 + JSON（agent 用）
    node bin/search.mjs 落地页 --tag 小屏 --limit 20  # 标签过滤 + 限量

检索结果带 `修复:` 一行（front-matter `fix`），用于快速判断「是否同一个问题、当时怎么修」。

新机器 / 新会话：clone 后按需重建文本索引

    git clone --depth 1 https://github.com/zjyzhj/autobuya-memory.git /tmp/autobuya-memory
    cd /tmp/autobuya-memory && node bin/reindex.mjs

环境：Node 24 首选；22.5–23 会自动以 `--experimental-sqlite` 回退（macOS 默认 shell 可能是 22，`nvm use 24` 即可）。

## 仓库边界：数据与 Skill 分离

本仓库只放数据、CLI 与检索索引；skill 源码在独立私有仓库：

- 数据/检索仓库：`zjyzhj/autobuya-memory`（Git 即后端）
- Skill 仓库：`zjyzhj/autobuya-memory-skill`

安装 skill 时软链到 skill 仓库根目录；数据仓库不需要常驻本地：

    ln -sfn ~/autobuya-memory-skill ~/.codex/skills/autobuya-memory     # Codex
    ln -sfn ~/autobuya-memory-skill ~/.claude/skills/autobuya-memory    # Claude Code

新会话生效。之后说「沉淀到记忆库」「查一下以前有没有类似问题」即可触发；换机器先 clone 两个仓库，再重建这两条软链。

## 集成契约与边界（决定：不进入持续改包流程）

- **只支持人工显式触发**：人触发入库（`new-case`）与检索（`search`）；不接调度、不起服务、不做自动沉淀/自动检索。
- **不接入持续改包/产包流程**：不改 `autobuya-feishu-app-delivery`；不加 closeout 钩子、不加 worker 派发检索、不读写 Job/Worker 运行时状态；沉淀材料只来自用户当场提供的文字/文件，不主动去 runtime root 或 Job 产物取材。
- **禁写区**：不放技能包（`~/.claude/skills`、`~/.codex/skills`、技能源码目录有 write guard + bundle hash 守卫），不放产品仓库（会随 push 进交付仓）。

## 检索实现说明（实测）

起步用 SQLite 子串评分（title×5、tags/symptom/error_signatures×3、正文×1），不用 FTS5 分词。2026-10-10 实测（Node v24.14.1）：

- macOS 自带 `sqlite3` CLI 未编译 FTS5：`no such module: fts5`。
- FTS5 `unicode61` 把整句中文当作一个 token："溢出" 0 命中，整句才命中。
- FTS5 `trigram` 仅 ≥3 字连续匹配："布局在" 命中，"溢出" 0 命中。

2 字高频词（溢出/闪退/黑屏/卡死）是中文检索的分水岭。当前规模下子串扫描毫秒级且最稳；后续若需要更强检索，可由调用 skill 的会话模型直接阅读案例，而不需要引入向量服务。

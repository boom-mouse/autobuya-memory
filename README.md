# autobuya-memory

AutobuyA 交付（改包 / 产包）的**案例记忆库**：把人工审查、验收、改包过程中发现的 bug、问题与教训，沉淀成可检索的案例，供后续任务开工前检索、收尾时归档。

- **事实源**：本仓库的 markdown 文件（可 audit、可 diff、可 review、可回滚）
- **检索层**：`index/cases.sqlite`（派生文件，随时可重建，不入库）
- **服务**：无。嵌入式 SQLite，零常驻进程，零第三方依赖（Node 24 内置 `node:sqlite`）

## 布局

    cases/    一条案例一个文件，文件名即 id：YYYY-MM-DD-slug.md
    rules/    从案例归纳出的稳定规则；高价值规则定期提升进技能 references/（走技能发版）
    schema/   案例 schema 与模板
    bin/      reindex / search / new-case
    index/    cases.sqlite（.gitignore，可重建）

## 使用

入库（人工，4 步）：

    node bin/new-case.mjs --title "某弹窗深色模式不可见" --area layout --project MyApp
    #    编辑生成的文件：填 现象 / 定位 / 修复 / 复盘
    node bin/reindex.mjs
    git add -A && git commit -m "case: 某弹窗深色模式不可见" && git push

开工前检索（人或 agent）：

    node bin/search.mjs 深色模式 弹窗                 # 关键词（默认 AND）
    node bin/search.mjs 弹窗 --area layout --json     # 结构化过滤 + JSON（agent 用）
    node bin/search.mjs 落地页 --tag 小屏 --limit 20  # 标签过滤 + 限量

新机器 / 新会话：

    git clone git@github.com:zjyzhj/autobuya-memory.git ~/autobuya-memory
    cd ~/autobuya-memory && node bin/reindex.mjs

环境：Node 24 首选；22.5–23 会自动以 `--experimental-sqlite` 回退（macOS 默认 shell 可能是 22，`nvm use 24` 即可）。

## 集成契约

- **写**：只有 Supervisor 单写。收尾（closeout）时从审查 receipt / worker 结果生成案例，`reindex` 后 commit + push。
- **读**：Worker 只读调用 `node ~/autobuya-memory/bin/search.mjs --json <关键词>`；技能目录保持只读。
- **降级**：检索或仓库不可用时按 degraded 记录并继续，绝不阻塞 Job。
- **禁写区**：不放技能包（`~/.claude/skills`、`~/.codex/skills`、技能源码目录有 write guard + bundle hash 守卫），不放产品仓库（会随 push 进交付仓）。

## 检索实现说明（实测）

起步用 SQLite 子串评分（title×5、tags/symptom/error_signatures×3、正文×1），不用 FTS5 分词。2026-10-10 实测（Node v24.14.1）：

- macOS 自带 `sqlite3` CLI 未编译 FTS5：`no such module: fts5`。
- FTS5 `unicode61` 把整句中文当作一个 token："溢出" 0 命中，整句才命中。
- FTS5 `trigram` 仅 ≥3 字连续匹配："布局在" 命中，"溢出" 0 命中。

2 字高频词（溢出/闪退/黑屏/卡死）是中文检索的分水岭。百级案例下子串扫描毫秒级且最稳；规模上来再叠 trigram / 真分词 / embedding，markdown 格式与 CLI 接口不变。

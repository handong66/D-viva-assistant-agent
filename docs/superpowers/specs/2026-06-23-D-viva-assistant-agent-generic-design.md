# D-viva-assistant-agent · 通用论文答辩准备应用 — v1 设计 (Spec)

- 日期：2026-06-23
- 状态：v1 设计已进入实现；截至 2026-06-28，本仓库已有可运行的 Next.js 本地应用、SQLite/证据/AI/STT/Electron 基线。当前运行态快照见 `README.md` 与 `docs/PROJECT_STATUS.md`；本文保留设计背景并同步关键实现差异。
- 来源：以 `MPhil-Thesis-fork/viva_prep/app`（Han Dong 硕士答辩训练 app）为参考蓝本，干净重构为面向**任意论文**的通用工具。

---

## 1. 背景与目标

参考 app 是一个为单篇硕士论文手工打造的答辩训练工具：Vite+React 前端 + Express+SQLite 服务端 + Gemini AI 判分 + 从论文证据块出题的 AI 考官 + 复盘闭环。它的 **UI / 功能 / 用户故事 / 数据模型**经过真实使用验证，但内容层、论文导入管线、AI 传输层都**写死在作者本人的论文**上。

**目标**：以参考 app 的产品形态为蓝本，从零搭一套干净代码，做成"喂进任意论文 → 自动生成备考工作区 → 实时 AI 考官出题判分 → 复盘修复"的通用本地应用。

**成功标准（v1）**：
1. 能导入一篇任意论文（PDF / Markdown / 纯文本），抽取并切成证据块，附**导入质量报告**。
2. 导入后 AI 自动生成一份备考包（论文摘要、关键数字、方法问答、高压问答、理论/文献卡），每条**可回溯到 ingest 证据**且过**落库前校验**。
3. 实时 AI 考官能从论文证据出题，对用户回答做五维评分 + 诊断 + 英文改写 + 追问。
4. 支持打字/粘贴回答，**也支持录音 → STT 转写 → 判分**。
5. 低分项进入复盘修复板。
6. AI 供应商可配置（Gemini / Claude / OpenAI），无 key 时优雅降级。
7. 用一篇**公开论文**作为开发样本端到端跑通。

---

## 2. 已锁定决策

| 决策点 | 选择 |
|---|---|
| v1 形态 | 本地单用户工具，一次专注一篇论文（表结构允许多篇，UI 暂只暴露单篇） |
| 内容策略 | 混合：导入即 AI 生成备考包 + 保留实时考官 + 用户可编辑 |
| AI 供应商 | 供应商无关，AI SDK `"provider/model"` 字符串 + Gateway-ready；当前运行态需 `AI_GATEWAY_API_KEY` 才创建 LLM client |
| 迁移打法 | 干净重构（参考旧 app 思路，不照搬代码） |
| 技术栈 | Next.js (App Router) + AI SDK (`ai` package) + better-sqlite3 + Tailwind CSS + Electron(macOS packaging) |
| STT + 录音 | **保留在 v1**（录音存档 → 转写 → 判分） |
| 训练计划 | 保留为多日训练计划功能（默认 15 天模板，可编辑/重生成，不写死日期） |
| Slides/讲稿系统 | **砍掉**（参考 app 本就 paused，且是"做 PPT 答辩"专属） |
| 个人数据 | **不迁移**。新 app 全新文件夹建，绝不碰原 `viva_prep`；开发样本用公开论文 |
| 隐私姿态 | **本地优先 + 云 AI 可选并明告**（§3）：数据留本地，AI 是可选外呼，有 key 才启用 |

---

## 3. 非目标与隐私/网络边界

**非目标（YAGNI）**：不做多用户/登录/多租户/云存储/账号同步（北极星，非 v1）；不做 Slides/讲稿/计时；不迁移个人数据；不依赖参考 app 的 docx+Python `lint_format` 管线。

**隐私与网络边界（P0-1 决议：本地优先 + 云 AI 可选并明告）**：
- **本地**：SQLite 库、录音、论文原文件**只存本机**；不上云同步、不做账号体系。"本地优先"= 你的数据不离开本机，**除非**作为请求 payload 发给你自己配置的 AI/STT 供应商。
- **AI 是可选外呼**：当前运行态要求 `VIVA_AI_ENABLED=true`、解析到 provider key、且 `AI_GATEWAY_API_KEY` 存在才启用；无 key / Gateway 未配 → 优雅禁用（仍可导入、保留 transcript/录音、生成静态计划，不出 AI 分）。
- **明告（disclosure）**：`/library` 页面明确告知"会把哪些内容（论文摘录 / 题目 / 你的回答 / 转写稿）发给哪个供应商"，用户触发对应动作才外呼。
- **STT**：默认 `off`；`browser`（端上 Web Speech）；`google_cloud`（显式 opt-in，需 GCP 凭证）。
- **密钥**：`.env.example` 只放空占位（**不含**任何真实项目 id）；真实值（如你的 GCP 项目 `viva-496115`）放 gitignored 的 `.env.local`。日志对密钥脱敏。真实模型调用仅 `RUN_LIVE_AI=1` 且对公开样本。

---

## 4. 技术栈

- **Next.js (App Router) + TypeScript** — 前后端一体，Server Actions 承接服务端逻辑。
- **AI SDK（`ai` package）** — 供应商无关；当前通过 `generateText` + `Output.object({ schema })` + zod 拿结构化判分/生成结果；`"provider/model"` 字符串经 AI Gateway。
- **better-sqlite3** — 本地单文件库，同步 API。**Next.js 边界（P1-5）**：仅 Node runtime（触库的 route/action 标 `export const runtime = "nodejs"`）；`next.config` 设 `serverExternalPackages: ["better-sqlite3"]`；db 模块 `import "server-only"`；开 WAL；用 `globalThis` 单例防 HMR 多实例；M0 跑一次 `next build` 冒烟。
- **Tailwind CSS** — 组件层；当前未引入 shadcn 组件库。
- **zod** — schema 校验（贯穿 LLM 输出、ingest、API 边界）。
- **unpdf**（PDF 文本抽取，按页）— Markdown/TXT 直通。
- **vitest** — 单元/集成测试（默认 mock LLM/STT，不调真实模型）。
- **Electron + electron-builder** — macOS 本地 unsigned `.app` 包装，内部启动 Next standalone server。

---

## 5. 架构与模块边界

```
src/app/                 Next.js App Router（页面 + Server Actions，触库处 runtime=nodejs）
  / / import / materials / materials/[id]/edit / plan / practice / review / library
lib/
  llm/
    model-registry.ts    按角色 role 从 env 解析 provider/model（fast/default/hard）
    client.ts            LlmClient 接口 + AI SDK transport：generateObject/generateText + 超时/降级 + ai_call_log
    mock.ts              MockLlmClient（确定性 fixture，测试默认注入）
    judge.ts / examiner.ts / prep-pack.ts
  ingest/
    extract.ts           PDF/MD/TXT → 段落（+ 质量报告）
    chunk.ts             段落 → thesis_chunk + evidence_unit（ingest-only 主证据）
  evidence/
    validator.ts         落库前校验：绑定存在性 + 关键数字值/精确引文出现在绑定证据文本中
  stt/
    index.ts / google.ts / mock.ts / path.ts   google_cloud|browser|off + MockSttTransport
  plan.ts                多日训练计划模板（默认 15 天，3-30 天可选）
src/db/
  client.ts              better-sqlite3 单例（server-only, WAL, HMR guard）
  migrations/            嵌入式 TS 迁移 + schema_migrations 版本表（无 db/schema.ts）
  repository.ts          所有读写封装（无裸 SQL 散落）；解析 active thesis
electron/
  main.cjs               macOS desktop wrapper，启动 Next standalone server
scripts/
  pack-electron.mjs      standalone build + Electron packaging + better-sqlite3 ABI rebuild
```

**与参考 app 映射**：`lib/llm/judge`←`ai-judge.ts`；`lib/llm/examiner`←`examiner-generator.ts`；`lib/llm/prep-pack`←手写 `training_materials/*.md`（改为 AI 生成）；`lib/ingest`←`thesis-evidence.ts` 的 `buildChunks`（丢 docx+Python）；`lib/stt`←`server/stt.ts`；`db`←`server/schema.ts`；`app/*`←`src/main.tsx`（拆成干净组件）。

---

## 6. 数据模型（SQLite，含约束/迁移）

> v1 单篇，但带 `thesis_id` 以便将来多篇。所有表有 PK、FK、NOT NULL 约束 + 必要索引；演进经 `db/migrations/` + `schema_migrations` 版本表（P1-6）。

**核心实体**
- **thesis** — `id, title, author?, abstract?, source_kind(pdf|md|txt), source_meta(json), is_active, created_at, updated_at`。**单篇活跃语义（P1-7）**：partial unique index `WHERE is_active=1`；切换论文 = archive 旧、置新 active（repository 提供 `replaceActiveThesis`）。
- **thesis_chunk** — `id, thesis_id FK, section?, ord, text, char_count, hash`。
- **evidence_unit** — `id, thesis_id FK, chunk_id FK, section?, page?, char_start, char_end, text, hash`。**ingest-only 主证据（P0-2）**：只从论文原文抽取，绝不指向 AI 衍生物；去掉旧的多态 `ref_table/ref_id` 与 kind 漂移（P2-15）。
- **evidence_fts** — FTS5 内容表（`evidence_unit_id UNINDEXED, text`, `tokenize=unicode61`），由 `evidence_unit` 经 insert/delete/update 触发器同步；查询端将用户 topic token 化并 quote 后再 `MATCH`。**仅 Node 本地运行，不部署 Edge/serverless**（P1-8/复评#3）。

**生成与训练**
- **prep_item** — `id, thesis_id FK, generation_run_id? FK, type(digest|key_number|qa|hostile|theory_card|citation_card), title, body(json), claim_text?, evidence_quote?, support_kind(existence|exact_quote|numeric|llm_suggested), value_numeric?, unit?, status(verified|needs_review|unsafe|draft), validation_status(passed|needs_review|failed), validator_version, source(generated|edited|manual), created_at, updated_at, verified_at?`。`key_number` 用 `value_numeric/unit` 归一化；编辑正文 → 退回 `needs_review` 重跑校验（P2-16 + 复评#5 provenance）。
- **prep_item_evidence** / **practice_run_evidence** — 关系型绑定（替掉 json refs；P0-2）。**DDL 不变式（复评#1）**：复合 PK `(parent_id, evidence_unit_id)` + 索引；两端 FK + `ON DELETE CASCADE`；`evidence_unit` 重导入走 `RESTRICT`/重建策略；`PRAGMA foreign_keys=ON`；**同论文不变式**（join 两端同 `thesis_id`，repository 强制 + 测试）；`key_number`/`citation_card` 最小证据基数 ≥1。
- **generation_run** — `id, thesis_id FK, kind(prep_pack|prep_item|regenerate), status(pending|running|done|error|canceled), evidence_snapshot_hash, item_type?, error?, retries, created_at`。进度 / 幂等 / 部分失败 / 重生成（P1-9）；生成的 `prep_item` 回填 `generation_run_id`。
- **practice_run** — `id, thesis_id FK, question, question_kind(random|by_section|cross_section|hostile|boundary|followup), answer_text?, transcript?, scores(json), diagnosis?, rewrite?, follow_ups(json), status(practice|saved), created_at`。
- **review_item** — `id, thesis_id FK, practice_run_id FK, dimension(evidence|clarity|completeness|boundary|delivery), score, reason?, status(open|fixed), created_at`，unique(`practice_run_id`,`dimension`) 防重（P1-10：v1 精简低分队列；mastery/streak v2）。
- **recording** — `id, thesis_id FK, practice_run_id? FK, path, mime, duration_ms, language_mode(english|chinese), stt_provider, stt_status(none|pending|ok|error), stt_error?, transcript?, transcript_edited(bool), created_at`。**单向拥有 FK**：录音→练习（**去掉** `practice_run.recording_id` 环形引用，复评#6）。

**计划与系统**
- **plan** / **plan_day** — 多日计划模板。
- **ai_call_log** — `id, thesis_id?, purpose, provider, model, latency_ms, status(ok|error|timeout), error?, tokens(json), created_at`。
- **schema_migrations** / **app_meta** — 版本与杂项。

**五维评分（默认 rubric，实现期细化）**：① 证据/准确性 ② 清晰度 ③ 完整性 ④ 边界感 ⑤ 英文表达（`dimension` 枚举 `evidence|clarity|completeness|boundary|delivery`）。每维 1–5；任一 ≤2 进复盘。

**落库前校验器（P0-2 核心，分级以免越权 — 复评#2）**：`evidence/validator.ts` 分级，**只有确定性可证才允许 `verified`**：
- **L1 存在/基数**：绑定 `evidence_unit_id` 存在、同论文、满足最小基数。
- **L2 精确引文**：`evidence_quote` 子串命中绑定证据文本。
- **L3 数字**：`value_numeric/unit` 出现在绑定证据文本。
- **L4 LLM 辅助**：仅作**建议**，**绝不**作 `verified` 的门（digest 准确性 / citation 正确性 / QA 蕴含等语义支持无法确定性证明）。

未达 L1–L3 → `needs_review`/`unsafe`；记 `validation_status` + `validator_version`，供内容准确性面板统计。

---

## 7. 用户流程（v1）

```
①导入(新)   上传 PDF / 粘贴 MD·TXT + 填标题 → extract(+质量报告) → chunk → thesis_chunk + evidence_unit(+FTS)
            质量差 → 提示改用粘贴文本/Markdown
②生成        generation_run 驱动进度 → prep_item（带状态+证据绑定+校验器）→ digest/key_number/qa/hostile/theory/citation
③今日        概览 + 推荐训练（多日计划模板，默认 15 天）
④材料        读生成包；编辑→退回 needs_review 重校验；按类型/整体重生成
⑤训练(专注)  选题 or 让 AI 考官从论文出题（检索证据）
            → 回答：打字/粘贴 或 录音→STT 转写
            → AI 判分（五维 + 诊断 + 英文改写 + 追问）→ 保存；任一≤2 进复盘
⑥复盘修复    低分队列修复板
⑦资料库/设置  论文信息（切换论文）、录音档案、AI 供应商/模型配置 + 明告、内容准确性面板、计划编辑
```
**内容准确性面板（P2-18）** MVP 指标：导入质量、证据覆盖度（FTS/章节）、未校验/unsafe 的 prep_item 数、校验失败数。

---

## 8. LLM 供应商无关层

- `model-registry.ts`：按 `role`∈{`fast`,`default`,`hard`} 从 env 解析模型串（`VIVA_MODEL_DEFAULT/HARD/FAST`）。值形如 `anthropic/claude-...`、`openai/...`、`google/...`；当前运行态经 AI Gateway 创建 LLM client，未在各业务模块直连 provider SDK（**不硬编码项目 id**）。
- `client.ts`：`LlmClient` 接口（`generateJson`/`generateText`）+ AI SDK 实现；统一超时（默认 25s）、重试、错误归一化；每次写 `ai_call_log`。**降级**：无可用 key → AI disabled（练习/transcript 仍可用）。**注入式（P1-13）**：测试默认注入 `MockLlmClient`。
- **跨供应商结构化输出（P1-4）**：`generateObject`+zod 在 Gemini/Anthropic/OpenAI/Vertex 上的一致性尚属假设；M0 加 judge/prep schema 的 conformance canary + per-role fallback/repair。
- 轻量数字/危险表达检查优先 deterministic，必要才调模型。

---

## 9. 论文导入管线

替掉参考 app 写死的 `docx → python3 → lint_format` 那套。
- `extract.ts`：PDF→`unpdf`（按页）；MD/TXT 直读按标题/空行切段 → 标准化 `Paragraph[]`。**质量报告（P1-3）**：页数、文本密度、章节识别、表格/公式告警、抽样片段。
- `chunk.ts`：段落 → `thesis_chunk` + `evidence_unit`（locator: section/page/char-span + hash）+ 入 `evidence_fts`。
- **质量门（P1-3）**：质量差时生成步骤提示改用粘贴文本/Markdown（最稳路径）。

---

## 10. 备考包生成

- `prep-pack.ts`：输入证据块，`generateObject`+zod 分类型生成 digest/key_number/qa/hostile/theory_card/citation_card。
- 经 `generation_run`（进度/幂等/重试/取消），落库前过 `validator`（§6）；`key_number` 归一化并校验值出现在绑定证据。
- 默认 `needs_review`，用户校准置 `verified`；可整体/按类型重生成。生成是辅助、非事实真源。

---

## 11. 考官与判分

- `examiner.ts`：模式——整篇随机/按章/跨章综合/高压/越界/追问。跨章/综合走 `evidence/retrieval`（FTS + 章节覆盖；P1-8），每题绑定 `evidence_unit`（写 `practice_run_evidence`）。
- `evidence_fts`（migration 0002）已有 repository reader `searchEvidence`：练习出题可选 topic filter，用 BM25 相关性从 FTS 命中的证据中提供 examiner candidates，而不是默认 full pool；落库的 `question_kind` 仍保持用户选择的既有 kind；后续 offered-ids 过滤与 `practice_run_evidence` 绑定不变，grounding/binding 保持成立。
- `judge.ts`：题目 + 绑定证据 + 回答（文本/transcript）→ 五维分 + 诊断 + 英文改写 + 追问，只据绑定证据判定。
- 路由：日常→`default`，高压/复杂→`hard`，轻量→`fast`/deterministic。

---

## 12. STT 与录音（v1 保留）

- `lib/stt`：`SttClient`/`SttTransport` 接口；`STT_PROVIDER∈{google_cloud, browser, off}`（默认 off）。`google_cloud`（M5a 用 v1 `speech:recognize` 默认/latest 模型，多语言 en-US/cmn-Hans-CN，opt-in，§3 隐私；v2/chirp_2 为后续细化）；`browser`（Web Speech 端上）；测试注入 `MockSttTransport`。
- 录音存 `recordings/YYYY-MM-DD/`，登记 `recording` 表（mime/语言/stt 状态等），关联 `practice_run`；默认语言英文。

---

## 13. 训练计划（v1 保留）

默认 15 天模板（通用化：去作者专属日期/slide 引用，保留"读材料→核心训练→AI 训练→复盘"每日结构）。当前 UI 支持 3–30 天；AI 可用时生成个性化计划，AI 关闭或生成失败时保存静态模板。

---

## 14. 配置与环境变量

```
# LLM —— AI 仅在 VIVA_AI_ENABLED=true 且 Gateway/key 就绪时启用；测试始终走 mock
VIVA_AI_ENABLED=true
VIVA_MODEL_DEFAULT=anthropic/claude-sonnet-4.6
VIVA_MODEL_HARD=anthropic/claude-opus-4.8
VIVA_MODEL_FAST=anthropic/claude-sonnet-4.6
AI_GATEWAY_API_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GOOGLE_VERTEX_PROJECT=
GOOGLE_APPLICATION_CREDENTIALS=
# STT（默认 off；google_cloud 为显式 opt-in）
STT_PROVIDER=off
GOOGLE_STT_API_KEY=
RECORDINGS_DIR=
# 测试 / DB
RUN_LIVE_AI=                   # 仅设为 1 时才发真实模型调用（对公开样本）
VIVA_DB_PATH=./data/d-viva-assistant-agent.sqlite
```
启动时做 config 校验（缺失/冲突给清晰报错）；日志对密钥脱敏（P1-12）。**当前有效启用 = `VIVA_AI_ENABLED=true` 且解析到 provider key 且 `AI_GATEWAY_API_KEY` 存在**；否则返回 disabled client。`RECORDINGS_DIR` 由 `src/lib/stt/path.ts` 直接解析，空值回退到 `./recordings`。

---

## 15. 测试策略

- **单元**：ingest 切块 + 质量报告、prep-pack zod 校验、`validator`（含关键数字绑定）、judge 输出解析、五维路由、迁移/repository。
- **集成**：导入→生成→训练→判分 happy path，**注入 `MockLlmClient`/`MockSttClient`**（确定性 fixture）。加断言：常规测试**无法**解析到真实 key（P1-13）。
- **供应商 conformance canary（P1-4）**：judge/prep schema 跨 provider 结构化输出（env-gated）。
- **生产编译**：涉及路由/config/打包时跑 `npm run build`。
- **真实 AI 冒烟**：`RUN_LIVE_AI=1` 才发一次真实调用，对公开样本。

---

## 16. 样本论文

公开样本 fixture 仍未落地；当前 README 明确标为 known limitation。真实 AI/STT 冒烟只能用公开样本内容，不能用个人论文数据。

---

## 17. 风险与开放问题（评审后状态）

- **PDF 抽取质量**：已加质量报告 + 质量门（§9），Markdown/文本为可靠主路径。
- **生成幻觉**：已加关系型证据绑定 + 落库前校验器 + 关键数字归一化（§6）。
- **跨 provider 结构化输出**：当前运行态经 AI Gateway 走统一 `lib/llm`；真实跨 provider 仍需 env-gated canary 验证（§8/§15）。
- **Next.js + better-sqlite3**：已定 runtime/打包/单例边界（§4），`npm run build` 与 Electron standalone 包装已跑通。
- **五维 rubric**：已落为 `evidence|clarity|completeness|boundary|delivery`，低分理由进入 review queue。
- **AI SDK / Next API**：当前实现使用 `ai` 包与 Next 16；未来升级仍需官方文档校准，不凭记忆写。

---

## 18. 协作模型 — Claude ↔ Codex 互评（沿用"老流程"）

沿用 academic-agent 的双向互评（契约见仓库根 `AGENTS.md`）。GOAL-M0 原文：执行 = **Claude 编排+验证 + Codex 实现（仓库读写）**：
- **Codex 实现**（TDD、每任务提交，经 `codex-companion task --write`）；**Claude 编排+验证**——跑 `npm test`/`typecheck`/`lint`（Codex 沙箱跑不了），读 diff 批判性 review，查 fidelity。
- **双向回喂**：Claude 把发现回喂 Codex 修；Claude 自己改则让 Codex review 修订。一来一回直到 **双方+测试一致** 才算 Done。**绿测试 ≠ Done**。
- 复查一律开新线程（`--fresh`）；Codex 启动注意 `service_tier` 须 fast/flex。
- 可选：实现期开 stop 前强制评审 gate（`/codex:setup --enable-review-gate`）。

---

## 19. 里程碑（M0 前置去风险，P1-14）

- **M0 地基（拆三个小 spike，避免单 sprint 过载 — 复评#4）**：
  - **M0a 运行时+env**：脚手架；Next/better-sqlite3 runtime spike + `next build` 冒烟；隐私/env 契约 + config 校验；`AGENTS.md` + lint。
  - **M0b DB+证据 DDL**：schema（FK/约束/索引/`foreign_keys=ON`）+ 迁移；evidence_unit + join 表（复合 PK/级联/同论文不变式）+ FTS5 同步/重建。
  - **M0c LLM+校验**：`LlmClient` + `model-registry` + `MockLlmClient`；跨 provider 结构化输出 canary；分级 validator。
- **M1**：ingest（extract + 质量报告 + chunk + FTS）。
- **M2**：prep-pack（generation_run + 生成 + 校验器）。
- **M3**：考官（检索/覆盖）+ 判分（五维）。
- **M4**：训练/复盘 UI（专注模式 + 低分队列）。
- **M5**：STT/录音（含 MockStt）。
- **M6**：计划 + 设置 + 内容准确性面板 + 打磨。
- 每个里程碑内置 Codex 互评 gate。

---

## 20. 评审修订记录

- **2026-06-23 Codex 设计互评（CONDITIONAL GO）** 并入：
  - P0-1 隐私/网络边界 → §3「本地优先 + 云 AI 可选并明告」+ §14 去除真实项目 id、默认 STT off、密钥脱敏。
  - P0-2 证据绑定可强制 → §6 evidence_unit 改 ingest-only + 关系型 join 表 + 关键数字归一化 + 落库前 validator。
  - P1：better-sqlite3/Next runtime 边界(§4)、schema 约束/迁移(§6)、单篇活跃语义(§6)、FTS/检索(§6/§11)、generation_run(§6/§10)、recording 字段(§6/§12)、注入式 Mock 客户端(§5/§8/§15)、M0 前置去风险(§19)、conformance canary(§8/§15)、env 安全默认(§14)。
  - P2：enum 归一(§6)、编辑退回 needs_review(§6)、计划晚做打磨(§13)、内容准确性面板定义(§7)。
- **2026-06-23 Codex 复评（fresh thread，CONDITIONAL GO → 已并入）**：P0-1 判 **CLOSED**；P0-2 由 PARTIAL 补强至闭合 —— join 表 DDL 不变式（复合 PK/级联/同论文/最小基数/`foreign_keys=ON`）+ **校验器分级**（L1–L3 确定性才 `verified`，L4 LLM 仅建议）；generation/validation provenance（`generation_run_id` + `validation_status`/`validator_version`）；FTS5 + 触发器同步 + 仅 Node 运行（当前迁移为内容表而非 external-content）；**M0 拆 M0a/M0b/M0c**；recording 单向 FK；env 有效启用语义；枚举归一（`generation_run.kind`/`question_kind`/`dimension`/`language_mode`）。

---

## 21. 下一步

1. 继续以 `README.md` + `docs/PROJECT_STATUS.md` 作为当前运行态入口。
2. 后续功能变更按 AGENTS.md 的 doc-sync 集合同步：spec / plans / code / env / README 一起更新。

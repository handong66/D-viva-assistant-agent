# viva-assistant · 通用论文答辩准备应用 — v1 设计 (Spec)

- 日期：2026-06-23
- 状态：设计待用户确认（brainstorming 产出）。**已过一轮 Codex 设计互评（CONDITIONAL GO）**，两个 P0 + 关键 P1/P2 已并入本版（见 §20 修订记录）。
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
| AI 供应商 | 供应商无关，AI SDK `"provider/model"` 字符串 + Gateway-ready；Gemini/GCP 一等支持 |
| 迁移打法 | 干净重构（参考旧 app 思路，不照搬代码） |
| 技术栈 | Next.js (App Router) + AI SDK v6 + better-sqlite3 + Tailwind/shadcn |
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
- **AI 是可选外呼**：仅当解析到 provider key 时启用；无 key → 优雅禁用（仍可练习、保留 transcript/录音，不出 AI 分）。
- **明告（disclosure）**：设置页与首次启用时明确告知"会把哪些内容（论文摘录 / 题目 / 你的回答 / 转写稿）发给哪个供应商"，用户确认后才外呼。
- **STT**：默认 `off`；`browser`（端上 Web Speech）；`google_cloud`（显式 opt-in，需 GCP 凭证）。
- **密钥**：`.env.example` 只放空占位（**不含**任何真实项目 id）；真实值（如你的 GCP 项目 `viva-496115`）放 gitignored 的 `.env.local`。日志对密钥脱敏。真实模型调用仅 `RUN_LIVE_AI=1` 且对公开样本。

---

## 4. 技术栈

- **Next.js (App Router) + TypeScript** — 前后端一体，Server Actions / Route Handlers 承接服务端逻辑。
- **AI SDK v6（`ai`）** — 供应商无关；`generateObject` + zod 拿结构化判分/生成结果；`"provider/model"` 字符串经 AI Gateway，或 `@ai-sdk/google` / `@ai-sdk/google-vertex` / `@ai-sdk/anthropic` / `@ai-sdk/openai` 直连。
- **better-sqlite3** — 本地单文件库，同步 API。**Next.js 边界（P1-5）**：仅 Node runtime（触库的 route/action 标 `export const runtime = "nodejs"`）；`next.config` 设 `serverExternalPackages: ["better-sqlite3"]`；db 模块 `import "server-only"`；开 WAL；用 `globalThis` 单例防 HMR 多实例；M0 跑一次 `next build` 冒烟。
- **Tailwind CSS + shadcn/ui** — 组件层。
- **zod** — schema 校验（贯穿 LLM 输出、ingest、API 边界）。
- **unpdf**（PDF 文本抽取，按页）— Markdown/TXT 直通。
- **vitest** + **Playwright** — 单元/集成 + 端到端（默认 mock LLM，不调真实模型）。

---

## 5. 架构与模块边界

```
app/                     Next.js App Router（页面 + Server Actions / Route Handlers，触库处 runtime=nodejs）
  import / today / materials / practice / review / library / settings
lib/
  llm/
    model-registry.ts    按角色 role 从 env 解析 provider/model（fast/default/hard）
    client.ts            LlmClient 接口 + AI SDK 实现：generateObject/generateText + 重试/超时/降级 + ai_call_log
    mock.ts              MockLlmClient（确定性 fixture，测试默认注入）
    judge.ts / examiner.ts / prep-pack.ts
  ingest/
    extract.ts           PDF/MD/TXT → 段落（+ 质量报告）
    chunk.ts             段落 → thesis_chunk + evidence_unit（ingest-only 主证据）
  evidence/
    retrieval.ts         基于 evidence_fts(FTS5) 的检索 + 章节覆盖度
    validator.ts         落库前校验：绑定存在性 + 关键数字值出现在绑定证据文本中
  stt/
    index.ts / mock.ts   SttClient 接口 + google_cloud|browser|off + MockSttClient
  plan/                  多日训练计划模板（默认 15 天，可编辑/重生成）
db/
  client.ts              better-sqlite3 单例（server-only, WAL, HMR guard）
  schema.ts              建表 DDL（FK/约束/索引）
  migrations/            numbered 迁移 + schema_migrations 版本表
  repository.ts          所有读写封装（无裸 SQL 散落）；解析 active thesis
  seed-sample.ts         载入公开样本论文 fixture（开发用）
samples/                 公开样本论文（文本 fixture）+ 生成包快照
```

**与参考 app 映射**：`lib/llm/judge`←`ai-judge.ts`；`lib/llm/examiner`←`examiner-generator.ts`；`lib/llm/prep-pack`←手写 `training_materials/*.md`（改为 AI 生成）；`lib/ingest`←`thesis-evidence.ts` 的 `buildChunks`（丢 docx+Python）；`lib/stt`←`server/stt.ts`；`db`←`server/schema.ts`；`app/*`←`src/main.tsx`（拆成干净组件）。

---

## 6. 数据模型（SQLite，含约束/迁移）

> v1 单篇，但带 `thesis_id` 以便将来多篇。所有表有 PK、FK、NOT NULL 约束 + 必要索引；演进经 `db/migrations/` + `schema_migrations` 版本表（P1-6）。

**核心实体**
- **thesis** — `id, title, author?, abstract?, source_kind(pdf|md|txt), source_meta(json), is_active, created_at, updated_at`。**单篇活跃语义（P1-7）**：partial unique index `WHERE is_active=1`；切换论文 = archive 旧、置新 active（repository 提供 `replaceActiveThesis`）。
- **thesis_chunk** — `id, thesis_id FK, section?, ord, text, char_count, hash`。
- **evidence_unit** — `id, thesis_id FK, chunk_id FK, section?, page?, char_start, char_end, text, hash`。**ingest-only 主证据（P0-2）**：只从论文原文抽取，绝不指向 AI 衍生物；去掉旧的多态 `ref_table/ref_id` 与 kind 漂移（P2-15）。
- **evidence_fts** — FTS5 虚表，索引 `evidence_unit.text`，供考官检索 + 覆盖度（P1-8）。

**生成与训练**
- **prep_item** — `id, thesis_id FK, type(digest|key_number|qa|hostile|theory_card|citation_card), title, body(json), value_numeric?, unit?, status(verified|needs_review|unsafe|draft), source(generated|edited|manual), created_at, updated_at, verified_at?`。`key_number` 用 `value_numeric/unit` 归一化（P0-2）。编辑正文 → 退回 `needs_review` 并重跑校验（P2-16）。
- **prep_item_evidence** — `prep_item_id FK, evidence_unit_id FK`（关系型绑定，替掉 `evidence_refs(json)`；P0-2）。
- **generation_run** — `id, thesis_id FK, kind, status(pending|running|done|error|canceled), evidence_snapshot_hash, item_type?, error?, retries, created_at`。承载进度 UI / 幂等 / 部分失败 / 重生成（P1-9）。
- **practice_run** — `id, thesis_id FK, question, question_kind, answer_text?, transcript?, recording_id? FK, scores(json), diagnosis?, rewrite?, follow_ups(json), status(practice|saved), created_at`。
- **practice_run_evidence** — `practice_run_id FK, evidence_unit_id FK`（题目绑定证据）。
- **review_item** — `id, thesis_id FK, practice_run_id FK, dimension, score, reason?, status(open|fixed), created_at`，unique(`practice_run_id`,`dimension`) 防重（P1-10：v1 先做精简低分队列；mastery/streak 等 v2）。
- **recording** — `id, thesis_id FK, practice_run_id? FK, path, mime, duration_ms, language_mode, stt_provider, stt_status(none|pending|ok|error), stt_error?, transcript?, transcript_edited(bool), created_at`（P1-11）。

**计划与系统**
- **plan** / **plan_day** — 多日计划模板（结构同前）。
- **ai_call_log** — `id, thesis_id?, purpose, provider, model, latency_ms, status(ok|error|timeout), error?, tokens(json), created_at`。
- **schema_migrations** / **app_meta** — 版本与杂项（源 hash 等）。

**五维评分（默认 rubric，实现期细化）**：① 证据/准确性（grounded, 数字不编） ② 清晰度 ③ 完整性 ④ 边界感（不过度声称） ⑤ 英文表达。每维 1–5；任一 ≤2 进复盘。

**落库前校验器（P0-2 核心）**：`evidence/validator.ts` 在保存生成内容/接受答案证据前确定性校验——绑定的 `evidence_unit_id` 存在且属本论文；`key_number` 的 `value_numeric/unit` 必须**出现在绑定证据文本**中；不满足 → 置 `needs_review`/`unsafe`，绝不 `verified`。

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

- `model-registry.ts`：按 `role`∈{`fast`,`default`,`hard`} 从 env 解析模型串（`VIVA_MODEL_DEFAULT/HARD/FAST`）。值形如 `google/gemini-2.5-flash`、`anthropic/claude-...`、`openai/...`；经 AI Gateway 或 provider 包直连。Gemini Vertex 经 `@ai-sdk/google-vertex` + env（**不硬编码项目 id**）。
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
- `judge.ts`：题目 + 绑定证据 + 回答（文本/transcript）→ 五维分 + 诊断 + 英文改写 + 追问，只据绑定证据判定。
- 路由：日常→`default`，高压/复杂→`hard`，轻量→`fast`/deterministic。

---

## 12. STT 与录音（v1 保留）

- `lib/stt`：`SttClient` 接口；`STT_PROVIDER∈{google_cloud, browser, off}`（默认 off）。`google_cloud`（chirp_2，多语言 en-US/cmn-Hans-CN，opt-in，§3 隐私）；`browser`（Web Speech 端上）；测试注入 `MockSttClient`。
- 录音存 `recordings/YYYY-MM-DD/`，登记 `recording` 表（mime/语言/stt 状态等），关联 `practice_run`；默认语言英文。

---

## 13. 训练计划（v1 保留）

默认 15 天模板（通用化：去作者专属日期/slide 引用，保留"读材料→核心训练→AI 训练→复盘"每日结构）。可编辑/重生成。**早期里程碑先 stub/静态（P2-17）**，待 judge+复盘稳定再做计划打磨。

---

## 14. 配置与环境变量（草案）

```
# LLM —— AI 仅在解析到 key 时启用；无 key 优雅降级；测试始终走 mock
VIVA_AI_ENABLED=true
VIVA_MODEL_DEFAULT=google/gemini-2.5-flash
VIVA_MODEL_HARD=google/gemini-2.5-pro
VIVA_MODEL_FAST=google/gemini-2.5-flash-lite
AI_GATEWAY_API_KEY=            # 走 Gateway 时
GOOGLE_GENERATIVE_AI_API_KEY=  # 或直连 provider（留空）
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
# Gemini Vertex（真实项目 id 放 .env.local，勿提交）
GOOGLE_VERTEX_PROJECT=         # e.g. 你的项目，仅本地
GOOGLE_VERTEX_LOCATION=global
# STT（默认 off；google_cloud 为显式 opt-in）
STT_PROVIDER=off
GOOGLE_APPLICATION_CREDENTIALS=
# 测试 / DB
RUN_LIVE_AI=                   # 仅设为 1 时才发真实模型调用（对公开样本）
VIVA_DB_PATH=./data/viva.sqlite
```
启动时做 config 校验（缺失/冲突给清晰报错）；日志对密钥脱敏（P1-12）。

---

## 15. 测试策略

- **单元**：ingest 切块 + 质量报告、prep-pack zod 校验、`validator`（含关键数字绑定）、judge 输出解析、五维路由、迁移/repository。
- **集成**：导入→生成→训练→判分 happy path，**注入 `MockLlmClient`/`MockSttClient`**（确定性 fixture）。加断言：常规测试**无法**解析到真实 key（P1-13）。
- **供应商 conformance canary（P1-4）**：judge/prep schema 跨 provider 结构化输出（env-gated）。
- **端到端**：Playwright 主路径（mock）。
- **真实 AI 冒烟**：`RUN_LIVE_AI=1` 才发一次真实调用，对公开样本。

---

## 16. 样本论文

开发期用一篇**公开可下载、开放许可**的硕/博论文做 fixture：转文本存 `samples/`，附生成包快照供断言。开工时提候选给用户拍板（或自带）。

---

## 17. 风险与开放问题（评审后状态）

- **PDF 抽取质量**：已加质量报告 + 质量门（§9），Markdown/文本为可靠主路径。
- **生成幻觉**：已加关系型证据绑定 + 落库前校验器 + 关键数字归一化（§6）。
- **跨 provider 结构化输出**：仍属假设 → M0 conformance canary 验证（§8/§15）。
- **Next.js + better-sqlite3**：已定 runtime/打包/单例边界（§4），M0 build 冒烟。
- **五维 rubric 具体维度**：默认草案，实现期细化。
- **AI SDK v6 / Next API**：实现前以官方文档/skill 校准，不凭记忆写。

---

## 18. 协作模型 — Claude ↔ Codex 互评（沿用"老流程"）

沿用 academic-agent 的双向互评（契约见仓库根 `AGENTS.md`）：
- Claude 实现（TDD、每任务提交，跑 `test`/`typecheck`/`lint`）；Codex 静态 review + `npx tsc --noEmit`。
- **每里程碑设 Codex 互评 gate**：实现 → Codex 新线程 review → 核实每条结论（grep/读码）→ 双方+测试一致才算 Done。**绿测试 ≠ Done**。
- 复查一律开新线程（`--fresh`）；Codex 启动注意 `service_tier` 须 fast/flex。
- 可选：实现期开 stop 前强制评审 gate（`/codex:setup --enable-review-gate`）。

---

## 19. 里程碑（M0 前置去风险，P1-14）

- **M0 地基**：脚手架 + Next/better-sqlite3 runtime spike + build 冒烟；DB schema（FK/约束/索引）+ 迁移；**evidence 关系模型 + validator**；`LlmClient` + `model-registry` + `MockLlmClient`；**跨 provider 结构化输出 canary**；隐私/env 契约 + config 校验；`AGENTS.md` + lint。
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

---

## 21. 下一步

1. 用户审阅本修订版 spec。
2. 可选：开新 Codex 线程复评 must-fix 是否闭合（老流程：复查用 fresh thread）。
3. 通过后进入 `writing-plans`，按 §19 里程碑产出实现计划，每里程碑内置 Codex 互评 gate。

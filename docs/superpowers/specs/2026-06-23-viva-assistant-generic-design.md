# viva-assistant · 通用论文答辩准备应用 — v1 设计 (Spec)

- 日期：2026-06-23
- 状态：设计待用户确认（brainstorming 产出，下一步进入实现计划）
- 来源：以 `MPhil-Thesis-fork/viva_prep/app`（Han Dong 硕士答辩训练 app）为参考蓝本，干净重构为面向**任意论文**的通用工具。

---

## 1. 背景与目标

参考 app 是一个为单篇硕士论文手工打造的答辩训练工具：Vite+React 前端 + Express+SQLite 服务端 + Gemini AI 判分 + 从论文证据块出题的 AI 考官 + 复盘闭环。它的 **UI / 功能 / 用户故事 / 数据模型**经过真实使用验证，但内容层、论文导入管线、AI 传输层都**写死在作者本人的论文**上。

**目标**：以参考 app 的产品形态为蓝本，从零搭一套干净代码，做成"喂进任意论文 → 自动生成备考工作区 → 实时 AI 考官出题判分 → 复盘修复"的通用本地应用。

**成功标准（v1）**：
1. 能导入一篇任意论文（PDF / Markdown / 纯文本），抽取并切成证据块。
2. 导入后 AI 自动生成一份备考包（论文摘要、关键数字、方法问答、高压问答、理论/文献卡）。
3. 实时 AI 考官能从论文证据出题，对用户回答做五维评分 + 诊断 + 英文改写 + 追问。
4. 支持打字/粘贴回答，**也支持录音 → STT 转写 → 判分**。
5. 低分项进入复盘修复板。
6. AI 供应商可配置（Gemini / Claude / OpenAI），无 key 时优雅降级。
7. 用一篇**公开论文**作为开发样本端到端跑通。

---

## 2. 已锁定决策

| 决策点 | 选择 |
|---|---|
| v1 形态 | 本地单用户工具，一次专注一篇论文（数据表结构允许多篇，UI 暂只暴露单篇） |
| 内容策略 | 混合：导入即 AI 生成备考包 + 保留实时考官 + 用户可编辑 |
| AI 供应商 | 供应商无关，AI SDK `"provider/model"` 字符串 + Gateway-ready；Gemini/GCP 一等支持 |
| 迁移打法 | 干净重构（参考旧 app 思路，不照搬代码） |
| 技术栈 | Next.js (App Router) + AI SDK v6 + better-sqlite3 + Tailwind/shadcn |
| STT + 录音 | **保留在 v1**（录音存档 → 转写 → 判分） |
| 训练计划 | 保留为多日训练计划功能（默认 15 天模板，可编辑/重生成，不写死日期） |
| Slides/讲稿系统 | **砍掉**（参考 app 本就 paused，且是"做 PPT 答辩"专属） |
| 个人数据 | **不迁移**。新 app 在全新文件夹建，绝不碰原 `viva_prep`；开发样本用公开论文 |

---

## 3. 非目标 / v1 边界（YAGNI）

- 不做多用户 / 登录 / 多租户 / 云存储（北极星，非 v1）。
- 不做 Slides/讲稿/计时/per-slide 训练。
- 不迁移作者个人论文、录音、训练记录、GCP 写死路径。
- 不依赖参考 app 的 docx + Python `lint_format` 论文管线（被通用导入替代）。
- 不做联网检索 / 协作 / 账号同步。

---

## 4. 技术栈

- **Next.js (App Router) + TypeScript** — 前后端一体，Server Actions / Route Handlers 承接服务端逻辑。
- **AI SDK v6（`ai`）** — 供应商无关；`generateObject` + zod 拿结构化判分/生成结果；`"provider/model"` 字符串经 AI Gateway，或 `@ai-sdk/google` / `@ai-sdk/google-vertex` / `@ai-sdk/anthropic` / `@ai-sdk/openai` 直连。
- **better-sqlite3** — 本地单文件库，同步 API，单机轻量。
- **Tailwind CSS + shadcn/ui** — 组件层（参考 app 是手写 CSS，重构换 shadcn）。
- **zod** — schema 校验（贯穿 LLM 输出、ingest、API 边界）。
- **unpdf**（或 pdf-parse）— PDF 文本抽取；Markdown/TXT 直通。
- **vitest** + **Playwright** — 单元/集成 + 浏览器端到端（沿用参考 app 测试理念：默认不调真实模型）。

---

## 5. 架构与模块边界

每个模块单一职责、通过明确接口通信、可独立测试。

```
app/                     Next.js App Router（页面 + Server Actions / Route Handlers）
  (onboarding/import)    导入论文 → 触发 ingest + 生成
  today / materials /
  practice / review /
  library / settings
lib/
  llm/                   供应商无关 LLM 客户端
    model-registry.ts    按角色(role)从 env 解析 provider/model（fast/default/hard）
    client.ts            generateJson()/generateText() 封装 AI SDK + 重试/超时/降级
    judge.ts             五维评分 + 诊断 + 英文改写 + 追问（绑定证据）
    examiner.ts          实时出题：随机/按章/跨章/高压/越界/追问
    prep-pack.ts         从证据块生成备考包（摘要/数字/问答/高压/理论卡）
  ingest/                论文导入
    extract.ts           PDF/MD/TXT → 段落
    chunk.ts             段落 → 证据块（借鉴参考 app 的 buildChunks 思路）
  stt/                   录音转写（google_cloud | browser WebSpeech | off）
    index.ts
  plan/                  多日训练计划模板（默认 15 天，可编辑/重生成）
db/
  schema.ts              建表 + 迁移
  repository.ts          所有读写封装（无裸 SQL 散落）
  client.ts              better-sqlite3 单例
  seed-sample.ts         载入公开样本论文 fixture（开发用）
samples/                 公开样本论文（文本 fixture）+ 其生成包快照
docs/superpowers/specs/  本设计文档
```

**与参考 app 的映射（借鉴思路，不照搬代码）**：

| 新模块 | 参考来源 | 关系 |
|---|---|---|
| `lib/llm/judge` | `server/ai-judge.ts` | 借 prompt/五维逻辑，重落 AI SDK |
| `lib/llm/examiner` | `server/examiner-generator.ts`, `mock-orchestrator.ts` | 借出题模式 |
| `lib/llm/prep-pack` | `training_materials/*.md`（手写内容） | **由 AI 生成替代手写** |
| `lib/ingest` | `server/thesis-evidence.ts` 的 `buildChunks` | 借切块逻辑，**丢弃 docx+Python** |
| `lib/stt` | `server/stt.ts` + `.env.example` STT 段 | 借 provider 设计 |
| `db/schema` | `server/schema.ts` | 借表结构，通用化 |
| `app/*` 页面 | `src/main.tsx`(3753 行) | 借 UI/用户故事，拆成干净组件 |

---

## 6. 数据模型（SQLite）

> v1 单篇论文，但表结构带 `thesis_id` 以便将来多篇。

- **thesis** — `id, title, author?, abstract?, source_kind(pdf|md|txt), source_meta(json), is_active, created_at, updated_at`
- **thesis_chunk** — `id, thesis_id, section?, ord, text, char_count, hash`
- **evidence_unit** — `id, thesis_id, kind(thesis_chunk|key_number|qa|hostile|theory|citation), ref_table, ref_id, text, locator?` （统一证据，供考官/判分绑定）
- **prep_item** — `id, thesis_id, type(digest|key_number|qa|hostile|theory_card|citation_card), title, body(json), status(verified|needs_review|draft), source(generated|edited|manual), evidence_refs(json), created_at`
- **plan** — `id, thesis_id, name, total_days, template_key`
- **plan_day** — `id, plan_id, day_no, title, focus, blocks(json), materials(json), evidence_targets(json)`
- **practice_run** — `id, thesis_id, question, question_kind, evidence_refs(json), answer_text?, transcript?, recording_id?, scores(json), diagnosis?, rewrite?, follow_ups(json), status(practice|saved), created_at`
- **review_item** — `id, thesis_id, practice_run_id, dimension, score, status(open|fixed), created_at`
- **recording** — `id, thesis_id, practice_run_id?, path, duration_ms, transcript?, created_at`
- **ai_call_log** — `id, thesis_id?, purpose, provider, model, latency_ms, status(ok|error|timeout), error?, tokens(json), created_at`
- **app_meta** — `key, value`（源 hash、schema 版本等）

**五维评分（默认 rubric，可配置）**：① 证据/准确性（grounded, 数字不编） ② 清晰度 ③ 完整性 ④ 边界感（不过度声称） ⑤ 英文表达。每维 1–5；任一 ≤2 自动进复盘。

---

## 7. 用户流程（v1）

```
①导入(新)   上传 PDF / 粘贴 MD·TXT + 填标题 → extract → chunk → 落 thesis_chunk + evidence_unit
②生成        AI 备考包(进度UI) → digest/key_number/qa/hostile/theory/citation（带状态+证据引用）
③今日        概览 + 推荐训练（多日计划模板，默认 15 天）
④材料        读生成包；可编辑/校准/改状态；可整体重生成
⑤训练(专注)  选题 or "让 AI 考官从论文出题"
            → 回答：打字/粘贴 或 录音→STT 转写
            → AI 判分（五维 + 诊断 + 英文改写 + 追问）→ 保存；任一≤2 进复盘
⑥复盘修复    刷弱项修复板
⑦资料库/设置  论文信息、录音档案、AI 供应商/模型配置、内容准确性面板、重新生成、计划编辑
```

---

## 8. LLM 供应商无关层（detail）

- `model-registry.ts`：按 `role` ∈ {`fast`,`default`,`hard`} 从 env 解析模型字符串。
  - `VIVA_MODEL_DEFAULT`（日常 Q&A），`VIVA_MODEL_HARD`（高压/复杂统计/理论），`VIVA_MODEL_FAST`（轻量数字/危险表达检查）。
  - 值形如 `google/gemini-2.5-flash`、`anthropic/claude-...`、`openai/...`；经 AI Gateway（`AI_GATEWAY_API_KEY`）或对应 provider 包直连。
  - Gemini Enterprise/Vertex（用户现成 GCP `viva-496115`）：经 `@ai-sdk/google-vertex` + ADC/project，env 配置，**不硬编码**。
- `client.ts`：统一超时（默认 25s）、重试、错误归一化；每次调用写 `ai_call_log`。
- **降级**：无任何可用 key 时，`VIVA_AI_ENABLED=false` 或自动判定 disabled——用户仍可练习、保留 transcript/录音，但不出 AI 分数（对齐参考 app 行为）。
- 轻量数字/危险表达检查优先走 deterministic 代码，必要时才调模型（省钱）。

---

## 9. 论文导入管线（detail）

替掉参考 app 写死的 `docx → python3 unpack_thesis.py → lint_format.extract_streams` 那套。

- `extract.ts`：
  - PDF → `unpdf` 抽文本（按页/按段）。
  - Markdown/TXT → 直接读，按标题/空行切段。
  - 产出标准化 `Paragraph[]`（text + 可选 section）。
- `chunk.ts`：段落 → 证据块（控制 token 颗粒度，记录 `ord`/`hash`/`section`），落 `thesis_chunk`，并为每块建 `evidence_unit(kind=thesis_chunk)`。
- 失败兜底：PDF 抽取质量差时提示用户改用"粘贴文本/Markdown"路径（最稳）。

---

## 10. 备考包生成（detail）

- `prep-pack.ts`：输入证据块，分类型调用 LLM（`generateObject` + zod schema）生成：
  - `digest`（论文摘要：研究问题/方法/贡献/局限）
  - `key_number`（关键数字卡：数值 + 出处证据，**强制绑定 evidence**，避免幻觉数字）
  - `qa`（方法问答库）、`hostile`（高压问答）、`theory_card`、`citation_card`
- 每条 `prep_item` 带 `status`（默认 `needs_review`，用户校准后置 `verified`）+ `evidence_refs`。
- 生成是辅助、不是事实真源：所有题目/卡片必须可回溯到 evidence_unit。
- 可整体或按类型**重新生成**。

---

## 11. 考官与判分（detail）

- `examiner.ts`：出题模式——整篇随机 / 按章 / 跨章综合 / 高压 / 越界 / 基于上一轮回答的追问。每道题绑定若干 `evidence_unit`。
- `judge.ts`：输入题目+绑定证据+用户回答（文本或 transcript），输出五维分 + 诊断 + 英文改写 + 追问。只依据绑定证据判定。
- 模型路由：日常→`default`，高压/复杂→`hard`，轻量检查→`fast`/deterministic。

---

## 12. STT 与录音（v1 保留）

- `lib/stt`：`STT_PROVIDER ∈ {google_cloud, browser, off}`。
  - `google_cloud`：沿用参考 app 设计（chirp_2，多语言 en-US/cmn-Hans-CN），需 GCP 凭证。
  - `browser`：Web Speech API 零依赖兜底。
  - `off`：仅打字/粘贴。
- 录音文件存 `recordings/YYYY-MM-DD/`，登记 `recording` 表，关联 `practice_run`。
- 默认语言模式英文（答辩输出语言）。

---

## 13. 训练计划（v1 保留）

- 默认 15 天模板（通用化：去掉作者专属日期/slide 引用，保留"读材料→核心训练→AI 训练→复盘"的每日结构）。
- 可编辑、可按论文/时间线重新生成。
- "今日"页据当前进度推荐训练。

---

## 14. 配置与环境变量（草案）

```
# LLM
VIVA_AI_ENABLED=true
VIVA_MODEL_DEFAULT=google/gemini-2.5-flash
VIVA_MODEL_HARD=google/gemini-2.5-pro
VIVA_MODEL_FAST=google/gemini-2.5-flash-lite
AI_GATEWAY_API_KEY=            # 走 Gateway 时
# 或直连 provider（AI SDK 约定）
GOOGLE_GENERATIVE_AI_API_KEY=
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
# Gemini Enterprise/Vertex（用户现成 GCP）
GOOGLE_VERTEX_PROJECT=viva-496115
GOOGLE_VERTEX_LOCATION=global
# STT
STT_PROVIDER=off              # google_cloud | browser | off
GOOGLE_APPLICATION_CREDENTIALS=
# DB
VIVA_DB_PATH=./data/viva.sqlite
```

---

## 15. 测试策略

- **单元**：ingest 切块、prep-pack zod 校验、judge 输出解析、证据绑定、五维路由。
- **集成**：导入→生成→训练→判分 happy path，**默认 mock LLM**（确定性 fixture，不烧钱）。
- **端到端**：Playwright 跑导入→练习→判分→复盘主路径（mock LLM）。
- **真实 AI 冒烟**：env-gated（如 `RUN_LIVE_AI=1`）才发一次真实模型调用。

---

## 16. 样本论文

开发期用一篇**公开可下载、开放许可**的硕/博论文 PDF 做 fixture：转成文本存 `samples/`，附其生成包快照供测试断言。具体选哪篇在开工时提候选给用户拍板（或用户自带）。

---

## 17. 风险与开放问题

- **PDF 抽取质量**：学术 PDF 排版复杂（公式/表格/双栏）。缓解：Markdown/文本粘贴作为可靠主路径，PDF 为便利路径。
- **生成内容幻觉**：关键数字/引用必须绑定 evidence，UI 标注来源；默认 `needs_review`。
- **五维 rubric 具体定义**：当前为默认草案，实现计划阶段细化。
- **多 provider 模型名漂移**：模型字符串集中在 `model-registry` + env，便于更新。
- **AI SDK v6 / Next 版本兼容**：实现前以官方文档/skill 校准，不凭记忆写 API。

---

## 18. 协作模型 — Claude ↔ Codex 互评（沿用"老流程"）

沿用 academic-agent 的 Claude↔Codex 双向互评（契约见仓库根 `AGENTS.md`）：

- Claude 实现（TDD、每任务提交，跑 `test`/`typecheck`/`lint`）；Codex 静态 review + `npx tsc --noEmit`（沙箱跑不了 npm/vitest）。
- **每个里程碑结束设 Codex 互评 gate**：Claude 实现 → Codex 新线程 review → 核实每条结论（grep/读码）→ 双方 + 测试一致才算 Done。**绿测试 ≠ Done**。
- 复查一律开新线程（`--fresh`）；Codex 启动注意 `service_tier` 必须 fast/flex。
- 可选：实现期开启 stop 前强制评审 gate（`/codex:setup --enable-review-gate`）。

## 19. 下一步

1. 用户审阅本 spec。
2. 通过后进入 `writing-plans`，产出分阶段实现计划，**每个里程碑内置 Codex 互评 gate**（建议里程碑：M0 脚手架+DB+AGENTS/lint → M1 ingest → M2 prep-pack → M3 考官+判分 → M4 训练/复盘 UI → M5 STT/录音 → M6 计划/设置/打磨）。

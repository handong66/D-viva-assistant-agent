# AGENTS.md — D-viva-assistant-agent Cold-Start Contract

> 给 Claude 和 Codex 的最小冷启动契约。90 秒读完即可做安全工作。详情在设计 spec 与 `docs/superpowers/plans/`。
> 项目：通用论文答辩准备应用（任意论文 → AI 备考包 + 实时考官 + 五维判分 + 复盘）。从 `MPhil-Thesis-fork/viva_prep` 干净重构而来。

## Red Lines — 没读别的也要守
1. **证据绑定，不编事实。** 每条生成内容（尤其关键数字、引用）和每道考题都必须绑定 ingest 出的 `evidence_unit`；judge/examiner **只依据绑定证据**判定，不靠模型先验。(spec §10/§11)
2. **LLM 走统一层。** 所有模型调用经 `lib/llm`（`model-registry` + `client`）；**不在各处散落 provider SDK 调用**；模型名只在 env，不硬编码。(spec §8)
3. **本地优先、单用户、零个人数据。** 数据/DB/录音留本机、不上云同步、不做账号；AI/STT 是把文本发给你配置的供应商的**可选外呼**（有 key 才启用、UI 明告会发什么给谁）。绝不迁移或提交个人论文数据、录音、密钥；`.env*` / `data/` / `recordings/` 已 gitignore。(spec §3)
4. **AI 优雅降级。** 无可用 key → AI disabled，app 仍可用（练习 + transcript），不崩。(spec §8)
5. **测试默认不调真实模型。** 集成用 mock LLM；真实调用仅在 env gate（如 `RUN_LIVE_AI=1`）下。(spec §15)

## 协作模型 — Claude ↔ Codex 互评（沿用 academic-agent 老流程）
双向互评。GOAL-M0 原文：执行 = **Claude（编排 + 验证）+ Codex（实现，仓库完整读写）**。
- **Codex 实现**（TDD、每任务一提交）——经 `codex-companion task --write`（仓库读写）。
- **Claude 编排 + 验证**：跑 `npm test`/`typecheck`/`lint`（Codex 沙箱跑不了 npm/vitest，所以测试由 Claude 跑），读 diff 批判性 review，对照 spec/plan 查 fidelity，主动找 bug 类。
- **回喂修复（双向）**：Claude 把 review 发现回喂 Codex 修；若 Claude 自己动手改，则让 Codex review Claude 的修订。一来一回直到 **双方 + 测试三者一致** 才算该段 Done。**绿测试 ≠ Done**。
- **复查一律开新 Codex 线程（`--fresh`）**：续接旧线程会上下文漂移、虚构 bug；对 Codex 每条结论先 grep/读码核实再采纳。
- Codex 启动注意 `service_tier` 必须 `fast`/`flex`（否则起不来）。

## Doc-sync 一致性集 — 改一个必须一起改
- 设计 spec (`docs/superpowers/specs/2026-06-23-D-viva-assistant-agent-generic-design.md`) ↔ plan (`docs/superpowers/plans/…`) ↔ 代码。
- DB schema (`src/db/migrations/*.ts`，嵌入式 TS 迁移；无 `db/schema.ts`) ↔ spec §6 数据模型。
- env 契约 (`.env.example`) ↔ spec §14。

## Naming Policy
- `VIVA_*` env var names are intentionally stable for compatibility and because `viva` is domain language; do not rename them without a separate compatibility migration plan.

## Canonical commands
- `npm run dev` · `npm test`(vitest) · `npm run typecheck`(tsc) · `npm run lint` · `npm run build`

## What this file is not
不是 spec，不是实现计划，不是变更日志。详情归 spec / plan。本文件随脚手架演进。

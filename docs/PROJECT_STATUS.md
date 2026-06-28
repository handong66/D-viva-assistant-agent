# D-viva-assistant-agent Project Status

Last verified from the local repository on 2026-06-28.

## Project Identity

- GitHub repository: `handong66/D-viva-assistant-agent`
- npm package: `d-viva-assistant-agent`
- Electron product name: `D-viva-assistant-agent`
- Electron appId: `com.handong66.dvivaassistantagent`
- Default web/dev database: `./data/d-viva-assistant-agent.sqlite`
- Default Electron database: `<Electron userData>/d-viva-assistant-agent.sqlite`
- macOS Electron data directory: `~/Library/Application Support/D-viva-assistant-agent/`
- `VIVA_*` environment variable names remain stable for compatibility; only their default values changed where they encode the project identity.

## Implemented

- **Foundation:** Next.js App Router, TypeScript, Tailwind CSS, Vitest, local `better-sqlite3`, embedded migrations, WAL/foreign-key setup, and a unified repository layer.
- **Config:** `.env.example` covers AI, STT, DB, recordings, and live-test gates. Most runtime config is parsed in `src/lib/config.ts`; `RECORDINGS_DIR` is resolved in `src/lib/stt/path.ts`.
- **LLM boundary:** all model calls go through `src/lib/llm`; role-to-model resolution is environment-driven; tests use mock clients by default.
- **Import:** `/import` accepts Markdown, plain text, and PDF. Ingest creates chunks and evidence units from source text.
- **Evidence:** `evidence_unit` is ingest-only source evidence; prep items and practice runs bind through relational join tables; FTS5 is synced by triggers.
- **Library:** `/library` lists imported theses, switches the active thesis, shows AI/STT disclosure text, and shows content-accuracy counters.
- **Dashboard:** `/` shows active thesis state, recommended next action, plan day, and prep/practice/review stats.
- **Materials:** `/materials` generates an AI prep pack when AI is ready, lists item status, and exposes per-item edit/revalidation pages.
- **Validator:** deterministic checks can verify numeric values and exact quotes against bound evidence. Broader paraphrases stay in review unless provable.
- **Practice:** `/practice` generates AI examiner questions in selectable modes, with optional topic scoping through local FTS retrieval.
- **Judge:** answers are scored on evidence, clarity, completeness, boundary, and delivery; low dimensions get stored reasons.
- **Review:** `/review` shows open low-score dimensions for targeted practice.
- **Training plan:** `/plan` saves AI-generated plans when AI is ready and static N-day plans when AI is disabled or generation fails.
- **STT:** typed answers, browser speech recognition, and Google Cloud STT are supported behind `STT_PROVIDER`.
- **Desktop:** `npm run electron:pack` builds an unsigned macOS `.app` that starts the packaged Next server locally and stores app data under Electron `userData`.

## Current Boundaries

- Local single-user app only; no accounts, sync, multi-user permissions, or cloud persistence.
- AI is optional and disabled unless the effective config is ready. The current runtime still requires `AI_GATEWAY_API_KEY` before constructing the LLM client.
- Browser STT uses the browser vendor's speech recognition stack; Google Cloud STT sends recorded audio to Google after writing it locally.
- Google Cloud STT uses synchronous recognition and is not the path for long answers.
- PDF extraction can be imperfect; Markdown/plain text remains the reliable import fallback.
- Electron packaging is macOS-focused and unsigned.
- The design spec still contains some forward-looking implementation notes; use code plus README for the current runtime snapshot.
- Existing local data from the prior project identity is not migrated automatically; preserve it by manually copying or renaming the old SQLite file into the new default path.
- Existing untracked `.env.local` files that pin `VIVA_DB_PATH=./data/viva.sqlite` continue to use that old path until manually updated.

## Verification Commands

Use the standard local gate:

```bash
npm run check
```

Expanded form:

```bash
npm run typecheck
npm run lint
npm test
```

Run this after route/config/packaging changes:

```bash
npm run build
```

Run this only for desktop packaging work:

```bash
npm run electron:pack
```

Tests should not call real AI or STT by default. Live AI checks require `RUN_LIVE_AI=1` and public sample content.

## Documentation Sync Points

Update documentation in the same change when touching:

- `src/db/migrations/*.ts`: sync data-model notes in the spec and README.
- `.env.example` or `src/lib/config.ts`: sync the environment section in README.
- `src/lib/llm/*`: sync AI boundary and privacy notes.
- `src/lib/stt/*` or recording actions: sync STT/privacy notes.
- `src/app/*` user flows: sync README product flow and this status file when the user-facing state changes.
- `electron/` or `scripts/pack-electron.mjs`: sync README desktop packaging notes.

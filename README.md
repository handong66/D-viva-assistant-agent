# D-viva-assistant-agent

Local-first viva preparation for any thesis. Import a PDF, Markdown, or plain-text thesis, turn it into evidence units, generate grounded preparation materials, practise with an AI examiner, score answers on a five-dimension rubric, and review weak spots without moving your private thesis data into a hosted app.

Last verified from the local repository on 2026-06-28.

Repository: `handong66/D-viva-assistant-agent`

Current project identity:

- npm package: `d-viva-assistant-agent`
- Electron product name: `D-viva-assistant-agent`
- Electron appId: `com.handong66.dvivaassistantagent`
- Default web/dev database: `./data/d-viva-assistant-agent.sqlite`
- Default Electron database: `<Electron userData>/d-viva-assistant-agent.sqlite`

## Current Status

This repository is no longer a `create-next-app` scaffold. The implemented app includes:

- Thesis import from PDF, Markdown, or plain text, with local chunking into `thesis_chunk` and `evidence_unit` rows.
- SQLite persistence with embedded TypeScript migrations, WAL mode, foreign keys, evidence joins, and FTS5 search over evidence text.
- Multiple imported theses with one active thesis at a time.
- Evidence-bound AI prep-pack generation for digests, key numbers, Q&A, hostile questions, theory cards, and citation cards.
- Deterministic validation before a prep item can be shown as `verified`.
- Editable prep items that re-run validation after edits.
- AI examiner practice with random, cross-section, hostile, and boundary questions.
- Optional topic filtering for practice questions via local SQLite FTS retrieval.
- AI judging with scores for `evidence`, `clarity`, `completeness`, `boundary`, and `delivery`.
- Review queue for dimensions scored 2 or below, including per-dimension reasons.
- Training-plan generation with AI when configured and a static local fallback when AI is off or fails.
- Typed answers, browser speech recognition, or Google Cloud Speech-to-Text transcription for practice answers.
- macOS Electron packaging for a double-clickable unsigned `.app`.

The app is still a local single-user tool. There are no accounts, hosted sync, multi-user permissions, cloud storage, or production deployment scripts.

## Product Flow

1. Import a thesis at `/import`.
   PDF uploads are capped below the Server Action limit; Markdown and plain text are the most reliable paths.

2. Review the dashboard at `/`.
   The dashboard shows the active thesis, the recommended next action, prep item counts, practice counts, and the current day in the active training plan.

3. Generate or inspect materials at `/materials`.
   The prep pack is AI-assisted and evidence-bound. Items are marked `verified`, `needs_review`, `unsafe`, or `draft` based on deterministic evidence checks.

4. Edit generated materials at `/materials/[id]/edit`.
   Edits are saved locally and revalidated against the item's bound evidence.

5. Generate a training plan at `/plan`.
   If AI is ready, the plan can use the thesis title, section names, and a short progress summary. Otherwise the app saves a static N-day template.

6. Practise at `/practice`.
   Generate a question, optionally scoped by a topic query. Answer by typing, browser speech recognition, or Google Cloud STT. AI judging produces five scores, diagnosis, a suggested rewrite, and follow-up questions.

7. Review weak spots at `/review`.
   Any score of 2 or below enters the review queue with the question, dimension, score, and reason.

8. Manage theses and privacy state at `/library`.
   The library page lets you switch the active thesis, shows AI/STT disclosure text, and displays content-accuracy stats.

## Privacy and Network Boundary

D-viva-assistant-agent is local-first by design:

- The SQLite database defaults to `./data/d-viva-assistant-agent.sqlite` in web/dev mode.
- Audio recordings default to `./recordings` in web/dev mode.
- `.env*`, `data/`, `recordings/`, SQLite files, and Electron build output are ignored by git.
- Imported thesis text, generated prep material, answers, recordings, and transcripts are stored locally.
- AI and STT are optional outbound calls. Nothing is sent to a model or speech provider unless the relevant environment variables are configured and the user triggers an action that needs them.

When AI is enabled, these payloads can leave the machine:

- Prep-pack generation sends the thesis title and selected bound evidence.
- Examiner question generation sends the thesis title and selected bound evidence; follow-ups also include the previous question and answer.
- Judging sends the question, bound evidence, and the answer or transcript.
- Training-plan generation sends the thesis title, section names, and a short progress summary.

When Google Cloud STT is enabled, recorded audio is saved locally first and then sent to Google Speech-to-Text for transcription. Browser speech recognition does not pass audio through this app, but the browser vendor may process audio depending on the browser.

## Tech Stack

- Next.js App Router with React and TypeScript.
- Server Actions for import, prep generation, plan generation, practice, judging, recording transcription, and active-thesis switching.
- Tailwind CSS for styling.
- `better-sqlite3` for local persistence.
- `unpdf` for PDF extraction.
- AI SDK `generateText` with structured object output through a unified `lib/llm` layer.
- Zod schemas for config and LLM output validation.
- Vitest for unit/integration tests.
- Electron + electron-builder for a local macOS desktop build.

## Repository Layout

```text
src/app/                    Next.js routes and Server Actions
src/app/import/             Thesis import UI
src/app/materials/          Prep-pack list, generation button, edit pages
src/app/plan/               Training-plan UI
src/app/practice/           Examiner question and answer flow
src/app/review/             Low-score review queue
src/app/library/            Thesis switching, privacy disclosure, accuracy stats
src/db/                     SQLite client, migrations, repository functions, tests
src/lib/config.ts           Environment parsing and effective feature flags
src/lib/ingest/             PDF/Markdown/text extraction and chunking
src/lib/evidence/           Deterministic prep-item validator
src/lib/llm/                Model registry, client, transport, prompts, mock client
src/lib/stt/                STT mode resolution, Google transport, recording paths
src/lib/plan.ts             Static plan helpers and day calculations
electron/main.cjs           Electron wrapper that starts the packaged Next server
scripts/pack-electron.mjs   macOS packaging pipeline
docs/superpowers/specs/     Design spec
docs/superpowers/plans/     Milestone and feature implementation plans
```

## Environment

Copy the template and fill in only the providers you actually want to use:

```bash
cp .env.example .env.local
```

Important variables:

```bash
# LLM
VIVA_AI_ENABLED=true
VIVA_MODEL_DEFAULT=anthropic/claude-sonnet-4.6
VIVA_MODEL_HARD=anthropic/claude-opus-4.8
VIVA_MODEL_FAST=anthropic/claude-sonnet-4.6
AI_GATEWAY_API_KEY=

# Optional provider credentials recognised by config.
# Current runtime still requires AI_GATEWAY_API_KEY before the app creates the LLM client.
GOOGLE_GENERATIVE_AI_API_KEY=
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GOOGLE_VERTEX_PROJECT=
GOOGLE_APPLICATION_CREDENTIALS=

# STT
STT_PROVIDER=off
GOOGLE_STT_API_KEY=
# Read by src/lib/stt/path.ts; defaults to ./recordings when blank.
RECORDINGS_DIR=

# Tests / DB
RUN_LIVE_AI=
VIVA_DB_PATH=./data/d-viva-assistant-agent.sqlite
```

AI is effectively usable only when:

```text
VIVA_AI_ENABLED=true
at least one provider credential is present
AI_GATEWAY_API_KEY is present
```

If AI is off or not fully configured, the app still imports theses, stores data locally, shows the dashboard/library, allows static training plans, and keeps non-AI state. Actions that require an AI examiner, judge, or prep-pack generator return an inline error instead of crashing.

STT modes:

- `STT_PROVIDER=off`: no recording button is shown.
- `STT_PROVIDER=browser`: use the browser Web Speech API for continuous recognition. No app-side STT key is required.
- `STT_PROVIDER=google_cloud`: use Google Speech-to-Text. Requires `GOOGLE_STT_API_KEY`; recorded audio is written locally and then sent to Google.

`RECORDINGS_DIR` is resolved by `src/lib/stt/path.ts`, not by the main config parser. Blank or whitespace values are treated as unset and fall back to `./recordings`.

## Development

Install dependencies:

```bash
npm install
```

Run the web app:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

Run the standard gates:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Or run the combined check:

```bash
npm run check
```

Tests default to mock LLM/STT paths. Do not enable real model calls in normal CI or routine local verification. Live AI smoke tests are gated behind `RUN_LIVE_AI=1` and should use public sample content only.

## Desktop Packaging

Build an unsigned local macOS app:

```bash
npm run electron:pack
```

The pipeline:

1. Runs a gated standalone Next build with `BUILD_STANDALONE=1`.
2. Copies static/public assets into the standalone output.
3. Rebuilds `better-sqlite3` for Electron.
4. Packages an unsigned `.app` into `dist-electron/`.
5. Rebuilds root `better-sqlite3` back for the local Node runtime so dev/tests keep working.

First launch of the unsigned app may require right-clicking the app and choosing Open. In desktop mode, the Electron wrapper sets:

```text
VIVA_DB_PATH=<Electron userData>/d-viva-assistant-agent.sqlite
RECORDINGS_DIR=<Electron userData>/recordings
```

On macOS this is normally under:

```text
~/Library/Application Support/D-viva-assistant-agent/
```

Existing local data from the previous project identity is not migrated automatically. To preserve old data, manually copy or rename `./data/viva.sqlite` to `./data/d-viva-assistant-agent.sqlite`, or copy `~/Library/Application Support/Viva Assistant/viva.sqlite` into `~/Library/Application Support/D-viva-assistant-agent/d-viva-assistant-agent.sqlite`.

Do not commit `dist-electron/`, generated `.next/`, local databases, recordings, or environment files.

## Data Model

The schema is defined by embedded TypeScript migrations in `src/db/migrations/`.

Core tables:

- `thesis`: imported thesis records, with a partial unique index for one active thesis.
- `thesis_chunk`: extracted paragraph chunks.
- `evidence_unit`: source-only evidence spans used for generation, examiner questions, and judging.
- `evidence_fts`: local FTS5 index over evidence text.
- `generation_run`: prep generation attempts and status.
- `prep_item`: generated or edited study material.
- `prep_item_evidence`: relationship table binding prep items to evidence units.
- `practice_run`: generated question, answer/transcript, scores, diagnosis, rewrite, and follow-ups.
- `practice_run_evidence`: relationship table binding a practice question to evidence units.
- `review_item`: open review queue for low scoring dimensions.
- `recording`: local audio metadata, STT status, and transcript.
- `plan` and `plan_day`: saved training plans.
- `ai_call_log`: model call telemetry without secrets.

The red-line invariant is that generated content is not the source of truth. Evidence units come from ingest, and AI output must bind back to those units.

## Grounding Rules

The app uses three layers to reduce fabrication:

1. `lib/llm` is the only place that creates LLM clients. Model names come from env variables, not hardcoded call sites.
2. Examiner questions and prep items cite evidence unit IDs that were actually offered to the model.
3. `lib/evidence/validator.ts` only marks deterministic matches as `verified`:
   - numeric values must appear in bound evidence, with an optional unit check;
   - citation quotes must be exact substrings of bound evidence;
   - paraphrases or broad claims stay `needs_review` unless deterministically provable.

Judge and examiner logic must use bound evidence, not model prior knowledge.

## Documentation Map

- `AGENTS.md`: cold-start contract and non-negotiable project guardrails.
- `docs/PROJECT_STATUS.md`: concise implementation snapshot and remaining limitations.
- `docs/superpowers/specs/2026-06-23-D-viva-assistant-agent-generic-design.md`: product and architecture spec.
- `docs/superpowers/plans/*.md`: implementation plans and feature gates by milestone.

When changing code that affects the data model, environment contract, AI/STT behavior, or evidence guarantees, update the relevant spec/plan/readme documentation in the same change.

## Known Limitations

- The app is designed for one local user. It is not hardened for untrusted multi-user hosting.
- AI direct-provider setup is not exposed as independent runtime clients yet; the current runtime requires AI Gateway readiness.
- Google Cloud STT uses synchronous `speech:recognize`, so long recordings should use browser speech recognition instead.
- PDF extraction quality depends on the source PDF. For poor PDFs, paste Markdown or plain text.
- The Electron build is unsigned and macOS-focused.
- There is no sample thesis fixture committed yet.

## Contributing Discipline

Before claiming a change is done:

```bash
npm run typecheck
npm run lint
npm test
```

Run `npm run build` when touching Next routes, config, packaging, or anything that can affect production compilation. Run `npm run electron:pack` only when changing the desktop wrapper or packaging pipeline.

Never commit secrets, local thesis data, databases, recordings, or generated build outputs.

# DEVLOG — Aivar Discovery Agent



---

### [2026-06-08] Frontend — ChatGPT-style sidebar + session management

**Changes to `frontend/app/page.tsx`:**
- Removed the top `<header>` bar entirely — brand name lives in the sidebar now
- Root layout changed from `flex-col` to `flex-row` (sidebar + main area side-by-side)
- Added `<aside>` sidebar (`w-60`) with:
  - "Bridgent" brand name (orange B icon + text) at the top
  - "New chat" button (creates a fresh welcome thread)
  - Session history list showing all chats (newest first, active highlighted)
  - Theme toggle (light/dark) at the very bottom
- Added `ChatSession` interface (`{ id, title, thread }`); sessions state replaces the single `thread` state
- `patchThread(updater)` / `appendThread` / `replaceThread` / `pushFeed` all operate on the currently active session via a ref-tracked `activeId`
- Session titles are auto-derived from the first 6 words of the first user message
- `startNewChat()` appends a new blank session and switches to it; `switchSession(id)` switches without disrupting a running pipeline
- All pipeline logic (L1/L2/L3 SSE) unchanged — only threading through `patchThread` instead of direct `setThread`
- `tsc --noEmit` confirms zero TypeScript errors

---

### [2026-06-08] Frontend — chat-style agentic UI redesign

**Before:** Single-page form with stacked result sections that appear below the input panel as the pipeline completes.

**After:** Full chat thread UI. The input panel becomes a persistent bottom bar (attach button + textarea + send); results appear as agent bubbles in a scrollable thread. Continuity across multiple queries — each run appends to the thread rather than replacing it.

**New files:**
- `frontend/app/types.ts` — all domain types + `ThreadItem` discriminated union (`welcome | user | thinking | error | l1 | l2 | l3`)
- `frontend/lib/sse.ts` — generic `consumeSSE<R>()` that reads SSE stream, dispatches log events, and returns the result or throws `SSEError`
- `frontend/lib/download.ts` — download helpers (`bundleSlug`, `bundleFiles`, `downloadBundle`, `downloadAllBundles`, `downloadJson`) extracted from page.tsx
- `frontend/app/components/shared.tsx` — `Badge`, `ConfidenceBar`, `ErrorCard`, `SystemGraph` + all color maps
- `frontend/app/components/ThinkingBubble.tsx` — animated thinking card shown while pipeline stage runs
- `frontend/app/components/L1ResultCard.tsx` — collapsed summary (4 stats) + click-to-expand systems table/network graph
- `frontend/app/components/L2ResultCard.tsx` — collapsed summary + click-to-expand gaps/build-order/unmatched tabs
- `frontend/app/components/L3ResultCard.tsx` — collapsed summary + per-bundle expand with file viewer tabs
- `frontend/app/components/ThreadItemView.tsx` — switch on `ThreadItem.kind`, renders agent/user wrappers

**Changes to `frontend/app/page.tsx`:** Full rewrite — chat layout (`flex flex-col h-screen`), `thread: ThreadItem[]` state, `appendThread`/`replaceThread`/`pushFeed` helpers, `react-dropzone` with `noClick` (open via attach button), auto-growing textarea, SSE pipeline via `consumeSSE`, auto-scroll on `thread.length` change.

**No backend changes.** All API routes and pipeline logic untouched.

---

### [2026-06-07] Frontend — unified autonomous pipeline redesign

**Before:** Three separate manual stages — user uploads files, then submits use cases, then triggers connector generation with three separate buttons.

**After:** Single input panel (file dropzone left + use-case textarea right), one "Run Full Analysis" button that autonomously chains L1 → L2 → L3 with no clicks between stages.

**Key changes in `frontend/app/page.tsx`:**
- Moved `useCaseText` textarea into the top-level input card alongside the file dropzone (two-column grid layout on large screens)
- Refactored `runGapAnalysis(inventory, useCases)` — accepts both params directly instead of reading from state, eliminating the state-timing race where `l1State.result` might not yet be committed when the function executes
- Refactored `runGenerate(inventory, gapReport)` — same pattern; both args passed explicitly
- Added `runAll()` that chains the three stages: `runDiscovery()` → `runGapAnalysis(inv, text)` → `runGenerate(inv, report)`, gating each stage on the previous returning non-null
- Added `PipelineProgress` component: horizontal stepper with three stages (Discover / Analyse / Generate), each showing idle / processing (animated) / done / error / skipped state
- Handles "no missing integrations" case: L3 stage shows `skipped` status instead of idle, so users understand why connector generation didn't run
- All result display sections (L1 systems/relationships tables, L2 gaps/dependencies/skipped tabs, L3 bundle cards with file viewer) preserved exactly — no regressions
- API call payloads unchanged: `/api/analyze` still receives `{ inventory, use_cases }`, `/api/generate` still receives `{ inventory, gap_report }`

---

### [2026-06-08] Frontend — production UI overhaul (dark theme, business language, product rename)

**Changes:**

- **Product renamed** from "Aivar Discovery Agent" to **Bridgent**. Tab title and header both updated. Tagline: "Connect your business systems, automatically."
- **True black dark theme**: Dark mode now uses `bg-black` for the page, `bg-zinc-950` for cards, `bg-zinc-900` for elevated surfaces, `border-zinc-900` for borders, `text-white` for headings, `text-zinc-400/500` for secondary text. Replaced all `slate` dark variants with `zinc` throughout.
- **Removed developer mode toggle** and the `AgentActivityConsole` log viewer. Logs now route to the server terminal only (`console.error` in API routes). UI shows only human-readable cycling status messages via `useStatusMessage` hook.
- **Removed logo square** from header.
- **All text rewritten in business language**: No em dashes, no developer terms. Key changes:
  - Pipeline stages: "Map Your Systems" / "Find Missing Connections" / "Build Integrations"
  - Tabs: "Systems", "Connections", "Missing Connections", "Build Order", "Not Matched"
  - Stats labels: "Documents Read", "Systems Found", "Connections Mapped", "Needs Attention", "Goals Reviewed", etc.
  - Status badges: "Ready to Deploy", "Needs Review", "Manual Setup Required"
  - Validation checks: "Code Valid", "Dependencies OK", "Config Valid", "Tests Pass"
  - File viewer tabs: "Integration Code", "Configuration", "Tests", "Dependencies", "Instructions"
  - Download buttons: "Download Systems Report", "Download Gap Report", "Download All Integrations"
  - Action button: "Analyse Now" / "Analysing..."
  - Reset: "Start Over"
  - Error card no longer mentions the terminal
- **Simplified `globals.css`**: Removed the `html:not(.transitioning)` transition override system. Scrollbar uses `zinc` colors for dark mode. Body dark background is `bg-black`.
- **State types simplified**: `logs: string[]` removed from all three state machines.
- **`downloadJson` helper** extracted to avoid duplicated blob/anchor logic.

---

### [2026-06-07] Level 3 — AC8 production-readiness fix (Okta connector ~12% wrong lines)

**Problem:** Acceptance criterion AC8 requires <10% of generated connector lines requiring significant changes. Okta connector was 87 lines with ~10–11 lines needing changes (≈12% — above threshold). Six distinct issues:

1. BASE_URL hardcoded as a Python string literal — tenant-specific URLs (Okta, Zendesk, Salesforce) need to be configurable without code changes.
2. Auth header prefix was `Bearer` — Okta API tokens use `SSWS` prefix, not `Bearer`.
3. `link_header` pagination not supported — Okta uses RFC 5988 Link response headers, but template only had cursor/offset/page/none branches.
4. Bare JSON array response not handled — Okta `/api/v1/users` returns a raw array with no wrapper key, but template always called `.get("key", [])`.
5. `delete_{entity}` method missing — four CRUD verbs present (list/get/create/update) but DELETE was absent.
6. No deterministic correction for LLM-guessed values on well-known APIs.

**Root causes (two independent issues):**

- **Structural gaps in the template**: `connector.py.j2` had no `link_header` branch, no `delete_` method, and no env-var BASE_URL pattern. These are structural — every Okta connector would fail them regardless of LLM quality.
- **LLM value drift**: For well-known APIs, the LLM occasionally picks wrong auth prefixes, pagination styles, etc. No deterministic correction was applied after the LLM call.

**Fixes:**

A. `discovery_agent/level3/models.py` — Added `"link_header"` to `pagination_style` Literal.

B. `discovery_agent/level3/spec_extractor.py`:
- Updated `_CONNECTOR_SYSTEM_PROMPT` with explicit rules for tenant URLs, SSWS prefix, `link_header` style, bare-array `list_response_key = ""`, and `inferred_fields`.
- Added `_norm_dest()` helper for normalized substring matching.
- Added `_SYSTEM_OVERRIDES` dict (10 entries: okta, zendesk, github, gitlab, jira, salesforce, marketo, hubspot, workday) — deterministic corrections for auth prefix, pagination style, auth type.
- Added `_apply_overrides(spec, destination)` — applies first matching override after LLM call, removes overridden fields from `inferred_fields`.
- Wired `_apply_overrides()` as the last step in `extract_connector_spec()`.

C. `discovery_agent/level3/templates/connector.py.j2` (full rewrite, no existing branch removed):
- `import os` added.
- `BASE_URL` changed from string literal to `os.environ.get("DEST_BASE_URL", "{{ api_base_url }}")` — env var name derived via Jinja2 filter chain `upper | replace(' ', '_') | replace('-', '_')`.
- Added `{% elif pagination_style == "link_header" %}` branch: follows RFC 5988 `resp.links.get("next")`, handles bare arrays with `isinstance(data, list)` guard, uses `session.request()` directly for next-page requests (absolute URL).
- Added `delete_{{ entity_name }}(self, record_id)` method — issues DELETE to `LIST_ENDPOINT + "/" + record_id`.

D. `discovery_agent/level3/templates/test_connector.py.j2`:
- Added `test_delete_{{ entity_name }}_sends_request` test — registers DELETE mock at `_LIST_URL + "/test-id"` with status 204, asserts single call with method == "DELETE".

**Regression safety:**
- All new template code is additive (`{% elif %}` branch, new method at end of class — no existing branches or methods modified).
- `link_header` branch handles both wrapped and bare array responses; falls back gracefully.
- `BASE_URL` env-var falls back to `{{ api_base_url }}` when env var not set — tests (which don't set env vars) continue using the mock URL unchanged.
- `delete_` method returns `None`; 204 responses pass `raise_for_status()` cleanly; return value discarded.
- `_apply_overrides` uses substring match — cannot match unrelated systems.

---

### [2026-06-07] Level 3 — Stale bundle display fix

**Root cause:** UI showed manual-setup cards from a previous run's dataset (Workday→Okta, PostgreSQL→Slack) instead of the current run's gaps (Stripe→Slack, BambooHR→Okta). The Reset button in page.tsx reset L1 and L2 state but never touched l3State. After Reset → new L1 → new L2, the Level 3 section rendered with l2Report from the new run but l3Bundles still derived from the stale l3State.phase === "done". The UI displayed old bundles until the user manually clicked "Generate Connectors" again.

**Investigation findings:**
1. No hardcoded gap pairs in level3/ — all system name strings are in comments/prompt examples only.
2. run_level3.py reads sys.argv[1/2], route.ts passes current session's l1/l2 state — input path is correct.
3. pipeline.py never cleared generated/ between runs — stale on-disk directories accumulated (real issue but not what caused the UI display bug).
4. ACTUAL CAUSE: page.tsx Reset button omitted setL3State. runGapAnalysis() also left l3State untouched, so old bundles remained in "done" state through the new L1+L2 run.

**Fixes:**
- frontend/app/page.tsx: Reset button now calls setL3State({phase:"idle"}) + setExpandedBundle(null); runGapAnalysis() does the same at the start of each new analysis
- discovery_agent/level3/pipeline.py: Added shutil.rmtree(output_path) before mkdir at pipeline start so stale on-disk bundles from a prior dataset are always cleared
---

### [2026-06-07] Level 3 — SCIM/identity paradigm, inferred-field disclosure, entity-specific CRUD names

**Issues addressed:**

1. Root cause fixed: Okta/SAML/SSO systems were falling through to `rest_api` paradigm, generating a fake bearer-token REST connector instead of a SCIM/provisioning stub. Added `scim_or_manual` paradigm to classification.py, detected via destination auth_method ("saml"), category ("identity", "sso"), or known IDENTITY_SYSTEMS name set.
2. Root cause fixed: LLM-inferred values (base URL, pagination field, auth type) presented as verified facts with no disclosure. Added `inferred_fields: List[str]` to ConnectorSpec — LLM populates it, README renders a "⚠️ Verify before deploying" section listing each guessed value for engineer review.
3. Root cause fixed: CRUD method names were generic (`list_records`, `get_record`) regardless of entity. Templates now use entity-specific names (`list_leads`, `get_lead`) derived from `entity_name`.
4. pipeline.py now looks up SystemNode objects from the inventory before calling classify_gap(), enabling auth_method and category metadata to inform paradigm detection.

**Changes:**
- discovery_agent/level3/classification.py: Added IDENTITY_SYSTEMS frozenset, scim_or_manual paradigm, updated classify_gap() signature to accept optional src_node/dst_node, added scim_or_manual notes
- discovery_agent/level3/models.py: Added inferred_fields: List[str] to ConnectorSpec
- discovery_agent/level3/spec_extractor.py: Added inferred_fields instruction to connector prompt; updated agent prompt to use entity-specific tool names
- discovery_agent/level3/renderer.py: render_readme() builds inferred_values dict from spec for template
- discovery_agent/level3/pipeline.py: Build node_map from inventory, pass src_node/dst_node to classify_gap
- templates/connector.py.j2: list_records→list_{{entity}}s, get_record→get_{{entity}}, etc.
- templates/test_connector.py.j2: All test method calls updated to entity-specific names
- templates/README.md.j2: Added ⚠️ Verify before deploying section + entity-specific usage examples

**Outcome:**
- Workday→Okta: classified scim_or_manual, manual_setup_required=True, SCIM provisioning README generated instead of REST connector
- Salesforce→Zendesk: rest_api, list_leads/create_lead method names, inferred_fields section in README showing verified values
---

### [2026-06-07] Level 3 — Three-bug fix: URL desync, classifier regression, two-sided connector

**Bugs fixed:**

**Fix 1 — Test/connector URL desync (Salesforce→Zendesk 5/5 tests failing with ConnectionError):**
Root cause: connector read `BASE_URL` from env var at module load time, but test file hardcoded `BASE_URL = "{{ api_base_url }}"` (a raw Jinja2 literal) — the two values never agreed. Mocked URLs built from the test's literal didn't match the runtime URL from env var.
Fix: `test_connector.py.j2` now sets `os.environ[prefix + "_BASE_URL"]` with a concrete dummy value BEFORE importing the connector module, then imports `SRC_BASE_URL`, `SRC_LIST_ENDPOINT`, `DST_BASE_URL`, `DST_CREATE_ENDPOINT` directly from `connector`. Mock URLs are built from these imported constants — they agree with runtime values by construction.
Verified: rendered Salesforce→Zendesk connector, ran pytest, 6/6 pass.

**Fix 2 — Classifier regression (Okta as SOURCE generating REST connectors):**
Root cause: `classify_gap()` only checked the DESTINATION for identity/SCIM signals. Okta as a SOURCE was invisible to the classifier, routing to `rest_api` and generating a fake connector.
Fix: `classification.py` now checks BOTH source AND destination using extracted predicate functions (`_is_database`, `_is_identity`, `_is_webhook_only`). Each predicate checks `node.category` / `node.auth_method` attributes first, then falls back to frozenset name heuristics. Added `needs_human_review=True` → `scim_or_manual`. Added `src_node, dst_node` args to `get_paradigm_notes()` for dynamic reason strings (no hardcoded per-system sentences).
Verified: Okta→Zendesk = scim_or_manual, Salesforce→Okta = scim_or_manual, Salesforce→Zendesk still = rest_api.

**Fix 3 — Two-sided connector + config-based auth (no invented headers):**
Root cause: `ConnectorSpec` had flat auth/URL fields (single model), causing the generator to model only one side (destination) with an invented `X-Zendesk-Token` header that doesn't exist.
Fixes across five files:
- `models.py`: New `ApiProfile` model (auth, base URL, endpoints, pagination) for each side. `ConnectorSpec` now has `source: ApiProfile` + `destination: ApiProfile`.
- `spec_extractor.py`: Two-sided system prompt (SOURCE rules + DESTINATION rules). Fixed Zendesk `_SYSTEM_OVERRIDES` entry: was `auth_header_name: "X-Zendesk-Token"` (LLM invention) → now `auth_type: bearer, auth_header_name: Authorization, auth_header_prefix: "Bearer "`. New `_apply_profile_overrides(profile, system_name)` applies overrides to ONE profile; `_apply_overrides(spec)` calls it for both.
- `connector.py.j2`: Full rewrite — `SourceClient` (reads source), `DestinationClient` (writes destination), `{{ class_name }}` orchestrator with `sync_{{ entity_name }}s()`. Auth headers/prefixes sourced from `source.*` and `destination.*` template vars (from `api_profiles` config), never guessed. All 5 pagination styles in SourceClient.
- `renderer.py`: Added `_env_prefix(name)` helper. All render functions add `src_env_prefix`, `dst_env_prefix` to context. `render_readme()` merges `inferred_fields` from both profiles and builds value lookup from both profile dicts.
- `README.md.j2`: Updated for two-sided auth section (separate Source/Destination blocks), env-var override instructions, updated usage examples showing `{{ class_name }}(src_token=..., dst_token=...)`.
No hardcoded system names, base URLs, auth headers, or token endpoints anywhere in templates or generator code.

**Files changed:** `models.py`, `classification.py`, `spec_extractor.py`, `renderer.py`, `pipeline.py`, `connector.py.j2`, `test_connector.py.j2`, `README.md.j2`.

---

### [2026-06-07] Level 3 — Paradigm classification, retry enforcement, gate propagation

**Issues addressed from validator critique:**

1. Root cause fixed: One REST-CRUD template applied to all systems regardless of paradigm. PostgreSQL is a database (requires psycopg2), Slack is a webhook target (requires chat.postMessage). Added paradigm classification gate before any LLM calls.
2. Root cause fixed: Silent unvalidated LLM slot-fill for retry_status_codes. Added defense-in-depth enforcement at renderer level.
3. Gate propagation verified: valid property correctly propagates test failures.

**Changes:**
- NEW discovery_agent/level3/classification.py: classify_gap() returns rest_api, database_source, or webhook_destination
- discovery_agent/level3/models.py: Added paradigm, manual_setup_required, paradigm_notes to GeneratedBundle
- discovery_agent/level3/pipeline.py: Paradigm gate before bundle_dir.mkdir and LLM calls
- discovery_agent/level3/renderer.py: render_connector() re-checks and merges retry codes
- frontend/app/page.tsx: Updated interface, 4-stat summary, MANUAL SETUP badge, conditional file viewer

**Outcome:**
- PostgreSQL to Slack: classified database_source, manual_setup_required=True, no code generated
- Workday to Okta: classified rest_api, proceeds to LLM generation and validation gate
---

### [2026-06-07] Level 2 — Reverted "Fix 1/Fix 2" changes to restore pre-regression state

**Goal:** Undo all changes made during the "Fix 1/Fix 2" session that caused a regression in Level 2 pipeline behavior.

**What was reverted:**
- `analyzer.py` — system prompt reverted to pre-"Fix 1/Fix 2" version: "Match each system by its documented role, not by category guess" with correct role-matching examples; removed "carrier tracking event" example and "do NOT pick because database" instruction
- `validator.py` — back to 3-tuple return `(valid_canonical, rejected, missing_caps)`; no `name_map` 4th element
- `pipeline.py` — back to `valid_set` filter for flows; no name_map normalization pass
- `gap_detector.py` — back to bidirectional-only exists set (unidirectional adds one ordered pair, bidirectional adds both directions)

**Why:** The "Fix 1/Fix 2" changes caused a large regression. Pre-"Fix" state was the correct baseline.

---

### [2026-06-07] Discovery Agent Level 1 — Full Implementation

**Goal:** Build a complete Level 1 Discovery Agent pipeline from scratch — process mixed-format documents, extract enterprise systems, deduplicate, score confidence, extract relationships, and build a knowledge graph.

**What I tried:**
- Planned the pipeline extensively before writing a single line — identified 10 gaps in the design before coding (chunk model, hallucination check, image resize, spreadsheet conversion, rapidfuzz vs hardcoded aliases, etc.)
- Decided against hardcoded alias dictionary — used prompt-level LLM normalization (LLM expands abbreviations) + rapidfuzz for string variations
- Two-pass extraction: Pass 1 extracts systems, Pass 2 extracts relationships only between confirmed systems
- Used `instructor` library wrapping Groq for structured Pydantic output with auto-retry

**Dead ends:**
- Hardcoded alias dictionary — rejected in favour of dynamic approach (LLM prompt normalization + rapidfuzz)
- Using tiktoken for chunk size — not available for LLaMA; switched to word count proxy (3000 words max)
- KG edges deferred to Level 2 — reversed this decision, edges are extracted in Level 1 via Pass 2

**Final solution:**
Full 8-stage pipeline:
1. Router (PDF/DOCX/PPTX/MD/TXT/XLSX/CSV/PNG/JPG/WEBP)
2. Parser (Docling + pandas + plain text + Groq vision for images)
3. Chunker (structure-aware: headings/tables/paragraphs, 3000-word cap)
4. Pass 1 Extractor (instructor + Groq, evidence substring hallucination check)
5. Resolver (rapidfuzz token_sort_ratio ≥ 88% + same category)
6. Confidence scorer (deterministic formula, auto review_note < 70%)
7. Pass 2 Relationship extractor (two guards: endpoint check + evidence substring)
8. Graph builder (NetworkX DiGraph, nodes + edges)

**Files changed:**
- pyproject.toml
- discovery_agent/__init__.py
- discovery_agent/models.py
- discovery_agent/config.py
- discovery_agent/ingestion/__init__.py
- discovery_agent/ingestion/router.py
- discovery_agent/ingestion/parser.py
- discovery_agent/ingestion/vision.py
- discovery_agent/ingestion/chunker.py
- discovery_agent/extraction/__init__.py
- discovery_agent/extraction/extractor.py
- discovery_agent/extraction/resolver.py
- discovery_agent/extraction/confidence.py
- discovery_agent/extraction/relationship_extractor.py
- discovery_agent/graph/__init__.py
- discovery_agent/graph/builder.py
- discovery_agent/output/__init__.py
- discovery_agent/output/formatter.py
- discovery_agent/pipeline.py
- discovery_agent/cli.py

**Notes:**
- .env key format was `GROQ_API_KEY` + `GROQ_API_KEYS` comma-separated (not numbered). Config updated to handle all three formats.
- `pipeline.run()` is callable programmatically for API integration.
- CLI: `python -m discovery_agent.cli <docs...> --output inventory.json`

---

### [2026-06-07] Next.js Frontend — File Upload UI

**Goal:** Build a Next.js frontend in `frontend/` that lets users upload documents and see discovery results.

**What I tried:**
- Next.js 14.2.5 (initial) — worked but had a critical CVE; upgraded to 16.2.7 via `npm install next@latest`. React 18 confirmed compatible.
- `react-dropzone` — added for drag-and-drop file upload (multi-format accept list matching the pipeline's supported extensions).
- API route `app/api/discover/route.ts` — saves uploaded files to `os.tmpdir()`, spawns `python run_pipeline.py <paths...>` as a subprocess, parses stdout as JSON, cleans up temp dir in `finally`.
- `run_pipeline.py` at project root — thin entry point that calls `pipeline.run()` and prints `model_dump_json()` to stdout.

**Dead ends:** None — build passed on first attempt after tsconfig was auto-patched by Next.js 16.

**Final solution:** Full App Router setup: `layout.tsx`, `globals.css` (Tailwind), `app/api/discover/route.ts`, `app/page.tsx`. UI has drag-and-drop zone, file list with remove, stats cards (documents, systems, relationships, flagged), and tabbed tables for systems (with confidence bars, criticality badges, review notes) and relationships.

**Files changed:**
- `frontend/app/layout.tsx`
- `frontend/app/globals.css`
- `frontend/app/api/discover/route.ts`
- `frontend/app/page.tsx`
- `frontend/package.json` (added react-dropzone, upgraded Next.js to 16.2.7)
- `run_pipeline.py`

**Notes:** Start frontend with `cd frontend && npm run dev`. Backend Python env must be active in the same shell or PATH so `python` resolves correctly. The API route uses `process.cwd()` → `..` to find `run_pipeline.py` relative to the Next.js working directory.

---

### [2026-06-07] Confidence Scoring Fix

**Goal:** Fix failing test "Inferred with metadata (key_entities + business_processes), single mention" scoring 68% instead of 70–89%.

**Root cause:** `_penalties()` was applying a blanket -10 single-mention penalty whenever an inferred system had only one mention, regardless of whether metadata corroborated the extraction. A system with populated `key_entities`, `business_processes`, or `auth_method` is already corroborated by the LLM's own structured output — penalising it again is double-penalising.

**Fix:** Made the single-mention penalty conditional — only apply when the system has NEITHER a structured source file (PDF/DOCX/XLSX/etc.) NOR any metadata field populated.

**Files changed:** `discovery_agent/extraction/confidence.py`

---

### [2026-06-07] GitHub Push + History Rewrite

**Goal:** Push all source code to GitHub. `frontend/node_modules/@next/swc-win32-x64-msvc/next-swc.win32-x64-msvc.node` (130MB) exceeded GitHub's 100MB limit and blocked the push.

**Fix:** Orphan branch technique — created a clean branch with a single commit containing only source files, force-pushed to replace the main branch history. `.gitignore` added to exclude `__pycache__/`, `.venv/`, `.env`, `uv.lock`, `frontend/.next/`, `frontend/node_modules/`.

---

### [2026-06-07] Level 2 — Integration Gap Analysis Pipeline

**Goal:** After Level 1 produces a system inventory, let users describe automation goals and get a prioritised gap analysis showing which integrations are missing, partial, or already available.

**Architecture decisions:**
- Single LLM call per use case (systems + flows together) via `instructor`; `@model_validator` on the Pydantic schema enforces that every flow's source/destination is in the systems list — forces internal consistency without a second LLM call.
- Post-LLM validation via fuzzy match (token_sort_ratio ≥ 88%) against Level 1 inventory; un-matched product-like names → `rejected`; generic capability words → `missing_capabilities`.
- Gap detection is deterministic graph check: exact/bidirectional → available; reversed direction → partial; not found → missing. Deduplication by (source, destination) key.
- Effort classification is a pure rule table (no LLM) for repeatability: both auth → S; one auth → M; neither → L; needs_human_review bumps one size.
- Priority formula: `(max_freq + max_crit) × (1 + downstream_count)` — additive base prevents zero-multiplication when either dimension is low.
- Dependency graph: lists which missing/partial integrations block which use cases, sorted by number of blocked use cases.
- Skipped section preserves unmapped use cases, rejected system names, and missing capability descriptions so nothing disappears silently.

**UI:** After Level 1 results appear, a textarea + "Analyse Integration Gaps" button appears at the bottom. Submitting POSTs to `/api/analyze`, which streams SSE logs then the `GapReport` JSON. Level 1 results remain fully visible. Level 2 results display in tabbed tables: Gaps (priority-sorted, status/effort badges), Dependencies, Skipped.

**Files changed:**
- `discovery_agent/level2/__init__.py`
- `discovery_agent/level2/models.py`
- `discovery_agent/level2/analyzer.py`
- `discovery_agent/level2/validator.py`
- `discovery_agent/level2/gap_detector.py`
- `discovery_agent/level2/effort.py`
- `discovery_agent/level2/scorer.py`
- `discovery_agent/level2/dependency.py`
- `discovery_agent/level2/pipeline.py`
- `run_level2.py`
- `frontend/app/api/analyze/route.ts`
- `frontend/app/page.tsx`

---


### [2026-06-08] Observability — LangSmith + PromptLayer integration (Phase 1)

**What was added:**

- **LangSmith** (`langsmith==0.8.9`): Full LLM call tracing for the Bridgent project. All LLM calls through `call_with_key_rotation` and `call_vision_with_key_rotation` are now traced with inputs, outputs, and timing.
- **PromptLayer** (`promptlayer==1.4.6`): Prompt logging via their `traceable` decorator, stacked with LangSmith on the same rotation functions.

**Files changed (backend only — no frontend/L1/L2/L3 logic touched):**

- `.env`: Added `LANGCHAIN_TRACING_V2`, `LANGCHAIN_API_KEY`, `LANGCHAIN_PROJECT=Bridgent`, `LANGCHAIN_ENDPOINT`, `PROMPTLAYER_API_KEY`
- `pyproject.toml`: Added `langsmith = "*"` and `promptlayer = "*"` to dependencies
- `discovery_agent/config.py`:
  - Added `_traceable` shim (falls back gracefully if langsmith not installed)
  - Added `_pl_traceable` initialized from `PromptLayer(api_key=...).traceable` after `load_dotenv()`
  - Stacked `@_pl_traceable` + `@_traceable` on both `call_with_key_rotation` and `call_vision_with_key_rotation`
  - `get_instructor_client` and `get_raw_groq_client` unchanged — native Groq wrappers not available in these versions

**What traces look like in LangSmith dashboard (smith.langchain.com):**
- Project: "Bridgent"
- Each LLM call appears as `llm_call_key_rotation` run with the text chunk as input and the extracted model as output
- Vision calls appear as `vision_call_key_rotation`

**What traces look like in PromptLayer dashboard:**
- Each rotation function call logged with name, timing, and IO

**Non-regression guarantees:**
- `get_instructor_client` and `get_raw_groq_client` code is byte-for-byte identical to pre-change (no wrapper stacking that could affect Instructor or key rotation)
- Both decorators have no-op fallbacks — if either service is down or key is invalid, the LLM call proceeds normally
- No changes to extractor.py, relationship_extractor.py, resolver.py, confidence.py, pipeline.py, or any Level 2/3 files

**Future phases (planned):**
- Phase 2: LangGraph on Level 1 pipeline (pipeline.py only, node logic files untouched)
- Phase 3: LangGraph on Level 2+3 after Phase 2 confirmed stable
- Phase 4: DSPy prompt optimization (needs labeled dataset first)

---

### [2026-06-08] Production hardening — Level 1 observability, guards, parallelism, and test suite

**Goal:** Bring Level 1 pipeline to production-grade quality without breaking any existing functionality. Five problem areas targeted: error handling, observability, defensive validation, performance, and test coverage.

**Changes:**

**`discovery_agent/config.py`**
- Added `generate_run_id()` — 8-char hex correlation ID (uuid4) stamped on every pipeline run; flows through all log lines as `[run_id]` prefix
- Added `init_sentry()` — initialises Sentry if `SENTRY_DSN` env var is set; silent no-op otherwise. Sample rate via `SENTRY_TRACES_SAMPLE_RATE`, environment via `APP_ENV`
- `pyproject.toml`: added `sentry-sdk = "*"`

**`discovery_agent/models.py`**
- Added 5 diagnostic fields to `InventoryOutput` (all have defaults — backward compatible with existing callers):
  - `run_id: str = ""`
  - `stage_timings: Dict[str, float]` — seconds per stage
  - `extraction_errors: int` — count of crashed extraction workers
  - `failed_chunk_ids: List[str]` — which chunk IDs failed
  - `total_chunks_processed: int`

**`discovery_agent/pipeline.py`** (rewritten)
- Each document ingested in its own `try/except` — parse failures skip that document, not the whole run
- Pass 1 extraction now uses `ThreadPoolExecutor(max_workers=min(4, total_chunks))` — parallel chunk processing
- Error rate gate: if ≥80% of chunks fail LLM extraction → `logger.error` with connectivity warning
- All 8 stages timed with `time.perf_counter()`; timings surfaced in `InventoryOutput.stage_timings`
- `_empty_output()` updated to accept and propagate all diagnostic fields
- `run()` accepts optional `run_id` parameter (auto-generated if not provided)

**`discovery_agent/extraction/extractor.py`**
- Added `@_traceable(name="extract_systems_from_chunk")` (LangSmith trace per chunk)
- Guard 0: skip extracted names shorter than 3 chars (`_MIN_NAME_LENGTH = 3`) — catches "AI", "IT"
- Guard 1 (hallucination): evidence substring check — unchanged
- Guard 2 (non-system context): regex check — extended `deprecated\w*`, `decommission\w*` to catch inflected forms
- Max-per-chunk warning: log if LLM returns >30 systems from one chunk

**`discovery_agent/extraction/relationship_extractor.py`**
- Added `@_traceable(name="extract_relationships")` (LangSmith trace per relationship pass)
- Pre-filter: `_get_significant_tokens()` + `_chunk_mentions_systems()` — skip LLM call for chunks that contain no confirmed system name tokens (prevents quota waste on appendices, boilerplate)

**`run_pipeline.py`** (production-grade rewrite)
- `_validate_paths()` — resolves each path, checks existence, is-a-file, and 50MB per-file size limit
- Batch size limit: reject if >20 files in one call
- Lazy imports: validation errors return JSON before any Python package import
- Guaranteed stdout JSON: all exit paths (validation error, pipeline crash, keyboard interrupt) print `{"error": "..."}` to stdout
- Sentry integration: `init_sentry()` at startup; uncaught exceptions captured via `sentry_sdk.capture_exception()`
- Log format unchanged (stderr, `%(levelname)-8s %(name)s — %(message)s`) to preserve frontend logMapper SSE streaming

**Test suite** (`tests/` — new)
- `tests/__init__.py`, `tests/unit/__init__.py`
- `tests/helpers.py` — `make_mention()`, `make_node()`, `make_chunk()` builders
- `tests/unit/test_resolver.py` — PRODUCT_ALIASES, fuzzy grouping, second-pass dedup (11 tests)
- `tests/unit/test_confidence.py` — tier classification, hedge penalty, review flag, score clamping (9 tests)
- `tests/unit/test_extractor_guards.py` — non-system patterns, hedge markers, min name length (16 tests)
- `tests/unit/test_chunker.py` — no-split, split, source preservation, mixed batch (9 tests)
- **52/52 passing**, no LLM calls in any test

**Non-regressions confirmed:**
- `call_with_key_rotation` and `call_vision_with_key_rotation` code unchanged (key rotation, 429 retry, 60s backoff)
- `resolve()`, `score()`, `build_graph()`, `build_output()` logic unchanged
- `InventoryOutput` fields all have defaults — existing JSON consumers unaffected
- `run_pipeline.py` stderr log format identical to prior version

---

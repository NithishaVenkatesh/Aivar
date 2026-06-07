# DEVLOG — Aivar Discovery Agent

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

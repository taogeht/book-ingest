# curriculum-ingest

A single-operator webapp that extracts structured curriculum data from textbook
PDFs and produces an exportable bundle suitable for seeding an LMS instance.

Deployed at https://ingest.mschool.com.tw via Coolify (Hetzner) alongside the
recording-app infrastructure.

## Phase 1 scope

- Digital PDFs only (no OCR, no vision-LLM fallback)
- Vocabulary extraction (no reading-passage / grammar extraction yet)
- One source document per project
- LLM-driven unit detection + vocabulary extraction (Claude Sonnet 4.6)
- Review UI: approve / reject / toggle multi-word / edit POS
- Export to `.bundle.zip` containing `manifest.json`, `curriculum.json`, `vocabulary.json`

See "Phase 2 priorities" at the bottom for what's deferred.

## Stack

- Next.js 16 (App Router, Node runtime)
- Postgres via Drizzle ORM (`drizzle-kit push` on container boot)
- Cloudflare R2 for source PDFs + export bundles
- `pdfjs-dist` (legacy build) for digital-PDF text extraction
- `@anthropic-ai/sdk` for unit detection + vocabulary extraction
- `jszip` for bundle creation
- Tailwind v4 for UI
- Single-password auth via `INGEST_PASSWORD` env var

## Local development

```bash
cp .env.example .env.local
# Fill in DATABASE_URL, R2_*, ANTHROPIC_API_KEY, INGEST_PASSWORD
npm install
npm run db:push        # applies schema to your local Postgres
npm run dev
```

Open http://localhost:3000, enter `INGEST_PASSWORD`, create a project, upload a PDF.

## Auth

Auth is intentionally minimal — this is a tool for one operator.

- The password lives in the `INGEST_PASSWORD` env var.
- On `POST /api/login` we constant-time compare against that env var.
- On success a 32-byte random token is generated, hashed with SHA-256, and stored as `system_settings.session_token_hash`.
- The token (cleartext) is sent back as an `HttpOnly` cookie `ingest_session`.
- Middleware redirects every `/projects/*` and protected API route to `/login` when the cookie is missing; route handlers re-validate the hash on every authenticated request.
- Rotating `INGEST_PASSWORD` doesn't auto-invalidate sessions; to force re-login, call `/api/logout` or update the system_settings row manually.

## Pipeline

Triggered fire-and-forget from `POST /api/projects/[id]/upload` after the PDF is uploaded to R2.

1. **Detect file type** — quick parse via `pdfjs-dist`; if any page yields text, it's `pdf_digital`, otherwise `pdf_scanned` (Phase 2 work).
2. **Page extraction** — `pdfjs-dist` text content + position metadata. Stored in `extracted_pages.raw_text` (line-reconstructed by y-coordinate) and `layout_json` (raw item positions).
3. **Unit detection** — Claude Sonnet 4.6 receives all page snippets (first ~200 chars each) and returns JSON `{ units: [...] }`. Validated with Zod.
4. **Vocabulary extraction** — for each detected unit, the full text of every page in `[start_page, end_page]` is sent to Claude with instructions to extract only explicit vocabulary-list entries.

All LLM responses are persisted with `confidence` + `reasoning` for review.

## Review UI

`/projects/[id]/review` has three tabs:

- **Source documents** — status of each uploaded PDF.
- **Units** — detected units with confidence + LLM reasoning. Toggle reviewed.
- **Vocabulary** — table of all extracted vocab, filterable by unit. Approve / reject per row; toggle multi-word; edit POS via dropdown.

## Export

`/projects/[id]/export` enforces two readiness conditions:

- Every detected unit is marked reviewed.
- At least 80 % of vocabulary rows are approved.

When ready, "Generate bundle" creates a ZIP at `ingestion-bundles/{project_id}/{ts}.bundle.zip` and returns a 24-hour signed URL. The project is moved to `status='exported'`.

Bundle layout:
```
manifest.json     # version, project metadata, source-doc info, counts
curriculum.json   # curriculum name, level, language, units
vocabulary.json   # array of approved vocab entries with unit_number / source_page
```

## Deployment (Coolify on Hetzner)

1. **Create the GitHub repo** and push this code.
2. **In Coolify**:
   - New Resource → "Application" → Public Git repository.
   - Build Pack: **Dockerfile**.
   - Domain: `ingest.mschool.com.tw` (Coolify provisions the Let's Encrypt cert).
3. **Database**: create a new Postgres service under Coolify (`curriculum_ingest`). Recommended to keep this isolated from `recording-app`'s DB for easier backup + debug.
4. **R2**: create a new bucket `curriculum-ingest-sources`. Reuse the existing R2 API credentials from `recording-app`.
5. **Env vars** (in Coolify → application → "Environment Variables"):
   ```
   DATABASE_URL=postgresql://... (point at the Coolify Postgres service)
   INGEST_PASSWORD=<a strong password — this is the only thing protecting the tool>
   R2_ACCOUNT_ID=...
   R2_ACCESS_KEY_ID=...
   R2_SECRET_ACCESS_KEY=...
   R2_BUCKET_NAME=curriculum-ingest-sources
   R2_PUBLIC_URL=https://<accountid>.r2.dev/curriculum-ingest-sources
   ANTHROPIC_API_KEY=sk-ant-...
   NEXT_PUBLIC_APP_URL=https://ingest.mschool.com.tw
   ```
6. **Deploy**. The container's `npm start` runs `drizzle-kit push --force && next start`, so the schema is applied on every boot.

## Test plan: validating against AF&F Book 1

The first regression target is American Family & Friends Book 1; we have a known-good 379-entry vocabulary table from the recording-app.

1. Sign in to https://ingest.mschool.com.tw with `INGEST_PASSWORD`.
2. Create a new project: name `AF&F Book 1`, curriculum `American Family and Friends`, target level `1`.
3. Upload the digital PDF of Book 1.
4. Watch `source_documents.status`. It should transition `uploaded → parsed` within ~30 s.
5. Navigate to `/projects/[id]/review`:
   - **Units tab**: AF&F Book 1 has a Starter unit + 9 numbered units + a Goodbye/Review section. Expected to see 10–11 detected units with reasonable boundaries. Off-by-one on start_page is common.
   - **Vocabulary tab**: count should be in the **300–500 range**. Exact match to 379 is not expected — the LLM will include some incidental words and miss a handful.
6. Spot-check a few units against the known-good list. Approve correct entries, reject the obvious mis-extractions. (Use the unit dropdown to focus per-unit.)
7. Re-run extraction for an individual document if needed: `tsx scripts/run-pipeline.ts <sourceDocumentId>` (locally with same env).
8. Once units are reviewed and 80 % of vocab is approved, go to `/projects/[id]/export` and click **Generate bundle**. Download and inspect `vocabulary.json` against the known-good 379.

Acceptance: bundle contains ≥ 300 approved entries that overlap meaningfully with the known-good list. Differences are the operator's problem to reconcile in review.

## Phase 2 priorities (in priority order, based on Phase 1 build)

1. **Page-image rendering**. The review UI shows only extracted text right now; rendering each PDF page to PNG (PyMuPDF subprocess) is the single biggest UX win for catching extraction errors. Storage key already exists in schema (`extracted_pages.page_image_key`).
2. **OCR fallback for scanned PDFs**. AF&F is digital, but several other curricula on the shelf are scans. PyMuPDF + Tesseract is enough; pipeline already branches on `file_type`.
3. **Vision-LLM fallback for vocabulary**. Many ESL vocab pages are picture-word grids where the words are inside the images. Claude with image input would catch those that text extraction misses. This is the most likely cause of vocab-count shortfall on AF&F.
4. **Inline edit of vocabulary word / unit assignment**. Right now you can toggle approve / reject / POS but not edit the word or move it between units.
5. **Reading-passage extraction**. Separate stage; needs paragraph segmentation and a different prompt. Schema columns to be added.
6. **Cross-unit deduplication**. Spiral curricula re-introduce words; we'd want to mark "first appearance" vs "recurring."
7. **CEFR auto-tagging**. Use Claude to assign A1/A2/B1 per entry; expose a calibration step (manual override). Field is already nullable.
8. **Multi-document projects**. Some curricula ship as multiple PDFs (student book + workbook); schema already supports many `source_documents` per project, but the unit-detection prompt would need to merge across docs.
9. **Job queue**. Currently fire-and-forget from the upload route. Fine for a single user, but a failed pipeline run requires manual re-trigger via `tsx scripts/run-pipeline.ts`. A tiny pg-backed queue with retries would help.

## Operational notes

- All pipeline state is in Postgres. R2 stores binary artifacts only.
- The schema is auto-applied on boot via `drizzle-kit push --force`; in production you'd normally use generated migrations, but for a single-operator tool the friction isn't worth it.
- `system_settings` is currently used only for `session_token_hash`. Future config (e.g. LLM temperature overrides) can land there without a migration.
- Logs go to stdout — Coolify's log viewer is fine for v1.

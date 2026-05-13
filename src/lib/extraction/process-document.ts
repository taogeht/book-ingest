// End-to-end pipeline orchestrator. Each stage is exported separately so
// the re-extraction scripts can re-run a single stage on demand.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { db } from '@/lib/db';
import {
  sourceDocuments,
  extractedPages,
  ingestionProjects,
  detectedUnits,
  extractedVocabulary,
} from '@/lib/db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { r2Client } from '@/lib/storage/r2-client';
import { renderPagesToR2 } from './page-render';
import { runMarker, isPictureWordGrid, type MarkerPage } from './marker';
import { runVisionOnPages, type PageType } from './vision-fallback';
import { detectUnits } from '@/lib/llm/detect-units';
import { extractVocabulary } from '@/lib/llm/extract-vocabulary';
import { logError, logInfo } from '@/lib/logger';

const VISION_TRIGGER_MIN_TEXT_CHARS = 50;

// Public entry point: full pipeline for a freshly uploaded document.
export async function processDocument(sourceDocumentId: string): Promise<void> {
  const doc = await db.query.sourceDocuments.findFirst({
    where: eq(sourceDocuments.id, sourceDocumentId),
  });
  if (!doc) {
    logError(new Error('source document not found'), 'pipeline', { sourceDocumentId });
    return;
  }

  await db
    .update(ingestionProjects)
    .set({ status: 'extracting', updatedAt: new Date() })
    .where(eq(ingestionProjects.id, doc.projectId));

  try {
    await extractPages(sourceDocumentId);
  } catch (err) {
    logError(err, 'pipeline.extract-pages', { sourceDocumentId });
    await db
      .update(sourceDocuments)
      .set({
        status: 'failed',
        parseError: err instanceof Error ? err.message : String(err),
      })
      .where(eq(sourceDocuments.id, sourceDocumentId));
    return;
  }

  await runUnitDetection(sourceDocumentId);
  await runVocabExtractionForProject(doc.projectId);

  await db
    .update(ingestionProjects)
    .set({ status: 'reviewing', updatedAt: new Date() })
    .where(eq(ingestionProjects.id, doc.projectId));
}

// Stage 1+2: page-image rendering (pdftoppm) and text extraction (Marker)
// run concurrently. Vision fallback runs after both finish, on the union of
// (a) pages Marker couldn't extract from and (b) pages whose Marker output
// is empty / dominated by figure blocks.
export async function extractPages(sourceDocumentId: string): Promise<void> {
  const doc = await db.query.sourceDocuments.findFirst({
    where: eq(sourceDocuments.id, sourceDocumentId),
  });
  if (!doc) throw new Error(`source document not found: ${sourceDocumentId}`);

  const work = await mkdtemp(path.join(tmpdir(), 'ingest-'));
  const pdfPath = path.join(work, 'source.pdf');
  const renderDir = path.join(work, 'pages');
  const markerDir = path.join(work, 'marker');
  await Promise.all([
    rmAndMkdir(renderDir),
    rmAndMkdir(markerDir),
  ]);

  try {
    const buf = await r2Client.getObject(doc.storageKey);
    if (!buf) throw new Error(`R2 object not found: ${doc.storageKey}`);
    await writeFile(pdfPath, buf);

    // Render + Marker run in parallel; they're both pure functions of the
    // PDF on disk. Marker dominates (~minutes), pdftoppm finishes first
    // (~seconds).
    const [rendered, markerResult] = await Promise.all([
      renderPagesToR2({
        pdfPath,
        workDir: renderDir,
        projectId: doc.projectId,
        sourceDocId: doc.id,
      }),
      runMarker({ pdfPath, outDir: markerDir }).catch((err) => {
        logError(err, 'pipeline.marker', { sourceDocumentId });
        return [] as MarkerPage[];
      }),
    ]);
    logInfo('pipeline', `rendered ${rendered.length} pages, marker ${markerResult.length}`, {
      sourceDocumentId,
    });

    if (rendered.length === 0) {
      throw new Error('pdftoppm produced no page images');
    }

    // If Marker silently produced nothing for the whole document, treat each
    // rendered page as marker_failed=true and lean on vision for everything.
    // (A subprocess-level Marker failure already threw above; this branch is
    // for "ran successfully but yielded zero pages" — rare but real for some
    // edge-case PDFs.)
    const markerByPage = new Map<number, MarkerPage>();
    for (const p of markerResult) markerByPage.set(p.pageNumber, p);

    // Wipe any prior extracted_pages for this document — this stage is the
    // source of truth and is idempotent.
    await db.delete(extractedPages).where(eq(extractedPages.sourceDocumentId, sourceDocumentId));

    // Insert one row per rendered page, populated from Marker if available.
    const baseRows = rendered.map((r) => {
      const m = markerByPage.get(r.pageNumber);
      const markerFailed = !m;
      return {
        pageNumber: r.pageNumber,
        pageImageKey: r.storageKey,
        rawText: m?.rawText ?? '',
        layoutJson: (m?.layoutJson ?? { marker_failed: true }) as any,
        markerFailed,
      };
    });

    const inserted = await db
      .insert(extractedPages)
      .values(
        baseRows.map((r) => ({
          sourceDocumentId,
          pageNumber: r.pageNumber,
          rawText: r.rawText,
          layoutJson: r.layoutJson,
          pageImageKey: r.pageImageKey,
          extractionMethod: 'marker' as const,
        })),
      )
      .returning({ id: extractedPages.id, pageNumber: extractedPages.pageNumber });

    await db
      .update(sourceDocuments)
      .set({ status: 'parsed', pageCount: rendered.length, parseError: null })
      .where(eq(sourceDocuments.id, sourceDocumentId));

    // Decide which pages need vision fallback.
    const idByPage = new Map(inserted.map((r) => [r.pageNumber, r.id]));
    const visionTargets: Array<{
      id: string;
      pageNumber: number;
      pageImageKey: string;
      hadMarkerOutput: boolean;
    }> = [];
    for (const r of baseRows) {
      const m = markerByPage.get(r.pageNumber);
      const needsVision =
        !m ||
        r.rawText.trim().length < VISION_TRIGGER_MIN_TEXT_CHARS ||
        (m && isPictureWordGrid(m));
      if (needsVision) {
        const id = idByPage.get(r.pageNumber);
        if (!id) continue;
        visionTargets.push({
          id,
          pageNumber: r.pageNumber,
          pageImageKey: r.pageImageKey,
          hadMarkerOutput: !!m,
        });
      }
    }

    logInfo(
      'pipeline',
      `vision fallback on ${visionTargets.length} / ${rendered.length} pages`,
      { sourceDocumentId },
    );

    if (visionTargets.length > 0) {
      const results = await runVisionOnPages(visionTargets);
      for (const r of results) {
        if (!r.result) {
          logError(new Error(r.error ?? 'vision returned null'), 'pipeline.vision', {
            sourceDocumentId,
            pageNumber: r.page.pageNumber,
          });
          continue;
        }
        const newMethod = r.page.hadMarkerOutput ? 'marker+vision' : 'vision';
        // Read current row for layoutJson merge.
        const current = await db.query.extractedPages.findFirst({
          where: eq(extractedPages.id, r.page.id),
        });
        const existingLayout = (current?.layoutJson ?? {}) as Record<string, unknown>;
        const newLayout = {
          ...existingLayout,
          page_type: r.result.pageType,
          vision_extraction: {
            text_content: r.result.textContent,
            vocabulary_candidates: r.result.vocabularyCandidates,
          },
        };
        await db
          .update(extractedPages)
          .set({
            rawText: r.result.textContent,
            layoutJson: newLayout as any,
            extractionMethod: newMethod,
          })
          .where(eq(extractedPages.id, r.page.id));
      }
    }
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

// Stage 3: unit detection from existing extracted_pages.
export async function runUnitDetection(sourceDocumentId: string): Promise<void> {
  const doc = await db.query.sourceDocuments.findFirst({
    where: eq(sourceDocuments.id, sourceDocumentId),
  });
  if (!doc) throw new Error(`source document not found: ${sourceDocumentId}`);
  const project = await db.query.ingestionProjects.findFirst({
    where: eq(ingestionProjects.id, doc.projectId),
  });
  if (!project) return;

  const pages = await db.query.extractedPages.findMany({
    where: eq(extractedPages.sourceDocumentId, sourceDocumentId),
  });
  const pagesSorted = pages.sort((a, b) => a.pageNumber - b.pageNumber);

  // Replace any prior detected units for this source doc.
  await db
    .delete(detectedUnits)
    .where(
      and(
        eq(detectedUnits.projectId, doc.projectId),
        eq(detectedUnits.sourceDocumentId, sourceDocumentId),
      ),
    );

  try {
    const detected = await detectUnits({
      curriculumName: project.curriculumName,
      projectName: project.name,
      pages: pagesSorted.map((p) => ({
        pageNumber: p.pageNumber,
        textSnippet: p.rawText.slice(0, 200),
      })),
    });
    if (detected.length > 0) {
      await db.insert(detectedUnits).values(
        detected.map((u) => ({
          projectId: doc.projectId,
          sourceDocumentId,
          unitNumber: u.unitNumber,
          unitTitle: u.unitTitle,
          startPage: u.startPage,
          endPage: u.endPage,
          detectionConfidence: u.confidence.toFixed(2),
          llmReasoning: u.reasoning,
        })),
      );
      logInfo('pipeline', `detected ${detected.length} units`, { sourceDocumentId });
    }
  } catch (err) {
    logError(err, 'pipeline.detect-units', { sourceDocumentId });
  }
}

// Stage 4: vocab extraction across all detected units in a project.
// Reads from extracted_pages so it can re-run after stage 1's vision fallback
// has filled in low-text pages.
export async function runVocabExtractionForProject(projectId: string): Promise<void> {
  const project = await db.query.ingestionProjects.findFirst({
    where: eq(ingestionProjects.id, projectId),
  });
  if (!project) return;

  const units = await db
    .select()
    .from(detectedUnits)
    .where(eq(detectedUnits.projectId, projectId))
    .orderBy(asc(detectedUnits.unitNumber));
  if (units.length === 0) return;

  for (const unit of units) {
    try {
      const unitPages = await db
        .select()
        .from(extractedPages)
        .where(eq(extractedPages.sourceDocumentId, unit.sourceDocumentId));
      const inRange = unitPages
        .filter((p) => p.pageNumber >= unit.startPage && p.pageNumber <= unit.endPage)
        .sort((a, b) => a.pageNumber - b.pageNumber);

      const vocab = await extractVocabulary({
        curriculumName: project.curriculumName,
        unitNumber: unit.unitNumber,
        pages: inRange.map((p) => ({
          pageNumber: p.pageNumber,
          text: p.rawText,
          pageType: readPageType(p.layoutJson),
        })),
      });
      if (vocab.length > 0) {
        await db.insert(extractedVocabulary).values(
          vocab.map((v) => ({
            projectId,
            unitId: unit.id,
            word: v.word,
            partOfSpeech: v.partOfSpeech ?? null,
            multiWord: v.multiWord,
            sourcePage: v.sourcePage,
            extractionConfidence: v.confidence.toFixed(2),
            llmReasoning: v.reasoning,
          })),
        );
      }
      logInfo(
        'pipeline',
        `unit ${unit.unitNumber}: extracted ${vocab.length} vocab items`,
        { projectId, unitId: unit.id },
      );
    } catch (err) {
      logError(err, 'pipeline.extract-vocab', { projectId, unitId: unit.id });
    }
  }
}

function readPageType(layoutJson: unknown): PageType | null {
  if (!layoutJson || typeof layoutJson !== 'object') return null;
  const v = (layoutJson as Record<string, unknown>).page_type;
  if (typeof v === 'string') return v as PageType;
  return null;
}

async function rmAndMkdir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dir, { recursive: true });
}

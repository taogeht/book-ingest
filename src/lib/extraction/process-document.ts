// The end-to-end pipeline for a single source document. Called fire-and-forget
// from the upload route; updates DB status as it progresses.

import { db } from '@/lib/db';
import {
  sourceDocuments,
  extractedPages,
  ingestionProjects,
  detectedUnits,
  extractedVocabulary,
} from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { r2Client } from '@/lib/storage/r2-client';
import { parsePdf } from './pdf-parse';
import { detectUnits } from '@/lib/llm/detect-units';
import { extractVocabulary } from '@/lib/llm/extract-vocabulary';
import { logError, logInfo } from '@/lib/logger';

export async function processDocument(sourceDocumentId: string): Promise<void> {
  const doc = await db.query.sourceDocuments.findFirst({
    where: eq(sourceDocuments.id, sourceDocumentId),
  });
  if (!doc) {
    logError(new Error('source document not found'), 'pipeline', { sourceDocumentId });
    return;
  }
  if (doc.fileType !== 'pdf_digital') {
    await db
      .update(sourceDocuments)
      .set({
        status: 'failed',
        parseError: 'Only digital PDFs are supported in Phase 1.',
      })
      .where(eq(sourceDocuments.id, sourceDocumentId));
    return;
  }

  await db
    .update(ingestionProjects)
    .set({ status: 'extracting', updatedAt: new Date() })
    .where(eq(ingestionProjects.id, doc.projectId));

  // 1. Page extraction
  try {
    const buf = await r2Client.getObject(doc.storageKey);
    if (!buf) throw new Error(`R2 object not found: ${doc.storageKey}`);
    const result = await parsePdf(buf);
    if (!result.isDigital) {
      await db
        .update(sourceDocuments)
        .set({
          status: 'failed',
          parseError:
            'Scanned PDFs not yet supported (Phase 2). No extractable text on any page.',
        })
        .where(eq(sourceDocuments.id, sourceDocumentId));
      return;
    }
    await db.insert(extractedPages).values(
      result.pages.map((p) => ({
        sourceDocumentId,
        pageNumber: p.pageNumber,
        rawText: p.rawText,
        layoutJson: p.layout as any,
      })),
    );
    await db
      .update(sourceDocuments)
      .set({ status: 'parsed', pageCount: result.pageCount })
      .where(eq(sourceDocuments.id, sourceDocumentId));
    logInfo('pipeline', `parsed ${result.pageCount} pages`, { sourceDocumentId });
  } catch (err) {
    logError(err, 'pipeline.parse', { sourceDocumentId });
    await db
      .update(sourceDocuments)
      .set({
        status: 'failed',
        parseError: err instanceof Error ? err.message : String(err),
      })
      .where(eq(sourceDocuments.id, sourceDocumentId));
    return;
  }

  // 2. Unit detection
  const project = await db.query.ingestionProjects.findFirst({
    where: eq(ingestionProjects.id, doc.projectId),
  });
  if (!project) return;

  const pages = await db.query.extractedPages.findMany({
    where: eq(extractedPages.sourceDocumentId, sourceDocumentId),
  });
  const pagesSorted = pages.sort((a, b) => a.pageNumber - b.pageNumber);

  let unitsForVocab: Array<{ id: string; unitNumber: number; startPage: number; endPage: number }> = [];
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
      const rows = await db
        .insert(detectedUnits)
        .values(
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
        )
        .returning({
          id: detectedUnits.id,
          unitNumber: detectedUnits.unitNumber,
          startPage: detectedUnits.startPage,
          endPage: detectedUnits.endPage,
        });
      unitsForVocab = rows;
      logInfo('pipeline', `detected ${rows.length} units`, { sourceDocumentId });
    }
  } catch (err) {
    logError(err, 'pipeline.detect-units', { sourceDocumentId });
  }

  // 3. Vocabulary extraction per unit
  for (const unit of unitsForVocab) {
    try {
      const unitPages = pagesSorted.filter(
        (p) => p.pageNumber >= unit.startPage && p.pageNumber <= unit.endPage,
      );
      const vocab = await extractVocabulary({
        curriculumName: project.curriculumName,
        unitNumber: unit.unitNumber,
        pages: unitPages.map((p) => ({ pageNumber: p.pageNumber, text: p.rawText })),
      });
      if (vocab.length > 0) {
        await db.insert(extractedVocabulary).values(
          vocab.map((v) => ({
            projectId: doc.projectId,
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
      logInfo('pipeline', `unit ${unit.unitNumber}: extracted ${vocab.length} vocab items`, {
        sourceDocumentId,
      });
    } catch (err) {
      logError(err, 'pipeline.extract-vocab', { sourceDocumentId, unitId: unit.id });
    }
  }

  await db
    .update(ingestionProjects)
    .set({ status: 'reviewing', updatedAt: new Date() })
    .where(eq(ingestionProjects.id, doc.projectId));
}

import JSZip from 'jszip';
import { db, ingestionProjects, sourceDocuments, detectedUnits, extractedVocabulary } from '@/lib/db';
import { eq, asc } from 'drizzle-orm';
import { r2Client, buildBundleKey } from '@/lib/storage/r2-client';

const BUNDLE_VERSION = '1.0.0';

export type BundleResult = {
  storageKey: string;
  signedUrl: string;
  vocabularyCount: number;
  unitCount: number;
};

export async function generateBundle(projectId: string): Promise<BundleResult> {
  const project = await db.query.ingestionProjects.findFirst({
    where: eq(ingestionProjects.id, projectId),
  });
  if (!project) throw new Error('Project not found');

  const [docs, units, vocab] = await Promise.all([
    db.select().from(sourceDocuments).where(eq(sourceDocuments.projectId, projectId)),
    db
      .select()
      .from(detectedUnits)
      .where(eq(detectedUnits.projectId, projectId))
      .orderBy(asc(detectedUnits.unitNumber)),
    db
      .select()
      .from(extractedVocabulary)
      .where(eq(extractedVocabulary.projectId, projectId))
      .orderBy(asc(extractedVocabulary.sourcePage)),
  ]);

  const approvedVocab = vocab.filter((v) => v.approved === true);
  const exportTs = Date.now();

  const vocabularyJson = approvedVocab.map((v) => {
    const unit = units.find((u) => u.id === v.unitId);
    return {
      id: v.id,
      word: v.word,
      part_of_speech: v.partOfSpeech,
      multi_word: v.multiWord,
      inferred_cefr: v.inferredCefr,
      unit_number: unit?.unitNumber ?? null,
      unit_title: unit?.unitTitle ?? null,
      source_page: v.sourcePage,
    };
  });

  const curriculumJson = {
    name: project.name,
    curriculum_name: project.curriculumName,
    target_level: project.targetLevel,
    language: project.language,
    units: units.map((u) => ({
      unit_number: u.unitNumber,
      unit_title: u.unitTitle,
      start_page: u.startPage,
      end_page: u.endPage,
    })),
  };

  const manifestJson = {
    bundle_version: BUNDLE_VERSION,
    project_id: project.id,
    project_name: project.name,
    curriculum_name: project.curriculumName,
    exported_at: new Date(exportTs).toISOString(),
    counts: {
      units: units.length,
      vocabulary_total: vocab.length,
      vocabulary_approved: approvedVocab.length,
    },
    source_documents: docs.map((d) => ({
      filename: d.filename,
      file_type: d.fileType,
      page_count: d.pageCount,
    })),
  };

  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifestJson, null, 2));
  zip.file('curriculum.json', JSON.stringify(curriculumJson, null, 2));
  zip.file('vocabulary.json', JSON.stringify(vocabularyJson, null, 2));

  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const key = buildBundleKey(projectId, exportTs);
  await r2Client.uploadFile(key, buf, 'application/zip');

  await db
    .update(ingestionProjects)
    .set({ status: 'exported', updatedAt: new Date() })
    .where(eq(ingestionProjects.id, projectId));

  const signedUrl = await r2Client.getSignedDownloadUrl(key, 60 * 60 * 24);

  return {
    storageKey: key,
    signedUrl,
    vocabularyCount: approvedVocab.length,
    unitCount: units.length,
  };
}

export type ExportReadiness = {
  ready: boolean;
  reasons: string[];
  totals: {
    units: number;
    unitsReviewed: number;
    vocabularyTotal: number;
    vocabularyApproved: number;
    vocabularyRejected: number;
    approvedRatio: number;
  };
};

const APPROVED_THRESHOLD = 0.8;

export async function checkExportReadiness(projectId: string): Promise<ExportReadiness> {
  const [units, vocab] = await Promise.all([
    db.select().from(detectedUnits).where(eq(detectedUnits.projectId, projectId)),
    db.select().from(extractedVocabulary).where(eq(extractedVocabulary.projectId, projectId)),
  ]);
  const unitsReviewed = units.filter((u) => u.reviewed).length;
  const approved = vocab.filter((v) => v.approved === true).length;
  const rejected = vocab.filter((v) => v.approved === false).length;
  const reviewedVocab = approved + rejected;
  const approvedRatio = vocab.length === 0 ? 0 : approved / vocab.length;

  const reasons: string[] = [];
  if (units.length === 0) reasons.push('No units detected.');
  if (unitsReviewed < units.length) {
    reasons.push(`${units.length - unitsReviewed} of ${units.length} units not yet reviewed.`);
  }
  if (vocab.length === 0) reasons.push('No vocabulary extracted.');
  else if (approvedRatio < APPROVED_THRESHOLD) {
    reasons.push(
      `Only ${Math.round(approvedRatio * 100)}% of vocabulary approved (need ${Math.round(
        APPROVED_THRESHOLD * 100,
      )}%).`,
    );
  }
  return {
    ready: reasons.length === 0,
    reasons,
    totals: {
      units: units.length,
      unitsReviewed,
      vocabularyTotal: vocab.length,
      vocabularyApproved: approved,
      vocabularyRejected: rejected,
      approvedRatio,
    },
  };
}

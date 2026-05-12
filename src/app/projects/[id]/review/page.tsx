import { notFound } from 'next/navigation';
import { db, ingestionProjects, sourceDocuments, detectedUnits, extractedVocabulary } from '@/lib/db';
import { eq, asc } from 'drizzle-orm';
import { AppShell } from '@/components/AppShell';
import { ReviewTabs } from './ReviewTabs';

export const dynamic = 'force-dynamic';

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await db.query.ingestionProjects.findFirst({
    where: eq(ingestionProjects.id, id),
  });
  if (!project) return notFound();

  const [docs, units, vocab] = await Promise.all([
    db.select().from(sourceDocuments).where(eq(sourceDocuments.projectId, id)),
    db
      .select()
      .from(detectedUnits)
      .where(eq(detectedUnits.projectId, id))
      .orderBy(asc(detectedUnits.unitNumber)),
    db
      .select()
      .from(extractedVocabulary)
      .where(eq(extractedVocabulary.projectId, id))
      .orderBy(asc(extractedVocabulary.sourcePage), asc(extractedVocabulary.word)),
  ]);

  return (
    <AppShell>
      <h1 className="mb-1 text-2xl font-semibold">{project.name}</h1>
      <p className="mb-6 text-sm text-gray-500">{project.curriculumName} · review</p>
      <ReviewTabs
        projectId={id}
        docs={docs.map((d) => ({
          id: d.id,
          filename: d.filename,
          fileType: d.fileType,
          status: d.status,
          pageCount: d.pageCount,
          parseError: d.parseError,
        }))}
        units={units.map((u) => ({
          id: u.id,
          unitNumber: u.unitNumber,
          unitTitle: u.unitTitle,
          startPage: u.startPage,
          endPage: u.endPage,
          confidence: u.detectionConfidence,
          reasoning: u.llmReasoning,
          reviewed: u.reviewed,
        }))}
        vocab={vocab.map((v) => ({
          id: v.id,
          unitId: v.unitId,
          word: v.word,
          partOfSpeech: v.partOfSpeech,
          multiWord: v.multiWord,
          sourcePage: v.sourcePage,
          confidence: v.extractionConfidence,
          reasoning: v.llmReasoning,
          reviewed: v.reviewed,
          approved: v.approved,
        }))}
      />
    </AppShell>
  );
}

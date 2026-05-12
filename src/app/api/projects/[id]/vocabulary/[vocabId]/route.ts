import { NextResponse } from 'next/server';
import { db, extractedVocabulary } from '@/lib/db';
import { and, eq } from 'drizzle-orm';
import { isAuthenticated } from '@/lib/auth';
import { logError } from '@/lib/logger';

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string; vocabId: string }> },
) {
  if (!(await isAuthenticated())) return new NextResponse('Unauthorized', { status: 401 });
  const { id: projectId, vocabId } = await ctx.params;
  try {
    const body = (await req.json()) as Partial<{
      approved: boolean | null;
      reviewed: boolean;
      partOfSpeech: string | null;
      multiWord: boolean;
    }>;
    const update: Record<string, unknown> = {};
    if ('approved' in body) update.approved = body.approved;
    if ('reviewed' in body) update.reviewed = body.reviewed;
    if ('partOfSpeech' in body) update.partOfSpeech = body.partOfSpeech;
    if ('multiWord' in body) update.multiWord = body.multiWord;

    await db
      .update(extractedVocabulary)
      .set(update)
      .where(and(eq(extractedVocabulary.id, vocabId), eq(extractedVocabulary.projectId, projectId)));
    return NextResponse.json({ ok: true });
  } catch (err) {
    logError(err, 'api-vocab-patch');
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

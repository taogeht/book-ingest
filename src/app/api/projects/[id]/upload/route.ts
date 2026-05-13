import { NextResponse } from 'next/server';
import { db, ingestionProjects, sourceDocuments } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { isAuthenticated } from '@/lib/auth';
import { r2Client, buildSourceKey } from '@/lib/storage/r2-client';
import { processDocument } from '@/lib/extraction/process-document';
import { logError } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) return new NextResponse('Unauthorized', { status: 401 });
  const { id: projectId } = await ctx.params;
  try {
    const project = await db.query.ingestionProjects.findFirst({
      where: eq(ingestionProjects.id, projectId),
    });
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file required' }, { status: 400 });
    }

    const ext = file.name.toLowerCase().split('.').pop() ?? '';
    if (ext !== 'pdf' && file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Only PDFs supported in Phase 1' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const storageKey = buildSourceKey(projectId, file.name);
    await r2Client.uploadFile(storageKey, buffer, 'application/pdf');

    // Marker handles digital PDFs and (optionally) OCRs scanned ones via
    // Surya. We classify everything as pdf_digital at upload time and let
    // process-document surface "no extractable content" via the source's
    // parse_error if Marker returns nothing useful.
    const [row] = await db
      .insert(sourceDocuments)
      .values({
        projectId,
        filename: file.name,
        fileType: 'pdf_digital',
        storageKey,
        status: 'uploaded',
      })
      .returning({ id: sourceDocuments.id });

    await db
      .update(ingestionProjects)
      .set({ status: 'uploading', updatedAt: new Date() })
      .where(eq(ingestionProjects.id, projectId));

    void processDocument(row.id).catch((err) => logError(err, 'process-document.async'));

    return NextResponse.json({ id: row.id });
  } catch (err) {
    logError(err, 'api-upload');
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

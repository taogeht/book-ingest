import { NextResponse } from 'next/server';
import { db, ingestionProjects, sourceDocuments } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { isAuthenticated } from '@/lib/auth';
import { r2Client, buildSourceKey } from '@/lib/storage/r2-client';
import { processDocument } from '@/lib/extraction/process-document';
import { parsePdf } from '@/lib/extraction/pdf-parse';
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

    // Quick parse to detect digital vs scanned. If pdfjs can extract *any*
    // text, treat as digital — otherwise mark as scanned.
    let fileType: 'pdf_digital' | 'pdf_scanned' = 'pdf_digital';
    try {
      const probe = await parsePdf(buffer);
      fileType = probe.isDigital ? 'pdf_digital' : 'pdf_scanned';
    } catch (err) {
      logError(err, 'upload.detect-type');
      // If parsing entirely fails, still upload and mark as failed downstream.
      fileType = 'pdf_digital';
    }

    const storageKey = buildSourceKey(projectId, file.name);
    await r2Client.uploadFile(storageKey, buffer, 'application/pdf');

    const [row] = await db
      .insert(sourceDocuments)
      .values({
        projectId,
        filename: file.name,
        fileType,
        storageKey,
        status: fileType === 'pdf_digital' ? 'uploaded' : 'failed',
        parseError:
          fileType === 'pdf_scanned'
            ? 'Scanned PDFs not yet supported (Phase 2). Upload a digital PDF.'
            : null,
      })
      .returning({ id: sourceDocuments.id });

    await db
      .update(ingestionProjects)
      .set({ status: 'uploading', updatedAt: new Date() })
      .where(eq(ingestionProjects.id, projectId));

    if (fileType === 'pdf_digital') {
      // Fire-and-forget. We deliberately don't await this so the upload
      // response returns immediately. Errors surface via the source_documents
      // row's status/parse_error fields.
      void processDocument(row.id).catch((err) => logError(err, 'process-document.async'));
    }

    return NextResponse.json({ id: row.id, fileType });
  } catch (err) {
    logError(err, 'api-upload');
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

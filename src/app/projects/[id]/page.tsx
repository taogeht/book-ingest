import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db, ingestionProjects, sourceDocuments } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { AppShell } from '@/components/AppShell';
import { UploadZone } from './UploadZone';

export const dynamic = 'force-dynamic';

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await db.query.ingestionProjects.findFirst({
    where: eq(ingestionProjects.id, id),
  });
  if (!project) return notFound();

  const sources = await db
    .select()
    .from(sourceDocuments)
    .where(eq(sourceDocuments.projectId, id));

  const reviewReady = sources.some((s) => s.status === 'parsed');

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          <p className="text-sm text-gray-500">{project.curriculumName}</p>
        </div>
        <div className="flex gap-3 text-sm">
          {reviewReady && (
            <Link href={`/projects/${id}/review`} className="rounded border border-gray-300 px-3 py-2 hover:bg-gray-50">
              Review
            </Link>
          )}
          <Link href={`/projects/${id}/export`} className="rounded border border-gray-300 px-3 py-2 hover:bg-gray-50">
            Export
          </Link>
          <span className="rounded bg-gray-100 px-3 py-2 uppercase tracking-wide text-gray-600">
            {project.status}
          </span>
        </div>
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-medium">Upload source PDF</h2>
        <UploadZone projectId={id} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">Source documents</h2>
        {sources.length === 0 ? (
          <p className="text-sm text-gray-500">No documents uploaded yet.</p>
        ) : (
          <ul className="divide-y rounded border border-gray-200 bg-white">
            {sources.map((s) => (
              <li key={s.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <div className="font-medium">{s.filename}</div>
                  <div className="text-xs text-gray-500">
                    {s.fileType} · {s.pageCount ?? '?'} pages
                  </div>
                  {s.parseError && <div className="text-xs text-red-600">{s.parseError}</div>}
                </div>
                <span className="rounded bg-gray-100 px-2 py-1 text-xs uppercase tracking-wide text-gray-600">
                  {s.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}

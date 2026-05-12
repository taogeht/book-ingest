import { notFound } from 'next/navigation';
import { db, ingestionProjects } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { AppShell } from '@/components/AppShell';
import { checkExportReadiness } from '@/lib/export/bundle';
import { ExportButton } from './ExportButton';

export const dynamic = 'force-dynamic';

export default async function ExportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await db.query.ingestionProjects.findFirst({
    where: eq(ingestionProjects.id, id),
  });
  if (!project) return notFound();
  const readiness = await checkExportReadiness(id);

  return (
    <AppShell>
      <h1 className="mb-1 text-2xl font-semibold">Export bundle</h1>
      <p className="mb-6 text-sm text-gray-500">{project.name}</p>

      <div className="mb-6 rounded border border-gray-200 bg-white p-4 text-sm">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Units" value={readiness.totals.units} />
          <Stat label="Units reviewed" value={readiness.totals.unitsReviewed} />
          <Stat label="Vocabulary total" value={readiness.totals.vocabularyTotal} />
          <Stat
            label="Approved"
            value={`${readiness.totals.vocabularyApproved} (${Math.round(
              readiness.totals.approvedRatio * 100,
            )}%)`}
          />
        </div>
      </div>

      {readiness.ready ? (
        <ExportButton projectId={id} />
      ) : (
        <div className="rounded border border-amber-200 bg-amber-50 p-4 text-sm">
          <p className="mb-2 font-medium text-amber-900">
            Export not ready. Resolve the following first:
          </p>
          <ul className="list-disc pl-5 text-amber-900">
            {readiness.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

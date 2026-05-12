import Link from 'next/link';
import { db, ingestionProjects } from '@/lib/db';
import { desc } from 'drizzle-orm';
import { AppShell } from '@/components/AppShell';

export const dynamic = 'force-dynamic';

export default async function ProjectsListPage() {
  const projects = await db
    .select()
    .from(ingestionProjects)
    .orderBy(desc(ingestionProjects.createdAt));

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <Link
          href="/projects/new"
          className="rounded bg-gray-900 px-3 py-2 text-sm text-white"
        >
          New project
        </Link>
      </div>
      {projects.length === 0 ? (
        <p className="text-sm text-gray-500">
          No projects yet. Start by creating one.
        </p>
      ) : (
        <ul className="divide-y rounded border border-gray-200 bg-white">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/projects/${p.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-gray-50"
              >
                <div>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-gray-500">{p.curriculumName}</div>
                </div>
                <span className="rounded bg-gray-100 px-2 py-1 text-xs uppercase tracking-wide text-gray-600">
                  {p.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}

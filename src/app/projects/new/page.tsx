'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';

export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [curriculumName, setCurriculumName] = useState('');
  const [targetLevel, setTargetLevel] = useState('');
  const [language, setLanguage] = useState('en');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          curriculumName,
          targetLevel: targetLevel ? Number(targetLevel) : null,
          language,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Failed to create project');
        return;
      }
      const { id } = await res.json();
      router.push(`/projects/${id}`);
    } catch {
      setError('Network error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <h1 className="mb-6 text-2xl font-semibold">New project</h1>
      <form onSubmit={onSubmit} className="max-w-lg space-y-4 rounded border border-gray-200 bg-white p-6">
        <div>
          <label className="mb-1 block text-sm font-medium">Project name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="AF&F Book 1"
            className="w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Curriculum / series name</label>
          <input
            value={curriculumName}
            onChange={(e) => setCurriculumName(e.target.value)}
            required
            placeholder="American Family and Friends"
            className="w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Target reading level (optional)</label>
          <input
            type="number"
            value={targetLevel}
            onChange={(e) => setTargetLevel(e.target.value)}
            placeholder="e.g. 1"
            className="w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Language</label>
          <input
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-gray-900 px-4 py-2 text-white disabled:opacity-50"
        >
          {submitting ? 'Creating…' : 'Create project'}
        </button>
      </form>
    </AppShell>
  );
}

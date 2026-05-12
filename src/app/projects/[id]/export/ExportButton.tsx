'use client';

import { useState } from 'react';

export function ExportButton({ projectId }: { projectId: string }) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ unitCount: number; vocabularyCount: number } | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/export`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Export failed');
        return;
      }
      const data = await res.json();
      setUrl(data.signedUrl);
      setStats({ unitCount: data.unitCount, vocabularyCount: data.vocabularyCount });
    } catch {
      setError('Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded border border-green-200 bg-green-50 p-4 text-sm">
      <p className="mb-3 text-green-900">All conditions met. Generate a bundle ZIP.</p>
      <button
        onClick={generate}
        disabled={busy}
        className="rounded bg-green-700 px-4 py-2 text-white disabled:opacity-50"
      >
        {busy ? 'Generating…' : 'Generate bundle'}
      </button>
      {error && <p className="mt-3 text-red-700">{error}</p>}
      {url && (
        <div className="mt-4 space-y-2">
          {stats && (
            <p className="text-xs text-green-900">
              {stats.unitCount} units · {stats.vocabularyCount} approved vocabulary entries
            </p>
          )}
          <a
            href={url}
            className="inline-block rounded bg-green-700 px-3 py-2 text-white"
            target="_blank"
            rel="noreferrer"
          >
            Download bundle.zip
          </a>
        </div>
      )}
    </div>
  );
}

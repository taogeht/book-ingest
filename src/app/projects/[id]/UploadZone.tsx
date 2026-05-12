'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export function UploadZone({ projectId }: { projectId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    setProgress(`Uploading ${file.name}…`);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/projects/${projectId}/upload`, {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Upload failed');
        return;
      }
      setProgress('Uploaded — pipeline running in background. Refresh in a minute.');
      router.refresh();
    } catch {
      setError('Network error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="rounded border border-dashed border-gray-300 bg-white p-6 text-sm">
      <label className="flex cursor-pointer flex-col items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          onChange={onChange}
          disabled={uploading}
          className="hidden"
        />
        <span className="rounded bg-gray-900 px-4 py-2 text-white">
          {uploading ? 'Uploading…' : 'Choose PDF'}
        </span>
        <span className="text-xs text-gray-500">Digital PDFs only (Phase 1).</span>
      </label>
      {progress && <p className="mt-3 text-xs text-gray-600">{progress}</p>}
      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
    </div>
  );
}

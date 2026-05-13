import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { runProcess } from './subprocess';
import { r2Client, buildPageImageKey } from '@/lib/storage/r2-client';

const DEFAULT_DPI = 150;

export type RenderedPage = {
  pageNumber: number;
  storageKey: string;
};

// Render every page of `pdfPath` to PNG at 150 DPI using pdftoppm (poppler).
// Uploads each PNG to R2 at ingestion-pages/{projectId}/{sourceDocId}/page-{n}.png.
// Returns the (pageNumber, storageKey) pairs in order.
//
// pdftoppm naming: with no explicit padding flag, it zero-pads to
// ceil(log10(numPages + 1)) digits. We parse the trailing number from each
// filename rather than trying to predict the width.
export async function renderPagesToR2(args: {
  pdfPath: string;
  workDir: string;
  projectId: string;
  sourceDocId: string;
  dpi?: number;
}): Promise<RenderedPage[]> {
  const { pdfPath, workDir, projectId, sourceDocId, dpi = DEFAULT_DPI } = args;
  const prefix = path.join(workDir, 'page');

  const { exitCode, stderr } = await runProcess(
    'pdftoppm',
    ['-r', String(dpi), '-png', pdfPath, prefix],
    { timeoutMs: 10 * 60_000 },
  );
  if (exitCode !== 0) {
    throw new Error(`pdftoppm failed (exit ${exitCode}): ${stderr.slice(-500)}`);
  }

  const entries = await readdir(workDir);
  const pageFiles = entries
    .map((name) => {
      const m = name.match(/^page-(\d+)\.png$/);
      return m ? { name, pageNumber: parseInt(m[1], 10) } : null;
    })
    .filter((x): x is { name: string; pageNumber: number } => !!x)
    .sort((a, b) => a.pageNumber - b.pageNumber);

  const rendered: RenderedPage[] = [];
  for (const file of pageFiles) {
    const buf = await readFile(path.join(workDir, file.name));
    const key = buildPageImageKey(projectId, sourceDocId, file.pageNumber);
    await r2Client.uploadFile(key, buf, 'image/png');
    rendered.push({ pageNumber: file.pageNumber, storageKey: key });
  }
  return rendered;
}

// PDF parsing for digital PDFs using pdfjs-dist (Mozilla's library).
//
// We use the "legacy" build because the modern build expects browser globals
// and a worker; the legacy build runs as a single bundle in Node.

import type { TextItem } from 'pdfjs-dist/types/src/display/api';

export type PageExtraction = {
  pageNumber: number;
  rawText: string;
  layout: {
    width: number;
    height: number;
    items: Array<{ text: string; x: number; y: number; width: number; height: number }>;
  };
};

export type PdfParseResult = {
  pageCount: number;
  pages: PageExtraction[];
  // A digital PDF has *any* extractable text. If every page is empty, we
  // treat it as scanned and bail (Phase 2 will OCR).
  isDigital: boolean;
};

async function loadPdfJs() {
  // pdfjs-dist's modern build pulls in browser-only globals; the legacy build
  // is what works under Node. Using a dynamic import keeps Next from trying to
  // bundle the worker for the edge.
  const mod = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return mod;
}

export async function parsePdf(buffer: Buffer): Promise<PdfParseResult> {
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
  });
  const doc = await loadingTask.promise;
  const pages: PageExtraction[] = [];
  let anyText = false;

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items as TextItem[];

    const lineMap = new Map<number, string[]>();
    const layoutItems: PageExtraction['layout']['items'] = [];
    for (const item of items) {
      const str = (item.str || '').trim();
      if (!str) continue;
      const x = item.transform?.[4] ?? 0;
      const y = item.transform?.[5] ?? 0;
      // Round y to nearest 2px to group items into visual rows.
      const rowKey = Math.round(y / 2) * 2;
      const arr = lineMap.get(rowKey) ?? [];
      arr.push(str);
      lineMap.set(rowKey, arr);
      layoutItems.push({
        text: str,
        x,
        y,
        width: item.width ?? 0,
        height: item.height ?? 0,
      });
      anyText = true;
    }

    // Sort rows top-to-bottom (high y first in PDF coords) and join.
    const orderedRows = Array.from(lineMap.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([, parts]) => parts.join(' '));

    pages.push({
      pageNumber: p,
      rawText: orderedRows.join('\n'),
      layout: {
        width: viewport.width,
        height: viewport.height,
        items: layoutItems,
      },
    });
    page.cleanup();
  }

  await doc.cleanup();
  await doc.destroy();

  return { pageCount: doc.numPages, pages, isDigital: anyText };
}

export function detectFileTypeFromName(filename: string, mimeType: string | undefined) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf') || mimeType === 'application/pdf') return 'pdf';
  if (lower.endsWith('.docx')) return 'docx';
  return 'other';
}

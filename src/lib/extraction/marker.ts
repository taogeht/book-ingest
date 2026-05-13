import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { runProcess } from './subprocess';

export type MarkerBlock = {
  block_type?: string;
  html?: string;
  text?: string;
  page_id?: number;
  polygon?: number[][];
  children?: MarkerBlock[];
  [key: string]: unknown;
};

export type MarkerPage = {
  pageNumber: number;
  rawText: string;
  layoutJson: {
    blocks: MarkerBlock[];
    block_type_counts: Record<string, number>;
    marker_failed?: boolean;
  };
  markerFailed: boolean;
};

const STRIP_KEYS = new Set(['images', 'image_data', 'lowres_image', 'highres_image']);

// Walk a parsed JSON value and remove embedded image blobs / base64 strings.
// Marker's JSON output can include rendered figure thumbnails inline; those
// bloat layout_json for no benefit since we store the canonical page PNG
// separately in R2.
function stripImageBlobs(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripImageBlobs);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (STRIP_KEYS.has(k)) continue;
      out[k] = stripImageBlobs(v);
    }
    return out;
  }
  return node;
}

// Recursively collect plain text from a Marker block subtree.
// Prefers `.text` if present, otherwise strips HTML tags from `.html`.
function collectText(block: MarkerBlock, out: string[]): void {
  if (typeof block.text === 'string' && block.text.trim()) {
    out.push(block.text.trim());
  } else if (typeof block.html === 'string' && block.html.trim()) {
    const stripped = block.html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();
    if (stripped) out.push(stripped);
  }
  if (Array.isArray(block.children)) {
    for (const child of block.children) collectText(child, out);
  }
}

function countBlockTypes(block: MarkerBlock, counts: Record<string, number>): void {
  if (block.block_type) {
    counts[block.block_type] = (counts[block.block_type] ?? 0) + 1;
  }
  if (Array.isArray(block.children)) {
    for (const child of block.children) countBlockTypes(child, counts);
  }
}

// Marker's JSON output is one big tree whose top-level children are Page
// blocks. Each Page block's children are the typed blocks (Text / Heading /
// Picture / Table / etc.) in reading order.
function parseMarkerJson(doc: { children?: MarkerBlock[] }): MarkerPage[] {
  const pages: MarkerPage[] = [];
  if (!doc.children) return pages;

  for (const node of doc.children) {
    if (node.block_type !== 'Page') continue;
    const pageNumber =
      typeof node.page_id === 'number' ? node.page_id + 1 : pages.length + 1;
    const texts: string[] = [];
    const counts: Record<string, number> = {};
    for (const child of node.children ?? []) {
      collectText(child, texts);
      countBlockTypes(child, counts);
    }
    pages.push({
      pageNumber,
      rawText: texts.join('\n'),
      layoutJson: {
        blocks: (node.children ?? []).map((b) => stripImageBlobs(b) as MarkerBlock),
        block_type_counts: counts,
      },
      markerFailed: false,
    });
  }
  return pages;
}

// Run Marker on a PDF and return per-page extraction.
// `outDir` must already exist; Marker writes its output into a subdirectory
// named after the PDF basename.
export async function runMarker(args: {
  pdfPath: string;
  outDir: string;
}): Promise<MarkerPage[]> {
  const { pdfPath, outDir } = args;

  const result = await runProcess(
    'marker_single',
    [pdfPath, '--output_dir', outDir, '--output_format', 'json'],
    { timeoutMs: 30 * 60_000 },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `marker_single failed (exit ${result.exitCode}): ${result.stderr.slice(-1000)}`,
    );
  }

  // Marker writes to outDir/<pdf_stem>/<pdf_stem>.json. We don't depend on
  // the exact naming — just find every .json that isn't a `_meta.json` and
  // pick the first one with a Page-typed children tree.
  const candidates = await findJsonFiles(outDir);
  for (const file of candidates) {
    if (file.endsWith('_meta.json')) continue;
    const raw = await readFile(file, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as any).children) &&
      (parsed as any).children.some((c: any) => c?.block_type === 'Page')
    ) {
      return parseMarkerJson(parsed as { children: MarkerBlock[] });
    }
  }
  throw new Error('marker_single produced no parseable page JSON');
}

async function findJsonFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string): Promise<void> {
    const entries = await readdir(d);
    for (const name of entries) {
      const full = path.join(d, name);
      const s = await stat(full);
      if (s.isDirectory()) await walk(full);
      else if (s.isFile() && name.endsWith('.json')) out.push(full);
    }
  }
  await walk(dir);
  return out;
}

// Heuristic — is this page a picture-word grid?
//   ≥ 4 figure/picture-type blocks AND < 30 words of text.
// Picture-word grids are how ESL textbooks usually present vocabulary, so
// these almost always need the vision fallback to get the labels.
export function isPictureWordGrid(page: MarkerPage): boolean {
  const counts = page.layoutJson.block_type_counts ?? {};
  const figureCount =
    (counts.Picture ?? 0) + (counts.Figure ?? 0) + (counts.PictureGroup ?? 0);
  const words = page.rawText.split(/\s+/).filter(Boolean).length;
  return figureCount >= 4 && words < 30;
}

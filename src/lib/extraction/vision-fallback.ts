import { z } from 'zod';
import { getAnthropic, MODEL, parseJsonBlock } from '@/lib/llm/client';
import { r2Client } from '@/lib/storage/r2-client';

export const PAGE_TYPES = [
  'vocabulary_grid',
  'reading_passage',
  'exercise',
  'dialogue',
  'other',
] as const;
export type PageType = (typeof PAGE_TYPES)[number];

const visionResponseSchema = z.object({
  text_content: z.string(),
  vocabulary_candidates: z
    .array(
      z.object({
        word: z.string(),
        appears_with_image: z.boolean().optional(),
        position_hint: z.string().optional(),
      }),
    )
    .default([]),
  page_type: z.enum(PAGE_TYPES),
});

export type VisionPageResult = {
  textContent: string;
  vocabularyCandidates: Array<{
    word: string;
    appearsWithImage: boolean;
    positionHint: string | null;
  }>;
  pageType: PageType;
};

const SYSTEM = `You are looking at a page from an ESL textbook. Extract any text visible on this page, including words that appear as labels inside or beside pictures.

Return JSON of exactly this shape:

{
  "text_content": "all readable text on the page, in reading order",
  "vocabulary_candidates": [
    { "word": "...", "appears_with_image": true, "position_hint": "..." }
  ],
  "page_type": "vocabulary_grid" | "reading_passage" | "exercise" | "dialogue" | "other"
}

Be aggressive about extracting picture-labels — words next to or below small illustrations are almost certainly vocabulary items. Be conservative about extracting words from reading passages or exercises — those aren't new vocabulary unless explicitly marked.

JSON only, no prose.`;

const USER_PROMPT = `Extract the text on this page following the rules in the system prompt. Output JSON only.`;

export async function runVisionOnPage(args: {
  pageImageKey: string;
}): Promise<VisionPageResult> {
  const { pageImageKey } = args;
  const imgBuf = await r2Client.getObject(pageImageKey);
  if (!imgBuf) {
    throw new Error(`page image not found in R2: ${pageImageKey}`);
  }
  const base64 = imgBuf.toString('base64');

  const client = getAnthropic();
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: base64 },
          },
          { type: 'text', text: USER_PROMPT },
        ],
      },
    ],
  });
  const block = res.content.find((b) => b.type === 'text');
  const raw = block && block.type === 'text' ? block.text : '';
  const parsed = visionResponseSchema.parse(parseJsonBlock(raw));

  return {
    textContent: parsed.text_content,
    vocabularyCandidates: parsed.vocabulary_candidates.map((v) => ({
      word: v.word,
      appearsWithImage: v.appears_with_image ?? false,
      positionHint: v.position_hint ?? null,
    })),
    pageType: parsed.page_type,
  };
}

// Run vision-fallback across many pages with bounded concurrency.
// Default cap of 5 in-flight calls — Anthropic accepts more, but we throttle
// to keep the failure mode of one ingest predictable (Movers 7 = ~80 pages,
// AF&F Book 1 = ~120 pages; vision triggers on maybe 20-40 of those).
export async function runVisionOnPages<T extends { pageImageKey: string }>(
  pages: T[],
  concurrency = 5,
): Promise<Array<{ page: T; result: VisionPageResult | null; error?: string }>> {
  const out: Array<{ page: T; result: VisionPageResult | null; error?: string }> = new Array(
    pages.length,
  );
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= pages.length) return;
      const page = pages[i];
      try {
        const result = await runVisionOnPage({ pageImageKey: page.pageImageKey });
        out[i] = { page, result };
      } catch (err) {
        out[i] = {
          page,
          result: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pages.length) }, worker));
  return out;
}

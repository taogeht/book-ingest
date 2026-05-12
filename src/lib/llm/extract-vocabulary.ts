import { z } from 'zod';
import { callJson } from './client';

const vocabSchema = z.object({
  word: z.string(),
  part_of_speech: z.string().nullable().optional(),
  multi_word: z.boolean(),
  source_page: z.number().int().positive(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

const responseSchema = z.object({
  vocabulary_pages: z
    .array(z.number().int())
    .describe('Pages within this unit that contain explicit vocabulary lists.'),
  vocabulary: z.array(vocabSchema),
});

export type VocabularyItemOut = {
  word: string;
  partOfSpeech: string | null;
  multiWord: boolean;
  sourcePage: number;
  confidence: number;
  reasoning: string;
};

export type ExtractVocabularyInput = {
  curriculumName: string;
  unitNumber: number;
  pages: Array<{ pageNumber: number; text: string }>;
};

const SYSTEM = `You are an expert ESL/EFL curriculum extractor. Given the raw text of pages from a single textbook unit, identify the explicit vocabulary words being taught in that unit.

Two-step process:
1. Identify which pages contain explicit vocabulary lists (headings like "New words", "Vocabulary", "Key words", or visually obvious word lists with images).
2. From those pages, extract each vocabulary entry.

Rules:
- ONLY extract words that are clearly presented as vocabulary items in this unit. Do NOT extract incidental words from reading passages, instructions, or exercises.
- For multi-word entries ("good morning", "ice cream"), set multi_word=true and treat the full phrase as a single entry.
- For part_of_speech, use the POS as taught in this unit (e.g., "play" introduced as a verb even if also a noun). If unclear, return null.
- Be conservative with confidence: 0.95+ for items inside an explicit vocabulary list, 0.6-0.8 for items inferred from picture-word labels, < 0.5 for guesses.
- source_page must be the page where the word appears as a vocabulary entry.

Output strictly:
{
  "vocabulary_pages": [4, 5],
  "vocabulary": [
    {
      "word": "apple",
      "part_of_speech": "noun",
      "multi_word": false,
      "source_page": 5,
      "confidence": 0.98,
      "reasoning": "Listed under 'New words' on page 5 next to an illustration."
    }
  ]
}
No prose, JSON only.`;

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '…';
}

export async function extractVocabulary(input: ExtractVocabularyInput): Promise<VocabularyItemOut[]> {
  // Cap per-page text to keep prompt within reason. Each page typically <2k chars
  // after layout reconstruction; clamp to 3000 to be safe.
  const pageBlock = input.pages
    .map((p) => `--- Page ${p.pageNumber} ---\n${truncate(p.text, 3000)}`)
    .join('\n\n');

  const user = `Curriculum: ${input.curriculumName}
Unit number: ${input.unitNumber}
Page texts (full):

${pageBlock}

Identify vocabulary lists and extract entries. Output JSON only.`;

  const { data } = await callJson<unknown>({ system: SYSTEM, user, maxTokens: 6000 });
  const parsed = responseSchema.parse(data);
  return parsed.vocabulary.map((v) => ({
    word: v.word.trim(),
    partOfSpeech: v.part_of_speech?.trim() || null,
    multiWord: v.multi_word,
    sourcePage: v.source_page,
    confidence: v.confidence,
    reasoning: v.reasoning,
  }));
}

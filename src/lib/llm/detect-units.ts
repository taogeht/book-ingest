import { z } from 'zod';
import { callJson } from './client';

const unitSchema = z.object({
  unit_number: z.number().int(),
  unit_title: z.string(),
  start_page: z.number().int().positive(),
  end_page: z.number().int().positive(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

const responseSchema = z.object({
  units: z.array(unitSchema),
});

export type DetectedUnitOut = {
  unitNumber: number;
  unitTitle: string;
  startPage: number;
  endPage: number;
  confidence: number;
  reasoning: string;
};

export type DetectUnitsInput = {
  curriculumName: string;
  projectName: string;
  pages: Array<{ pageNumber: number; textSnippet: string }>;
};

const SYSTEM = `You are an expert curriculum analyst specializing in ESL/EFL textbooks. Given a list of page-text snippets from a textbook, identify the boundaries of teaching units.

Rules:
- A textbook usually starts with frontmatter (table of contents, copyright, etc.) — skip those pages.
- Many curricula have a "Starter Unit" or "Welcome" section before Unit 1. Treat them as a unit and assign unit_number 0.
- Review/assessment sections between units are NOT units — group them with the preceding unit's end_page or omit them entirely.
- Be conservative: if a unit's boundary is unclear, set confidence < 0.7.
- start_page and end_page must be inclusive page numbers from the input.
- Every page from start_page to end_page should plausibly belong to that unit.

Output strictly the JSON shape:
{
  "units": [
    {
      "unit_number": 0,
      "unit_title": "Starter: Hello",
      "start_page": 4,
      "end_page": 9,
      "confidence": 0.92,
      "reasoning": "Page 4 has heading 'Starter Unit: Hello' and unit follows the pattern of subsequent units."
    }
  ]
}
No prose, no markdown, JSON only.`;

export async function detectUnits(input: DetectUnitsInput): Promise<DetectedUnitOut[]> {
  const pageBlock = input.pages
    .map((p) => `Page ${p.pageNumber}: ${p.textSnippet.replace(/\s+/g, ' ').trim()}`)
    .join('\n');

  const user = `Curriculum: ${input.curriculumName}
Project name: ${input.projectName}
Total pages: ${input.pages.length}

Page snippets (first ~200 chars each):
${pageBlock}

Identify the units. Output JSON only.`;

  const { data } = await callJson<unknown>({ system: SYSTEM, user, maxTokens: 8000 });
  const parsed = responseSchema.parse(data);
  return parsed.units.map((u) => ({
    unitNumber: u.unit_number,
    unitTitle: u.unit_title,
    startPage: u.start_page,
    endPage: u.end_page,
    confidence: u.confidence,
    reasoning: u.reasoning,
  }));
}

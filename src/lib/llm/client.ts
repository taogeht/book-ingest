import Anthropic from '@anthropic-ai/sdk';

let _client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  _client = new Anthropic({ apiKey: key });
  return _client;
}

export const MODEL = 'claude-sonnet-4-6';

// Strip prose around a JSON block and parse it. Claude will sometimes wrap
// JSON in ```json fences or add an intro line; this is the simplest robust
// way to get a structured object back without function-calling.
export function parseJsonBlock<T = unknown>(raw: string): T {
  let text = raw.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) text = fenceMatch[1].trim();
  const firstBrace = text.indexOf('{');
  const firstBracket = text.indexOf('[');
  const start =
    firstBrace === -1
      ? firstBracket
      : firstBracket === -1
        ? firstBrace
        : Math.min(firstBrace, firstBracket);
  if (start === -1) throw new Error(`No JSON found in LLM output: ${raw.slice(0, 200)}`);
  text = text.slice(start);
  // Find matching closing brace/bracket — naive but works for well-formed output.
  return JSON.parse(text) as T;
}

export async function callJson<T>(args: {
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<{ data: T; raw: string }> {
  const client = getAnthropic();
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: args.maxTokens ?? 8000,
    system: args.system,
    messages: [{ role: 'user', content: args.user }],
  });
  const block = res.content.find((b) => b.type === 'text');
  const raw = block && block.type === 'text' ? block.text : '';
  const data = parseJsonBlock<T>(raw);
  return { data, raw };
}

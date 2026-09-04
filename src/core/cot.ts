/**
 * Cleaning for reasoning traces (`extra.reasoning`). Two extra noise sources
 * compared with message text:
 *   1. restated system prompt / world-info entries: sentences repeated across many traces
 *   2. JSON schema residue ("type": "string")
 */

/** JSON key/value lines: `"type": "string",` / `type: string` */
const JSON_LINE = /^\s*"?[A-Za-z_$][\w$-]*"?\s*:\s*("?[^",{}[\]]{0,80}"?|\{|\[|true|false|null|-?\d+(\.\d+)?)\s*,?\s*$/;
/** Common JSON-schema keys; as standalone tokens they are almost always residue. */
const SCHEMA_WORDS = new Set([
  'string', 'number', 'boolean', 'object', 'array', 'null', 'true', 'false',
  'type', 'value', 'check', 'items', 'properties', 'required', 'enum',
  'default', 'format', 'title', 'description', 'schema', 'const', 'ref',
]);

export function stripJsonLines(text: string): string {
  const lines = text.split('\n');
  const drop = lines.map((l) => JSON_LINE.test(l) && !/[㐀-鿿]/.test(l));
  // Like code lines, require 2+ consecutive lines.
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (drop[i] && (drop[i - 1] || drop[i + 1])) continue;
    out.push(lines[i]);
  }
  return out.join('\n');
}

export const COT_SCHEMA_STOPWORDS = [...SCHEMA_WORDS];

/**
 * Sentences that appear in a large share of traces are restated prompts, not reasoning.
 *
 * @param ratio share of traces a sentence must appear in to count as a template (default 0.25)
 */
export function findBoilerplate(texts: string[], ratio = 0.25): Set<string> {
  if (texts.length < 4) return new Set();
  const seen = new Map<string, number>();
  for (const t of texts) {
    // Count traces, not occurrences within a trace.
    const inThis = new Set<string>();
    for (const s of splitSentences(t)) if (s.length >= 12) inThis.add(s);
    for (const s of inThis) seen.set(s, (seen.get(s) ?? 0) + 1);
  }
  const cut = Math.max(2, Math.ceil(texts.length * ratio));
  const out = new Set<string>();
  for (const [s, n] of seen) if (n >= cut) out.add(s);
  return out;
}

function splitSentences(t: string): string[] {
  return t
    .split(/(?<=[。！？；\n])|(?<=[.!?]\s)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function stripBoilerplate(text: string, boilerplate: Set<string>): string {
  if (boilerplate.size === 0) return text;
  return splitSentences(text).filter((s) => !boilerplate.has(s)).join('\n');
}

export interface CotCleanResult {
  texts: string[];
  /** Number of template sentences removed. */
  boilerplateSentences: number;
  rawChars: number;
  cleanChars: number;
}

/**
 * Clean a batch of traces. Must run on the whole batch because the cross-trace
 * repetition test needs all of them.
 *
 * @param baseClean the message-text cleaner, reused as-is
 */
export function cleanReasoning(
  raw: string[],
  baseClean: (s: string) => string,
): CotCleanResult {
  const rawChars = raw.reduce((a, t) => a + t.length, 0);
  const step1 = raw.map((t) => stripJsonLines(baseClean(t)));
  const boilerplate = findBoilerplate(step1);
  const texts = step1.map((t) => stripBoilerplate(t, boilerplate)).filter((t) => t.trim());
  return {
    texts,
    boilerplateSentences: boilerplate.size,
    rawChars,
    cleanChars: texts.reduce((a, t) => a + t.length, 0),
  };
}

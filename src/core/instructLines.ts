/**
 * Human-maintained table of SillyTavern *core* instruct sequences.
 * These are not plugin names: they are literals from instruct-mode presets
 * (notes/docs/32 §1.7). Only a whole trimmed line that equals an entry
 * (or `<|im_start|>role` / `<|start_header_id|>role`) is removed.
 */
const EXACT = new Set([
  '### Instruction:',
  '### Response:',
  '### Input:',
  '### System:',
  '### Human:',
  '### Assistant:',
  '<|im_start|>',
  '<|im_end|>',
  '<|im_start|>user',
  '<|im_start|>assistant',
  '<|im_start|>system',
  '<|im_start|>user<|im_end|>',
  '[INST]',
  '[/INST]',
  '<<SYS>>',
  '<</SYS>>',
  '<|start_header_id|>',
  '<|end_header_id|>',
  '<|eot_id|>',
  '<|eom_id|>',
  '<|endoftext|>',
  '</s>',
  '<s>',
]);

const START_ROLE = /^<\|(?:im_start|start_header_id)\|>[A-Za-z][A-Za-z0-9_-]{0,20}$/;

export function isInstructLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (EXACT.has(t)) return true;
  return START_ROLE.test(t);
}

/** Drop whole lines that are ST instruct sequences. Story sentences are untouched. */
export function stripInstructLines(text: string): string {
  if (!text.includes('<') && !text.includes('#') && !text.includes('[')) return text;
  return text.split('\n').filter((l) => !isInstructLine(l)).join('\n');
}

/** Exposed for tests that assert the table is finite and literal. */
export function instructExactSize(): number {
  return EXACT.size;
}

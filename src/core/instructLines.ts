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

/*
 * Two structural shapes above the whole-line table, both read straight off
 * `formatInstructModeChat` (instruct-mode.js):
 *
 *     const separator = instruct.wrap ? '\n' : '';
 *     const text = [prefix, mes + suffix].filter(x => x).join(separator);
 *
 * so ONE turn is rendered as `prefix` + separator + `mes` + `suffix`, and the
 * preset's `wrap` flag decides whether that lands on one line or several.
 *
 *   wrap:false — Llama 2 Chat has input_sequence "[INST] " / input_suffix
 *     " [/INST]\n" / wrap false, so a whole turn is a SINGLE line that opens
 *     with the prefix and closes with the suffix.  → SEQ_OPEN…SEQ_CLOSE below.
 *
 *   wrap:true  — Alpaca has input_sequence "### Instruction:" /
 *     input_suffix "\n\n" (whitespace only) / wrap true, so the prompt body
 *     sits on its own line(s) with nothing but the NEXT sequence line to end
 *     it.  → PROMPT_OPEN … REPLY_OPEN below.
 *
 * Both judgements are pair-of-delimiters shapes over a literal core table,
 * never plugin wording. The block rule only ever eats what sits between a
 * *prompt-side* opener (input_/system_sequence) and the *reply-side* opener
 * that follows it (output_sequence): by the template's own construction that
 * span is the prompt, and the reply — the text a reader actually saw — begins
 * after the reply-side opener and is left alone.
 */

/** `input_sequence` / `system_sequence` values across the shipped presets. */
const PROMPT_OPEN = new Set([
  '### Instruction:', '### Input:', '### System:', '### Human:',
  '<|im_start|>user', '<|im_start|>system',
  '<|start_header_id|>user', '<|start_header_id|>system',
  '[INST]', '<<SYS>>',
]);

/** `output_sequence` / `first_output_sequence` / `last_output_sequence` values. */
const REPLY_OPEN = new Set([
  '### Response:', '### Assistant:',
  '<|im_start|>assistant', '<|start_header_id|>assistant',
]);

/** Opens a turn (wrap:false single-line form). */
const SEQ_OPEN = /^(?:\[INST\]|<<SYS>>|<\|im_start\|>[A-Za-z][A-Za-z0-9_-]{0,20}|<\|start_header_id\|>[A-Za-z][A-Za-z0-9_-]{0,20}(?:<\|end_header_id\|>)?)/;
/** Closes it: `input_suffix` / `output_suffix` / `stop_sequence` literals. */
const SEQ_CLOSE = /(?:\[\/INST\]|<<\/SYS>>|<\|im_end\|>|<\|eot_id\|>|<\|eom_id\|>|<\|endoftext\|>|<\/s>)$/;

/** A whole turn collapsed onto one line by a wrap:false preset. */
function isWrappedTurnLine(line: string): boolean {
  const t = line.trim();
  const open = SEQ_OPEN.exec(t);
  if (!open) return false;
  const close = SEQ_CLOSE.exec(t);
  if (!close || close.index < open[0].length) return false;
  return t.slice(open[0].length, close.index).trim().length > 0;
}

/**
 * Longest prompt block we will drop. A leaked template repeats one short
 * instruction; anything longer is more likely story that happens to sit
 * between two scaffolding tokens, so we leave it.
 */
const MAX_PROMPT_BLOCK = 6;

/** Drop whole lines that are ST instruct sequences. Story sentences are untouched. */
export function stripInstructLines(text: string): string {
  if (!text.includes('<') && !text.includes('#') && !text.includes('[')) return text;
  const lines = text.split('\n');
  const drop = new Array<boolean>(lines.length).fill(false);

  for (let i = 0; i < lines.length; i++) {
    if (isInstructLine(lines[i]) || isWrappedTurnLine(lines[i])) drop[i] = true;
  }

  // Prompt-side block: prompt opener … next reply-side opener.
  for (let i = 0; i < lines.length; i++) {
    if (!PROMPT_OPEN.has(lines[i].trim())) continue;
    let body = 0;
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (!t) continue;
      if (REPLY_OPEN.has(t)) {
        if (body > 0) for (let k = i + 1; k < j; k++) drop[k] = true;
        break;
      }
      if (isInstructLine(lines[j])) break;   // some other sequence closed it first
      if (++body > MAX_PROMPT_BLOCK) break;
    }
  }

  return lines.filter((_, i) => !drop[i]).join('\n');
}

/** Exposed for tests that assert the table is finite and literal. */
export function instructExactSize(): number {
  return EXACT.size;
}

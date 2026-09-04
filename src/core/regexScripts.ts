/**
 * SillyTavern regex scripts as cleaning rules. The scripts describe exactly the
 * markup a preset makes the model emit, so applying them to the raw log removes
 * that scaffolding before tokenization.
 */
export interface CleanRule {
  find: string;
  flags: string;
  /** Replacement; '' removes the match. `$1`-style references are kept. */
  replace: string;
  name?: string;
}

interface RegexScript {
  scriptName?: string;
  findRegex?: string;
  replaceString?: string;
  placement?: number[];
  markdownOnly?: boolean;
  promptOnly?: boolean;
  disabled?: boolean;
}

/** True when the JSON is a SillyTavern regex export (an array of scripts). */
export function isRegexScriptFile(json: unknown): json is RegexScript[] {
  return Array.isArray(json) && json.length > 0 && json.every((x) => x && typeof x === 'object' && 'findRegex' in x);
}

/** Patterns that match the whole text are prompt shaping, not markup. */
const WHOLE_TEXT = /^\/?\^?\(?\[\\s\\S\]\*\)?\$?\/?[a-z]*$/;

/** Parse a `/body/flags` literal or a bare pattern into a rule; null when the script is not usable for cleaning. */
function toRule(script: RegexScript): CleanRule | null {
  if (script.disabled || !script.findRegex) return null;
  const rep = script.replaceString ?? '';
  // Macros and prompt-shaping scripts do not describe display markup
  if (/\$fn:|\{\{/.test(rep)) return null;
  // Prompt-only scripts shape what the model sees, not what was displayed; only pure removals are usable
  if (script.promptOnly && rep !== '') return null;
  if (WHOLE_TEXT.test(script.findRegex.trim())) return null;
  const m = /^\/([\s\S]+)\/([a-z]*)$/.exec(script.findRegex.trim());
  const body = m ? m[1] : script.findRegex;
  let flags = m ? m[2] : '';
  if (!flags.includes('g')) flags += 'g';
  try { new RegExp(body, flags); } catch { return null; }
  // Beautifiers replace markup with HTML; for cleaning the block is simply removed.
  const replace = /<[a-z]/i.test(rep) ? '' : rep.replace(/\$\{(\d)\}/g, '$$$1');
  return { find: body, flags, replace, name: script.scriptName };
}

export function parseRegexScripts(json: unknown): CleanRule[] {
  if (!isRegexScriptFile(json)) return [];
  const rules: CleanRule[] = [];
  const seen = new Set<string>();
  for (const s of json) {
    const r = toRule(s);
    if (r && !seen.has(r.find)) { seen.add(r.find); rules.push(r); }
  }
  return rules;
}

const cache = new Map<string, RegExp>();

/** Apply rules in order. A rule that wipes nearly the whole text is skipped. */
export function applyRules(text: string, rules: readonly CleanRule[] | undefined): string {
  if (!rules?.length) return text;
  let t = text;
  for (const r of rules) {
    const key = r.find + ' ' + r.flags;
    let re = cache.get(key);
    if (!re) {
      try { re = new RegExp(r.find, r.flags); } catch { continue; }
      cache.set(key, re);
    }
    re.lastIndex = 0;
    const next = t.replace(re, r.replace);
    if (next.length < t.length * 0.1 && t.length > 200) continue;
    t = next;
  }
  return t;
}

/** Merge rule lists, keeping the first occurrence of each pattern. */
export function mergeRules(...lists: (readonly CleanRule[] | undefined)[]): CleanRule[] {
  const out: CleanRule[] = [];
  const seen = new Set<string>();
  for (const l of lists) for (const r of l ?? []) if (!seen.has(r.find)) { seen.add(r.find); out.push(r); }
  return out;
}

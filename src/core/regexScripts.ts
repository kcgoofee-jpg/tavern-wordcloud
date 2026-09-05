/**
 * SillyTavern regex scripts as cleaning rules. The scripts describe exactly the
 * markup a preset makes the model emit, so applying them to the raw log removes
 * that scaffolding before tokenization.
 */
/** SillyTavern regex_placement (regex-engine.js). */
export const REGEX_PLACEMENT = {
  USER_INPUT: 1,
  AI_OUTPUT: 2,
  SLASH_COMMAND: 3,
  WORLD_INFO: 5,
  REASONING: 6,
} as const;

export interface CleanRule {
  find: string;
  flags: string;
  /** Replacement; '' removes the match. `$1`-style references are kept. */
  replace: string;
  name?: string;
  /** regex_placement values this script applies to; empty/absent = all. */
  placement?: number[];
  /** Display-layer script; applied before generic scripts. */
  markdownOnly?: boolean;
  /** Strings stripped from `$n` capture groups (regex-engine.js filterString). */
  trimStrings?: string[];
}

interface RegexScript {
  scriptName?: string;
  findRegex?: string;
  replaceString?: string;
  placement?: number[];
  markdownOnly?: boolean;
  promptOnly?: boolean;
  disabled?: boolean;
  trimStrings?: string[];
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
  if (NESTED_QUANT.test(body)) return null;
  try { new RegExp(body, flags); } catch { return null; }
  // Beautifiers replace markup with HTML; for cleaning the block is simply removed.
  const replace = /<[a-z]/i.test(rep) ? '' : rep.replace(/\$\{(\d)\}/g, '$$$1');
  const trim = Array.isArray(script.trimStrings)
    ? script.trimStrings.filter((s): s is string => typeof s === 'string' && s.length > 0)
    : undefined;
  return {
    find: body,
    flags,
    replace,
    name: script.scriptName,
    placement: Array.isArray(script.placement) ? script.placement.filter((n) => typeof n === 'number') : undefined,
    markdownOnly: script.markdownOnly === true,
    ...(trim?.length ? { trimStrings: trim } : {}),
  };
}

export function parseRegexScripts(json: unknown): CleanRule[] {
  if (!isRegexScriptFile(json)) return [];
  const rules: CleanRule[] = [];
  const seen = new Set<string>();
  for (const s of json) {
    const r = toRule(s);
    if (r && !seen.has(r.find)) { seen.add(r.find); rules.push(r); }
  }
  // markdownOnly describes the display layer (regex-engine.js isMarkdown); apply first.
  rules.sort((a, b) => Number(!!b.markdownOnly) - Number(!!a.markdownOnly));
  return rules;
}

/** Nested quantifiers like `(a+)+$` — the server drops these; the browser must too. */
const NESTED_QUANT = /\([^()]*[+*][^()]*\)[+*?{]/;

const cache = new Map<string, RegExp>();

function applyOne(t: string, r: CleanRule, re: RegExp): string {
  if (!r.trimStrings?.length || !/\$\d/.test(r.replace)) return t.replace(re, r.replace);
  const trims = r.trimStrings;
  return t.replace(re, (...args: string[]) =>
    r.replace.replace(/\$(\d+)/g, (_, n: string) => {
      let g = args[Number(n)] ?? '';
      for (const s of trims) g = g.split(s).join('');
      return g;
    }),
  );
}

/** Apply rules in order. A rule that wipes nearly the whole text is skipped. */
export function applyRules(
  text: string,
  rules: readonly CleanRule[] | undefined,
  /** regex_placement; omitted = do not filter. */
  placement?: number,
): string {
  if (!rules?.length) return text;
  let t = text;
  for (const r of rules) {
    if (placement != null && r.placement?.length && !r.placement.includes(placement)) continue;
    if (NESTED_QUANT.test(r.find)) continue;
    const key = r.find + ' ' + r.flags;
    let re = cache.get(key);
    if (!re) {
      try { re = new RegExp(r.find, r.flags); } catch { continue; }
      cache.set(key, re);
    }
    re.lastIndex = 0;
    const next = applyOne(t, r, re);
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

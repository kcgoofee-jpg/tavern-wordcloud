import type { WordCount, WordOverride } from './types';

const MAX_PRIORITY = 50;
const MAX_LEN = 32;
/** Splits on ASCII ';', fullwidth '；', and treats fullwidth space as whitespace to trim. */
const SEP_RE = /[;；]/;

/**
 * Parses the raw priority-words input into an ordered, deduped list.
 * Case-insensitive dedupe keeps the first spelling seen; empties are dropped;
 * items longer than 32 chars are dropped whole (not truncated); result capped at 50.
 */
export function parsePriority(input: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.split(SEP_RE)) {
    const item = raw.replace(/　/g, ' ').trim();
    if (!item) continue;
    if (item.length > MAX_LEN) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= MAX_PRIORITY) break;
  }
  return out;
}

/**
 * Applies priority words on top of the tokenizer output, per notes/docs/27 section 1:
 * c_i = maxC * (1 + (n - i) / n), i from 0. Existing words have their count replaced;
 * missing ones are added as `kind: 'plain', priority: true`. Does not mutate `words`.
 */
export function applyPriority(words: WordCount[], priority: string[]): WordCount[] {
  const n = priority.length;
  if (n === 0) return words;
  const maxC = words.reduce((m, w) => Math.max(m, w.count), 0) || 1;

  const byKey = new Map<string, number>(); // lowercase text -> index in `next`
  const next = words.map((w) => ({ ...w }));
  next.forEach((w, i) => byKey.set(w.text.toLowerCase(), i));

  priority.forEach((p, i) => {
    const c = maxC * (1 + (n - i) / n);
    const key = p.toLowerCase();
    const idx = byKey.get(key);
    if (idx !== undefined) {
      next[idx] = { ...next[idx], count: c, priority: true };
    } else {
      byKey.set(key, next.length);
      next.push({ text: p, count: c, kind: 'plain', priority: true });
    }
  });

  return next;
}

/** Follows an alias chain from `from`; true if it ever reaches `to` (or loops back to `from`). */
export function hasAliasCycle(
  ov: Record<string, WordOverride>,
  from: string,
  to: string,
): boolean {
  const fromKey = from.toLowerCase();
  let cur = to.toLowerCase();
  const visited = new Set<string>();
  while (true) {
    if (cur === fromKey) return true;
    if (visited.has(cur)) return false; // pre-existing unrelated cycle; not ours to report
    visited.add(cur);
    const next = ov[cur]?.alias;
    if (!next) return false;
    cur = next.toLowerCase();
  }
}

/**
 * Applies display/alias/rotate/kind overrides. Alias follows multi-hop chains to the final
 * target and merges counts there; a cyclic alias entry is ignored (word keeps its own count).
 * display/rotate/kind are attached directly to the word's own entry. Keys match case-insensitively.
 * Does not mutate `words`.
 */
export function applyOverrides(
  words: WordCount[],
  ov: Record<string, WordOverride>,
): WordCount[] {
  if (Object.keys(ov).length === 0) return words;

  const next = words.map((w) => ({ ...w }));
  const idxByKey = new Map<string, number>();
  next.forEach((w, i) => idxByKey.set(w.text.toLowerCase(), i));

  /** Resolves the final alias target for `key`, or null if there's a cycle. */
  function resolveTarget(key: string): string | null {
    let cur = key;
    const seen = new Set<string>([key]);
    for (;;) {
      const target = ov[cur]?.alias;
      if (!target) return cur;
      const tKey = target.toLowerCase();
      if (seen.has(tKey)) return null; // cycle
      seen.add(tKey);
      cur = tKey;
    }
  }

  // Merge aliased counts into their final targets first.
  for (const key of Object.keys(ov)) {
    const entry = ov[key];
    if (!entry.alias) continue;
    const srcIdx = idxByKey.get(key);
    if (srcIdx === undefined) continue;
    const finalKey = resolveTarget(key);
    if (finalKey === null || finalKey === key) continue; // cyclic: ignore this alias
    let dstIdx = idxByKey.get(finalKey);
    if (dstIdx === undefined) {
      // Alias target not present in the word list; nothing to merge into.
      continue;
    }
    next[dstIdx] = { ...next[dstIdx], count: next[dstIdx].count + next[srcIdx].count };
    next[srcIdx] = { ...next[srcIdx], count: 0 };
  }

  // Apply display/rotate/kind directly (alias'd-away words keep them too, though count is 0).
  for (const [key, entry] of Object.entries(ov)) {
    const idx = idxByKey.get(key);
    if (idx === undefined) continue;
    const patch: Partial<WordCount> = {};
    if (entry.display !== undefined) patch.display = entry.display;
    if (entry.rotate !== undefined) patch.rotate = entry.rotate;
    if (entry.kind !== undefined) patch.kind = entry.kind;
    if (Object.keys(patch).length) next[idx] = { ...next[idx], ...patch };
  }

  return next.filter((w) => w.count > 0);
}

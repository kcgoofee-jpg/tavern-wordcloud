/**
 * Lightweight co-occurrence index (notes/docs/27 s2.2).
 *
 * The tokenizer does not keep per-message token lists, so presence is measured by
 * substring scan over the cleaned messages — the same technique the generic-word
 * detector in analyze.ts already uses. Only the head of the frequency list is
 * indexed: those are the words that can reach the cloud and therefore the only
 * ones the equivalence picker can offer.
 *
 * It is analysis-time scratch data: never shared, exported or contributed
 * (see `stripCooccur`, used before the result leaves the app).
 */

/** Words indexed. Above ~150 the pairwise pass starts to dominate the analysis. */
export const COOCCUR_TOP_N = 120;
/** Pairs seen in a single message are noise. */
export const COOCCUR_MIN_PAIR = 2;
/** Hard cap; when exceeded the weakest pairs are dropped. */
export const COOCCUR_MAX_PAIRS = 50_000;

export interface Cooccur {
  /** Word (lowercased) -> number of messages containing it. */
  docs: Record<string, number>;
  /** pairs[a][b] = messages containing both. Symmetric: stored in both directions. */
  pairs: Record<string, Record<string, number>>;
}

/**
 * Counts, for every pair among the top `topN` words, the messages containing both.
 * Plain objects rather than Maps so the index survives the JSON hop from the server.
 */
export function buildCooccur(
  texts: string[],
  words: { text: string }[],
  opts: { topN?: number; minPair?: number; maxPairs?: number } = {},
): Cooccur {
  const topN = opts.topN ?? COOCCUR_TOP_N;
  const minPair = opts.minPair ?? COOCCUR_MIN_PAIR;
  const maxPairs = opts.maxPairs ?? COOCCUR_MAX_PAIRS;

  // Dedupe by lowercased text: the picker keys on the same form.
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    const k = w.text.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    keys.push(k);
    if (keys.length >= topN) break;
  }

  const n = keys.length;
  const m = texts.length;
  const docs: Record<string, number> = {};
  if (n === 0 || m === 0) return { docs, pairs: {} };

  const lower = texts.map((t) => t.toLowerCase());
  // Presence bitmap, one row per word. Uint8Array keeps 120 x 1500 at ~180 KB.
  const present: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    const row = new Uint8Array(m);
    const w = keys[i];
    let d = 0;
    for (let k = 0; k < m; k++) {
      if (lower[k].indexOf(w) >= 0) { row[k] = 1; d++; }
    }
    present.push(row);
    docs[w] = d;
  }

  // Pairwise intersection over the bitmap.
  const flat: { a: string; b: string; c: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (docs[keys[i]] === 0) continue;
    const ra = present[i];
    for (let j = i + 1; j < n; j++) {
      if (docs[keys[j]] === 0) continue;
      const rb = present[j];
      let c = 0;
      for (let k = 0; k < m; k++) if (ra[k] && rb[k]) c++;
      if (c >= minPair) flat.push({ a: keys[i], b: keys[j], c });
    }
  }
  // Over the cap, keep the strongest pairs.
  if (flat.length > maxPairs) {
    flat.sort((x, y) => y.c - x.c);
    flat.length = maxPairs;
  }

  const pairs: Record<string, Record<string, number>> = {};
  for (const { a, b, c } of flat) {
    (pairs[a] ??= {})[b] = c;
    (pairs[b] ??= {})[a] = c;
  }
  return { docs, pairs };
}

/**
 * Co-occurrence rate in 0..1: shared messages over the rarer word's own messages.
 * Symmetric, and 1 when one word only ever appears alongside the other.
 */
export function cooccurRate(co: Cooccur | null | undefined, a: string, b: string): number {
  if (!co) return 0;
  const ka = a.toLowerCase(), kb = b.toLowerCase();
  const c = co.pairs[ka]?.[kb] ?? 0;
  if (!c) return 0;
  const denom = Math.min(co.docs[ka] ?? 0, co.docs[kb] ?? 0);
  if (denom <= 0) return 0;
  return Math.min(1, c / denom);
}

/** Drops the index from a result before it is shared, exported or contributed. */
export function stripCooccur<T extends { cooccur?: Cooccur }>(r: T): T {
  if (!r.cooccur) return r;
  const out = { ...r };
  delete out.cooccur;
  return out;
}

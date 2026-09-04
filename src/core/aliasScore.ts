/**
 * Ranking for the equivalence picker (notes/docs/27 s2.2).
 *
 * Pure and local: no dictionary, no network. The only signal that can pair a
 * Chinese name with its English spelling is co-occurrence — 西德妮 and sydney
 * share the messages they appear in — so it carries the largest weight.
 */
import { cooccurRate, type Cooccur } from './cooccur';
import type { EntityKind } from './entities';

export const ALIAS_WEIGHTS = {
  /** Same entity kind. */
  kind: 4,
  /** The typed text is a prefix of the candidate. */
  prefix: 2,
  /** The typed text appears somewhere in the candidate. */
  includes: 1,
  /**
   * Multiplier on the 0..1 co-occurrence rate. Designed at 6; lowered to 3 after
   * `npm run eval:alias` measured a top-3 hit rate of 0/3 on the local corpus
   * (2026-09-05) — inside one chat almost every head word shares almost every
   * message, so the rate barely separates candidates. The picker is labelled
   * experimental in the UI for the same reason.
   */
  cooccur: 3,
  /** Lengths within one character of each other. */
  length: 1,
  /** The candidate is already aliased somewhere else. */
  aliased: -2,
} as const;

export interface AliasWord {
  text: string;
  count: number;
  kind?: EntityKind;
}

export interface AliasScoreOptions {
  /** Text typed in the search box; '' means "show everything". */
  needle?: string;
  cooccur?: Cooccur | null;
  /** Words that already have an `alias` set (lowercased keys). */
  aliased?: ReadonlySet<string>;
  /** Overrides the default co-occurrence weight (the eval harness sweeps it). */
  cooccurWeight?: number;
}

/** Candidates offered per equivalence picker. */
export const ALIAS_CANDIDATES = 8;

/**
 * Scores one candidate against the merge target. Returns `null` when the typed
 * text rules the candidate out, so the caller can filter and rank in one pass.
 */
export function scoreAliasCandidate(
  cand: AliasWord,
  target: AliasWord,
  opts: AliasScoreOptions = {},
): number | null {
  const text = cand.text.toLowerCase();
  const needle = (opts.needle ?? '').trim().toLowerCase();
  let score = 0;
  if (needle) {
    if (text.startsWith(needle)) score += ALIAS_WEIGHTS.prefix;
    else if (text.includes(needle)) score += ALIAS_WEIGHTS.includes;
    else return null;
  }
  if (cand.kind && target.kind && cand.kind === target.kind) score += ALIAS_WEIGHTS.kind;
  const w = opts.cooccurWeight ?? ALIAS_WEIGHTS.cooccur;
  score += w * cooccurRate(opts.cooccur, cand.text, target.text);
  if (Math.abs(cand.text.length - target.text.length) <= 1) score += ALIAS_WEIGHTS.length;
  if (opts.aliased?.has(text)) score += ALIAS_WEIGHTS.aliased;
  return score;
}

/**
 * The ranked candidate list: highest score first, count breaking ties so the
 * order is stable. The merge target itself is never a candidate.
 */
export function rankAliasCandidates(
  target: AliasWord,
  words: AliasWord[],
  opts: AliasScoreOptions = {},
  limit = ALIAS_CANDIDATES,
): AliasWord[] {
  const targetKey = target.text.toLowerCase();
  const scored: { w: AliasWord; score: number }[] = [];
  for (const w of words) {
    if (w.text.toLowerCase() === targetKey) continue;
    const score = scoreAliasCandidate(w, target, opts);
    if (score === null) continue;
    scored.push({ w, score });
  }
  scored.sort((a, b) => b.score - a.score || b.w.count - a.w.count || a.w.text.localeCompare(b.w.text));
  return scored.slice(0, limit).map((s) => s.w);
}

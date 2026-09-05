/**
 * Ranking for the equivalence picker (notes/docs/27 s2.2, TODO C.10).
 *
 * Pure and local: no dictionary, no network. The first version scored on
 * same-kind + typed prefix + co-occurrence rate and measured 0/3 top-3 on the
 * local corpus, because inside one chat every head word shares almost every
 * message with every other one — co-occurrence separates nothing. This version
 * keeps that as a tie-breaker and puts the weight on evidence that is actually
 * discriminative:
 *
 *  - **coreference** (`entities.ts detectCoref`, 97.5% recall / 0% mis-merge):
 *    a full name and its short form are already grouped there, and for person
 *    words that grouping *is* the equivalence relation. Highest weight;
 *  - **affix / abbreviation**: 砚山 inside 砚山文化, 中戏 as a subsequence of
 *    中央戏剧学院. Chinese abbreviation is character selection, so a subsequence
 *    test covers what substring does not;
 *  - **transliteration** (`translit.ts`): 西德妮 ↔ sydney by consonant skeleton;
 *  - **spelling distance** for Latin variants (sydney / sydny);
 *  - **neighbour similarity**: two spellings of one thing keep the same company.
 *    Complementary distribution (the pair never shares a message) is *not* used
 *    on its own — that is where C6 measured every coreference mis-merge — it only
 *    unlocks the neighbour bonus when some other signal already fired;
 *  - **kind and kind group** (`entities.ts`, 45 kinds): same kind up, different
 *    group down;
 *  - co-occurrence rate, similar length, and a penalty for already-aliased words.
 */
import { cooccurRate, type Cooccur } from './cooccur';
import { KIND_GROUPS, type CorefGroup, type EntityKind } from './entities';
import { spellingSimilarity, translitSimilarity } from './translit';

export const ALIAS_WEIGHTS = {
  /** The two words are in the same coreference group (full name ↔ short form). */
  coref: 12,
  /** One word contains the other; scaled by how much of the longer it covers. */
  contain: 4,
  containRatio: 2,
  /** The shorter word's characters appear in order inside the longer one. */
  subsequence: 3,
  /** Multiplier on the 0..1 transliteration similarity, above `TRANSLIT_MIN`. */
  translit: 8,
  /** Multiplier on the 0..1 Latin spelling similarity, above `SPELLING_MIN`. */
  spelling: 6,
  /** Multiplier on the 0..1 neighbour-set cosine. */
  neighbor: 4,
  /** Same entity kind. */
  kind: 2,
  /** Different kinds, same kind group (`KIND_GROUPS`). */
  kindGroup: 0.75,
  /** Different kind groups. */
  kindCross: -1.5,
  /** The typed text is a prefix of the candidate. */
  prefix: 2,
  /** The typed text appears somewhere in the candidate. */
  includes: 1,
  /**
   * Multiplier on the 0..1 co-occurrence rate. Was the headline signal and is now
   * a tie-breaker: measured on the local corpus it barely separates candidates.
   */
  cooccur: 2,
  /** Lengths within one character of each other. */
  length: 0.5,
  /** The candidate is already aliased somewhere else. */
  aliased: -2,
} as const;

/** Below this the consonant skeletons are too far apart to be one name. */
export const TRANSLIT_MIN = 0.55;
/** Below this two Latin strings are different words, not two spellings. */
export const SPELLING_MIN = 0.6;
/** Neighbour cosine needed before a complementary pair may claim the bonus. */
export const NEIGHBOR_MIN = 0.25;

/** Candidates offered per equivalence picker. */
export const ALIAS_CANDIDATES = 8;

/** One switch per signal, for the single-variable ablation in tools/eval/alias.ts. */
export interface AliasSignals {
  coref: boolean;
  affix: boolean;
  translit: boolean;
  spelling: boolean;
  neighbor: boolean;
  kind: boolean;
  cooccur: boolean;
  length: boolean;
}

export const ALL_ALIAS_SIGNALS: AliasSignals = {
  coref: true, affix: true, translit: true, spelling: true,
  neighbor: true, kind: true, cooccur: true, length: true,
};

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
  /** Coreference groups from the analysis; the strongest signal for person words. */
  coref?: readonly CorefGroup[] | null;
  /** Precomputed by `rankAliasCandidates`; built on demand for a lone call. */
  corefIndex?: ReadonlyMap<string, string>;
  /** Overrides the default co-occurrence weight (the eval harness sweeps it). */
  cooccurWeight?: number;
  /** Signals to apply; anything omitted stays on. */
  signals?: Partial<AliasSignals>;
}

/** Lowercased word -> id of its coreference group (the full name). */
export function buildCorefIndex(groups: readonly CorefGroup[] | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const g of groups ?? []) {
    const id = g.full.toLowerCase();
    out.set(id, id);
    for (const a of g.aliases) out.set(a.toLowerCase(), id);
  }
  return out;
}

const kindGroupOf = new Map<EntityKind, string>();
for (const g of KIND_GROUPS) for (const k of g.kinds) kindGroupOf.set(k, g.id);

const CJK_RE = /^[一-鿿]+$/;

/** Are `short`'s characters a (not necessarily contiguous) subsequence of `long`? */
function isSubsequence(short: string, long: string): boolean {
  let i = 0;
  for (const ch of long) if (ch === short[i] && ++i === short.length) return true;
  return false;
}

/**
 * Containment / abbreviation score. Chinese abbreviation picks characters out of
 * the full form (中央戏剧学院 → 中戏), so substring alone would miss half of it;
 * a subsequence of at least two characters is the looser branch and scores less.
 */
export function affixScore(a: string, b: string): number {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < 2 || short === long) return 0;
  if (long.includes(short)) {
    return ALIAS_WEIGHTS.contain + ALIAS_WEIGHTS.containRatio * (short.length / long.length);
  }
  // The subsequence branch is Chinese-only: in Latin text it fires on unrelated
  // words that happen to share letters in order.
  if (CJK_RE.test(short) && CJK_RE.test(long) && isSubsequence(short, long)) {
    return ALIAS_WEIGHTS.subsequence;
  }
  return 0;
}

/**
 * Cosine similarity of two words' neighbour vectors, in 0..1: how much of the
 * company one word keeps is also the company the other keeps. Each word is
 * removed from the other's vector, so a pair that only ever appears together
 * does not score here — that is what `cooccurRate` is for.
 */
export function neighborSimilarity(co: Cooccur | null | undefined, a: string, b: string): number {
  if (!co) return 0;
  const ka = a.toLowerCase(), kb = b.toLowerCase();
  const va = co.pairs[ka], vb = co.pairs[kb];
  if (!va || !vb) return 0;
  let dot = 0, na = 0, nb = 0;
  for (const [k, v] of Object.entries(va)) { if (k !== kb) na += v * v; }
  for (const [k, v] of Object.entries(vb)) { if (k !== ka) nb += v * v; }
  for (const [k, v] of Object.entries(va)) {
    if (k === kb) continue;
    const w = vb[k];
    if (w && k !== ka) dot += v * w;
  }
  if (na <= 0 || nb <= 0) return 0;
  return dot / Math.sqrt(na * nb);
}

/**
 * Scores one candidate against the merge target. Returns `null` when the typed
 * text rules the candidate out, so the caller can filter and rank in one pass.
 */
export function scoreAliasCandidate(
  cand: AliasWord,
  target: AliasWord,
  opts: AliasScoreOptions = {},
): number | null {
  const on = { ...ALL_ALIAS_SIGNALS, ...opts.signals };
  const text = cand.text.toLowerCase();
  const targetText = target.text.toLowerCase();
  const needle = (opts.needle ?? '').trim().toLowerCase();
  let score = 0;
  if (needle) {
    if (text.startsWith(needle)) score += ALIAS_WEIGHTS.prefix;
    else if (text.includes(needle)) score += ALIAS_WEIGHTS.includes;
    else return null;
  }

  // 1. Coreference. `detectCoref` already decided these name one person.
  if (on.coref) {
    const idx = opts.corefIndex ?? buildCorefIndex(opts.coref);
    const ga = idx.get(text), gb = idx.get(targetText);
    if (ga && gb && ga === gb) score += ALIAS_WEIGHTS.coref;
  }

  // 2. Affix / abbreviation.
  const affix = on.affix ? affixScore(cand.text, target.text) : 0;
  score += affix;

  // 3. Transliteration (exactly one side Chinese) and 4. Latin spelling variants.
  const translit = on.translit ? translitSimilarity(cand.text, target.text) : 0;
  if (translit >= TRANSLIT_MIN) score += ALIAS_WEIGHTS.translit * translit;
  const spelling = on.spelling ? spellingSimilarity(cand.text, target.text) : 0;
  if (spelling >= SPELLING_MIN) score += ALIAS_WEIGHTS.spelling * spelling;

  // 6. Kinds, before the neighbour gate: a same-group kind counts as evidence.
  let sameGroup = false;
  if (on.kind && cand.kind && target.kind) {
    if (cand.kind === target.kind) { score += ALIAS_WEIGHTS.kind; sameGroup = true; }
    else if (kindGroupOf.get(cand.kind) === kindGroupOf.get(target.kind)) {
      score += ALIAS_WEIGHTS.kindGroup;
      sameGroup = true;
    } else score += ALIAS_WEIGHTS.kindCross;
  }

  // 5. Neighbour similarity. Complementary distribution — the two words never
  // share a message — is the shape a pair of spellings has, but C6 measured that
  // using it alone is where every mis-merge comes from, so it is conjoined here:
  // with no co-occurrence at all the bonus needs another signal to have fired.
  const rate = cooccurRate(opts.cooccur, cand.text, target.text);
  if (on.neighbor) {
    const sim = neighborSimilarity(opts.cooccur, cand.text, target.text);
    const otherEvidence = affix > 0 || translit >= TRANSLIT_MIN || spelling >= SPELLING_MIN || sameGroup;
    if (sim >= NEIGHBOR_MIN && (rate > 0 || otherEvidence)) score += ALIAS_WEIGHTS.neighbor * sim;
  }

  // 7. Tie-breakers.
  if (on.cooccur) score += (opts.cooccurWeight ?? ALIAS_WEIGHTS.cooccur) * rate;
  if (on.length && Math.abs(cand.text.length - target.text.length) <= 1) score += ALIAS_WEIGHTS.length;
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
  const scoped: AliasScoreOptions = { ...opts, corefIndex: opts.corefIndex ?? buildCorefIndex(opts.coref) };
  const scored: { w: AliasWord; score: number }[] = [];
  for (const w of words) {
    if (w.text.toLowerCase() === targetKey) continue;
    const score = scoreAliasCandidate(w, target, scoped);
    if (score === null) continue;
    scored.push({ w, score });
  }
  scored.sort((a, b) => b.score - a.score || b.w.count - a.w.count || a.w.text.localeCompare(b.w.text));
  return scored.slice(0, limit).map((s) => s.w);
}

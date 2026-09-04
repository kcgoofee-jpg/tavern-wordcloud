import type { TokenizeOptions, WordCount } from './types';
import { buildStopwords } from './stopwords';
import { planMerge } from './english';

export const DEFAULT_TOKENIZE_OPTIONS: TokenizeOptions = {
  minLength: 2,
  discoverPhrases: true,
  discoverFreedom: false,
  discoverMinCount: 4,
  useStopwords: true,
  useNarrativeStopwords: true,
  mergeEnglishForms: true,
  extraStopwords: [],
  minCount: 2,
  maxWords: 120,
  dictionary: [],
  forceWords: [],
  splitWords: [],
};

const HAN = /[㐀-䶿一-鿿豈-﫿]/;
const HAS_LETTER = /[\p{L}\p{N}]/u;
const ALL_DIGITS = /^[\d.,:%/-]+$/;

export function hasIntlSegmenter(): boolean {
  return typeof Intl !== 'undefined' && typeof (Intl as { Segmenter?: unknown }).Segmenter === 'function';
}

/**
 * A chunk is a run of tokens with no punctuation or whitespace between them.
 * New-word discovery only operates inside a chunk.
 */
type Chunk = string[];

let segmenter: Intl.Segmenter | null = null;
function getSegmenter(): Intl.Segmenter | null {
  if (!hasIntlSegmenter()) return null;
  if (!segmenter) segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
  return segmenter;
}

/** Fallback when Intl.Segmenter is unavailable: CJK per character, Latin per letter run. */
function fallbackChunks(text: string): Chunk[] {
  const chunks: Chunk[] = [];
  for (const raw of text.split(/[^\p{L}\p{N}']+/u)) {
    if (!raw) continue;
    const atoms: string[] = [];
    let buf = '';
    for (const ch of raw) {
      if (HAN.test(ch)) {
        if (buf) { atoms.push(buf); buf = ''; }
        atoms.push(ch);
      } else {
        buf += ch;
      }
    }
    if (buf) atoms.push(buf);
    if (atoms.length) chunks.push(atoms);
  }
  return chunks;
}

/** Join two tokens; a space is inserted only between Latin tokens. */
export function joinTokens(parts: readonly string[]): string {
  let out = '';
  for (const p of parts) {
    if (out && !HAN.test(out.slice(-1)) && !HAN.test(p[0])) out += ' ';
    out += p;
  }
  return out;
}

/**
 * Segment into chunks with Intl.Segmenter. A single space does not break a chunk
 * (needed for multi-word English names); newlines, tabs and punctuation do.
 */
export function segmentToChunks(text: string): Chunk[] {
  const seg = getSegmenter();
  if (!seg) return fallbackChunks(text);

  const chunks: Chunk[] = [];
  let cur: Chunk = [];
  let expectedIndex = -1;
  for (const s of seg.segment(text)) {
    if (!s.isWordLike) {
      // A single space is not a boundary; any other non-token is.
      if (s.segment === ' ' && cur.length) { expectedIndex = s.index + 1; continue; }
      if (cur.length) { chunks.push(cur); cur = []; }
      expectedIndex = -1;
      continue;
    }
    if (expectedIndex !== -1 && s.index !== expectedIndex) {
      if (cur.length) { chunks.push(cur); cur = []; }
    }
    cur.push(s.segment);
    expectedIndex = s.index + s.segment.length;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/**
 * New-word discovery.
 *
 * Candidates are 2..4 adjacent tokens inside a chunk. A candidate is kept when:
 *   1. it occurs at least `discoverMinCount` times;
 *   2. cohesion = count(candidate) / count(most frequent part) is high enough;
 *   3. no part is a function word;
 *   4. (optional, `discoverFreedom`) both sides have diverse neighbours (branching entropy),
 *      with chunk boundaries counted as a separate symbol.
 *
 * Entropy is computed in a second pass over the candidates that passed 1..3.
 */
export function discoverPhrases(chunks: Chunk[], minCount: number, stop: ReadonlySet<string>, freedom = true): string[] {
  const MAX_ATOMS = 3;
  const MAX_CHARS = 6;
  const COHESION = 0.34;

  const atomCount = new Map<string, number>();
  const candCount = new Map<string, number>();
  /** Candidate -> its parts, for O(1) cohesion lookups. */
  const candParts = new Map<string, string[]>();

  const isHanAtom = (a: string) => HAN.test(a);

  // Runs of adjacent CJK atoms, kept for the second (neighbour) pass so the chunks are
  // only scanned — and HAN-tested — once instead of twice.
  const runs: string[][] = [];

  for (const chunk of chunks) {
    // Candidates are generated only inside runs of CJK tokens.
    let run: string[] = [];
    const flush = () => {
      if (run.length >= 2) {
        if (freedom) runs.push(run);
        for (let i = 0; i < run.length; i++) {
          // The candidate string is extended one atom at a time instead of slice()+join()
          // per window; likewise `hasStop` replaces the per-window `parts.some(stop)` scan.
          let cand = run[i];
          let hasStop = stop.has(run[i]);
          for (let n = 2; n <= MAX_ATOMS && i + n <= run.length; n++) {
            const last = run[i + n - 1];
            cand += last;
            if (cand.length > MAX_CHARS) break;
            // A candidate containing a function word is a collocation, not a word.
            if (stop.has(last)) hasStop = true;
            if (hasStop) continue;
            // One map lookup instead of get+set+has: `undefined` also means "first sighting".
            const prev = candCount.get(cand);
            candCount.set(cand, (prev ?? 0) + 1);
            if (prev === undefined) candParts.set(cand, run.slice(i, i + n));
          }
        }
      }
      run = [];
    };
    for (const atom of chunk) {
      if (isHanAtom(atom)) {
        atomCount.set(atom, (atomCount.get(atom) ?? 0) + 1);
        run.push(atom);
      } else flush();
    }
    flush();
  }

  const passed = new Set<string>();
  for (const [cand, n] of candCount) {
    if (n < minCount) continue;
    let maxPart = 0;
    for (const part of candParts.get(cand) ?? []) maxPart = Math.max(maxPart, atomCount.get(part) ?? 0);
    if (maxPart === 0) continue;
    if (n / maxPart >= COHESION) passed.add(cand);
  }

  // Second pass: neighbour statistics for candidates that passed cohesion.
  const BOUNDARY = '\u0000';
  const FREEDOM = 0.4;          // Natural log; a 3:1 split over 4 is 0.56, all-same is 0.
  const BOUNDARY_SHARE = 0.3;
  const left = new Map<string, Map<string, number>>();
  const right = new Map<string, Map<string, number>>();
  const bump = (m: Map<string, Map<string, number>>, cand: string, nb: string) => {
    let d = m.get(cand);
    if (!d) { d = new Map(); m.set(cand, d); }
    d.set(nb, (d.get(nb) ?? 0) + 1);
  };
  // Only the branching-entropy filter reads these maps, and it is off by default
  // (`discoverFreedom: false`), so skip the whole second scan when it is not asked for.
  // Reuses the runs collected above; the candidate string is again extended atom by atom.
  if (freedom) for (const run of runs) {
    for (let i = 0; i < run.length; i++) {
      let cand = run[i];
      for (let n = 2; n <= MAX_ATOMS && i + n <= run.length; n++) {
        cand += run[i + n - 1];
        if (cand.length > MAX_CHARS) break;
        if (!passed.has(cand)) continue;
        bump(left, cand, i > 0 ? run[i - 1] : BOUNDARY);
        bump(right, cand, i + n < run.length ? run[i + n] : BOUNDARY);
      }
    }
  }
  // A function-word neighbour counts as a boundary.
  const free = (d: Map<string, number> | undefined): boolean => {
    if (!d) return false;
    let total = 0, edge = 0;
    for (const [nb, c] of d) { total += c; if (nb === BOUNDARY || stop.has(nb)) edge += c; }
    if (edge / total >= BOUNDARY_SHARE) return true;
    let h = 0;
    for (const c of d.values()) { const p = c / total; h -= p * Math.log(p); }
    return h >= FREEDOM;
  };

  const out: string[] = [];
  for (const cand of passed) {
    if (!freedom || (free(left.get(cand)) && free(right.get(cand)))) out.push(cand);
  }
  // Longest first so maximal matching prefers the longer entry.
  out.sort((a, b) => b.length - a.length || a.localeCompare(b));
  return out;
}

/**
 * Every proper prefix of every lexicon entry. `joinTokens` is a left fold, so the string
 * joined from atoms i..j is always a prefix of any longer entry that starts there: if it is
 * not in this set, no longer window can match and the scan stops immediately. Without it
 * every position paid up to `maxAtoms` slice+join+toLowerCase allocations.
 */
function lexiconPrefixes(lexicon: Set<string>): Set<string> {
  const prefixes = new Set<string>();
  for (const w of lexicon) for (let i = 1; i < w.length; i++) prefixes.add(w.slice(0, i));
  return prefixes;
}

/** Longest-match merging against a dictionary, on token boundaries only. */
function mergeChunk(chunk: Chunk, lexicon: Set<string>, prefixes: Set<string>, maxAtoms = 4): string[] {
  if (lexicon.size === 0) return chunk;
  const out: string[] = [];
  let i = 0;
  while (i < chunk.length) {
    let matched: string | null = null;
    let matchedEnd = i + 1;
    const limit = Math.min(chunk.length, i + maxAtoms);
    // Grow the window one atom at a time and keep the last (= longest) hit.
    let s = chunk[i];
    let low = s.toLowerCase();
    for (let j = i + 1; j < limit; j++) {
      if (!prefixes.has(low)) break;
      const p = chunk[j];
      if (!HAN.test(s.slice(-1)) && !HAN.test(p[0])) s += ' ';
      s += p;
      low = s.toLowerCase();
      // The dictionary is stored lower-cased so English names match regardless of case.
      if (lexicon.has(low)) { matched = s; matchedEnd = j + 1; }
    }
    if (matched) { out.push(matched); i = matchedEnd; }
    else { out.push(chunk[i]); i++; }
  }
  return out;
}

function normalize(token: string): string {
  return HAN.test(token) ? token : token.toLowerCase();
}

function acceptable(token: string, minLength: number, stop: Set<string>): boolean {
  // Pure predicates ANDed together, so order is free: the two cheap tests (length, hash
  // lookup) run before the two Unicode regexes and reject most tokens without them.
  if (token.length < minLength) return false;
  if (stop.has(token)) return false;
  if (!HAS_LETTER.test(token)) return false;
  if (ALL_DIGITS.test(token)) return false;
  return true;
}

export interface TokenizeResult {
  words: WordCount[];
  /** Full counts before sorting and truncation, for CSV export. */
  allWords: WordCount[];
  totalTokens: number;
  /** Tokens that entered the frequency table (after stop words, punctuation, numbers and length filtering). Used as the denominator for percentages. */
  countedTokens: number;
  uniqueTokens: number;
  discovered: string[];
  usedFallbackSegmenter: boolean;
}

/** Rebuild chunks from an external token list, breaking at punctuation tokens. */
function chunksFromTokens(tokens: string[]): Chunk[] {
  const out: Chunk[] = [];
  let cur: Chunk = [];
  for (const t of tokens) {
    const w = t.trim();
    if (!w || !HAS_LETTER.test(w)) {
      if (cur.length) { out.push(cur); cur = []; }
      continue;
    }
    cur.push(w);
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * @param presegmented externally tokenized texts aligned with `texts`. When given, Intl.Segmenter
 *                     is skipped; discovery, dictionary merging and stop words still run.
 */
export function tokenizeCorpus(
  texts: string[],
  options: Partial<TokenizeOptions> = {},
  presegmented?: (string[] | undefined)[],
): TokenizeResult {
  const opts: TokenizeOptions = { ...DEFAULT_TOKENIZE_OPTIONS, ...options };
  const stop = buildStopwords(opts.extraStopwords, opts.useStopwords, opts.useNarrativeStopwords);

  const allChunks: Chunk[] = [];
  segmentRange(texts, presegmented, 0, texts.length, allChunks);
  return finishTokenize(allChunks, opts, stop);
}

/** Segment texts[from, to) into chunks and append to `out`. */
function segmentRange(texts: string[], presegmented: (string[] | undefined)[] | undefined, from: number, to: number, out: Chunk[]): void {
  for (let i = from; i < to; i++) {
    const t = texts[i];
    if (!t) continue;
    const pre = presegmented?.[i];
    // push(...arr) copies through the argument list; a plain loop avoids that (and the
    // stack limit on very long chunk lists).
    const cs = pre?.length ? chunksFromTokens(pre) : segmentToChunks(t);
    for (const c of cs) out.push(c);
  }
}

/** A batch ends at whichever comes first. Both caps are small enough that one
 * huge file still produces dozens of updates instead of a single 0/1. */
const BATCH_TEXTS = 40;
const BATCH_CHARS = 300_000;

/**
 * Async tokenization: reports progress and yields to the event loop between batches.
 *
 * Progress is counted in **characters**, not messages: a 5 MB export is one file
 * but hundreds of thousands of characters, and the ring has to move while it is
 * being chewed through. Produces the same result as the synchronous version.
 */
export async function tokenizeCorpusAsync(
  texts: string[],
  options: Partial<TokenizeOptions> = {},
  presegmented?: (string[] | undefined)[],
  /** (doneChars, totalChars) */
  onProgress?: (done: number, total: number) => void,
  yieldFn: () => Promise<void> = () => new Promise((r) => setTimeout(r, 0)),
  batch = BATCH_TEXTS,
  maxChars = BATCH_CHARS,
): Promise<TokenizeResult> {
  const opts: TokenizeOptions = { ...DEFAULT_TOKENIZE_OPTIONS, ...options };
  const stop = buildStopwords(opts.extraStopwords, opts.useStopwords, opts.useNarrativeStopwords);
  const allChunks: Chunk[] = [];
  let totalChars = 0;
  for (const t of texts) totalChars += t?.length ?? 0;
  let doneChars = 0;
  let i = 0;
  while (i < texts.length) {
    let to = i;
    let chars = 0;
    while (to < texts.length && to - i < batch && (chars === 0 || chars < maxChars)) {
      chars += texts[to]?.length ?? 0;
      to++;
    }
    segmentRange(texts, presegmented, i, to, allChunks);
    doneChars += chars;
    onProgress?.(doneChars, Math.max(1, totalChars));
    await yieldFn();
    i = to;
  }
  if (texts.length === 0) onProgress?.(1, 1);
  return finishTokenize(allChunks, opts, stop);
}

/** Everything after segmentation: discovery, dictionary merge, stop words, counting, lemmatization. */
function finishTokenize(allChunks: Chunk[], opts: TokenizeOptions, stop: Set<string>): TokenizeResult {
  const discovered = opts.discoverPhrases
    ? discoverPhrases(allChunks, Math.max(2, opts.discoverMinCount), stop, opts.discoverFreedom !== false)
    : [];

  const lexicon = new Set<string>(discovered.map((d) => d.toLowerCase()));
  // Dictionary and user-forced words bypass the cohesion test.
  for (const d of [...opts.dictionary, ...opts.forceWords]) {
    const t = d.trim();
    if (t.length >= 2) lexicon.add(t.toLowerCase());
  }
  // User-forced splits are removed from the dictionary.
  for (const t of opts.splitWords) lexicon.delete(t.trim().toLowerCase());

  const prefixes = lexiconPrefixes(lexicon);
  const counts = new Map<string, number>();
  let totalTokens = 0;
  for (const chunk of allChunks) {
    for (const tok of mergeChunk(chunk, lexicon, prefixes)) {
      const w = normalize(tok);
      totalTokens++;
      if (!acceptable(w, opts.minLength, stop)) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }

  /** English lemmatization, after counting so per-form counts are available. */
  if (opts.mergeEnglishForms !== false) {
    const plan = planMerge(counts, (w) => stop.has(w));
    for (const [from, to] of plan.map) {
      const n = counts.get(from);
      if (n === undefined) continue;
      counts.delete(from);
      // Forms that lemmatize to a stop word are dropped.
      if (stop.has(to)) continue;
      counts.set(to, (counts.get(to) ?? 0) + n);
    }
  }

  const allWords: WordCount[] = [...counts.entries()]
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));

  const words = allWords
    .filter((w) => w.count >= opts.minCount)
    .slice(0, opts.maxWords);

  return {
    words,
    allWords,
    totalTokens,
    countedTokens: [...counts.values()].reduce((a, n) => a + n, 0),
    uniqueTokens: counts.size,
    // Discovered words are listed by frequency for display.
    discovered: discovered
      .filter((d) => counts.has(d))
      .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
      .slice(0, 100),
    usedFallbackSegmenter: !hasIntlSegmenter(),
  };
}

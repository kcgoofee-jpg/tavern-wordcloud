/**
 * English lemmatization by merging, without a dictionary.
 *
 * 1. Conservative inflection rules produce candidate base forms (plural -s/-es/-ies,
 *    past -ed, participle -ing, possessive 's). Derivational suffixes are left alone.
 * 2. Forms are grouped by base, but merged only with evidence: the base occurs in the
 *    corpus or is a stop word, or the group has 2+ distinct surface forms.
 * 3. The displayed form is the most frequent surface form in the group, never a computed base.
 */

import { DEFAULT_STOPWORDS } from './stopwords';

/** Words ending in -ss/-us/-is: the final s is not a plural marker. */
const S_NOT_PLURAL = /(ss|us|is|as|os)$/;

/** Doubled-consonant past/participle (stopped -> stop, running -> run): only for consonant-vowel-consonant with a doubled last letter. */
const DOUBLED = /([^aeiou])([aeiou])([bdfglmnprt])\3$/;

/** Not inflections despite the -ing/-ed ending. */
const NOT_INFLECTED = new Set([
  'thing', 'king', 'ring', 'string', 'spring', 'wing', 'bring', 'sing', 'swing',
  'during', 'nothing', 'something', 'anything', 'everything', 'morning', 'evening',
  'ceiling', 'feeling', 'meeting', 'building', 'clothing', 'darling', 'sibling',
  'red', 'bed', 'need', 'seed', 'speed', 'indeed', 'bleed', 'breed', 'freed',
  'hundred', 'sacred', 'wicked', 'naked', 'aged',
]);

/** `nicole's` / `nicole’s` -> `nicole`, `holdings'` -> `holdings`; null when the word is not a possessive. */
export function possessiveBase(w: string): string | null {
  if (w.endsWith("'s") || w.endsWith('’s')) return w.slice(0, -2);
  if (w.endsWith("s'") || w.endsWith('s’')) return w.slice(0, -1);
  return null;
}

/**
 * Candidate base forms of a lower-cased word. Several candidates are returned on purpose
 * (`sliding` -> `slide` or `slid`); the caller picks the one attested by the corpus.
 * Inflection only, no derivation.
 */
export function baseForms(w: string): string[] {
  if (w.length < 4 || NOT_INFLECTED.has(w)) return [];
  const out = new Set<string>();

  // Possessive: Kestrel's -> kestrel, Holdings' -> holdings
  const poss = possessiveBase(w);
  if (poss) out.add(poss);

  if (w.endsWith('ies') && w.length > 4) out.add(`${w.slice(0, -3)}y`);   // stories → story
  else if (w.endsWith('es') && w.length > 4) {
    out.add(w.slice(0, -2));                                              // watches → watch
    out.add(w.slice(0, -1));                                              // makes → make
  } else if (w.endsWith('s') && !S_NOT_PLURAL.test(w)) {
    out.add(w.slice(0, -1));                                              // looks → look
  }

  if (w.endsWith('ied') && w.length > 4) out.add(`${w.slice(0, -3)}y`);   // tried → try
  else if (w.endsWith('ed') && w.length > 4) {
    const stem = w.slice(0, -2);
    out.add(stem);                                                        // looked → look
    out.add(`${stem}e`);                                                  // amused → amuse
    const d = DOUBLED.exec(stem);
    if (d) out.add(stem.slice(0, -1));                                    // stopped → stop
  }

  if (w.endsWith('ing') && w.length > 5) {
    const stem = w.slice(0, -3);
    out.add(stem);                                                        // looking → look
    out.add(`${stem}e`);                                                  // sliding → slide
    const d = DOUBLED.exec(stem);
    if (d) out.add(stem.slice(0, -1));                                    // running → run
  }

  out.delete(w);
  return [...out];
}

export interface MergePlan {
  /** Surface form -> form used for counting. */
  map: Map<string, string>;
  /** Number of groups merged and surface forms involved. */
  groups: number;
  merged: number;
}

/**
 * Build a merge plan from corpus counts.
 *
 * @param counts occurrences per lower-cased word
 * @param isStop stop-word test; forms whose base is a stop word are merged into it so they are filtered together
 */
export function planMerge(
  counts: ReadonlyMap<string, number>,
  isStop: (w: string) => boolean,
): MergePlan {
  // base -> all surface forms pointing to it
  const byBase = new Map<string, Set<string>>();
  for (const w of counts.keys()) {
    if (!/^[a-z][a-z'’-]*$/.test(w)) continue;   // 只处理纯英文词
    for (const b of baseForms(w)) {
      let set = byBase.get(b);
      if (!set) byBase.set(b, (set = new Set()));
      set.add(w);
    }
  }

  const map = new Map<string, string>();
  let groups = 0;

  // Possessives first, and unconditionally: `Nicole's` is `Nicole` whether or not the bare
  // form is attested, because stripping `'s` is a lossless rewrite, not a guessed stem. The
  // general rule below needs evidence precisely because -ed/-ing/-es bases are guesses.
  // Possessives of stop words are left to the loop, which folds them into the stop word.
  for (const w of counts.keys()) {
    if (!/^[a-z][a-z'’-]*$/.test(w)) continue;
    const base = possessiveBase(w);
    if (!base || base.length < 2 || isStop(base)) continue;
    map.set(w, base);
    groups++;
  }

  /**
   * Processing order decides which base claims a form: attested bases first,
   * then longer bases (stories -> story over stories -> storie).
   */
  const proven = (b: string) => counts.has(b) || isStop(b);
  const bases = [...byBase.keys()].sort((a, b) =>
    Number(proven(b)) - Number(proven(a)) || b.length - a.length || a.localeCompare(b));

  for (const base of bases) {
    const forms = [...byBase.get(base)!].filter((f) => !map.has(f));
    if (forms.length === 0) continue;

    // Inflections of stop words merge into the stop word so they are filtered together.
    if (isStop(base)) {
      for (const f of forms) map.set(f, base);
      groups++;
      continue;
    }

    /** Invariant: the displayed form is chosen from `all`, which only contains attested forms. */
    const all = counts.has(base) ? [...forms, base] : forms;
    let best = all[0];
    for (const f of all) {
      const c = counts.get(f) ?? 0;
      const bc = counts.get(best) ?? 0;
      if (c > bc || (c === bc && f.length < best.length)) best = f;
    }
    for (const f of all) if (f !== best) map.set(f, best);
    groups++;
  }

  return { map, groups, merged: map.size };
}

/**
 * How many mid-sentence capitalizations a single word needs to be called a name.
 *
 * 2026-09-05 sweep (`npm run eval:sweep english`, fixtures/ceo-en.jsonl, 15 names and 8 known
 * non-names): 3 -> 1 missed (Delgado) / 4 false (Saturday Monday Sunday Holdings);
 * 4 -> 1 missed / 3 false (Saturday Monday Holdings); 5 -> 2 missed (Cole Delgado) / 2 false.
 * 4 is kept. 3 costs a weekday for nothing, and 5 ties on total errors but trades a main
 * character's surname for one weekday — a missing character is worse in a cloud than a stray
 * weekday, which the kind buttons can hide anyway.
 */
export const ENGLISH_SINGLE_MIN = 4;

/**
 * English proper nouns: runs of capitalized words. Sentence-initial capitals do not
 * count unless the word also appears capitalized mid-sentence, and a run must occur
 * at two or more distinct positions.
 */
export function detectEnglishNames(texts: readonly string[], singleMin = ENGLISH_SINGLE_MIN): string[] {
  const CAP = /\b[A-Z][a-z]{1,20}\b/g;
  /** Shouted spellings: NICOLE. Only accepted as the name it title-cases to (see `titled`). */
  const ALL_CAPS = /\b[A-Z]{3,20}\b/g;
  const title = (w: string) => w[0] + w.slice(1).toLowerCase();

  // Spellings seen in title case anywhere. An all-caps word is folded into the title-cased
  // name only when that name is also written normally somewhere, so shouting cannot invent
  // a name out of an acronym (ETA, OOC) or an emphasized common word.
  const titled = new Set<string>();
  for (const text of texts) {
    CAP.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CAP.exec(text))) titled.add(m[0]);
  }

  /** Positions of capitalized words in a sentence, all-caps spellings folded into their title case. */
  const capsOf = (sentence: string) => {
    const words: { w: string; i: number }[] = [];
    let m: RegExpExecArray | null;
    CAP.lastIndex = 0;
    while ((m = CAP.exec(sentence))) words.push({ w: m[0], i: m.index });
    ALL_CAPS.lastIndex = 0;
    while ((m = ALL_CAPS.exec(sentence))) {
      const t = title(m[0]);
      if (titled.has(t)) words.push({ w: t, i: m.index });
    }
    return words.sort((a, b) => a.i - b.i);
  };
  const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+|\n+/);
  /** Words seen capitalized mid-sentence. */
  const midSentence = (sentence: string, x: { i: number }) =>
    sentence.slice(0, x.i).trim().length > 0;

  // First pass: words capitalized mid-sentence are real proper nouns; they also count sentence-initially.
  const proper = new Set<string>();
  for (const text of texts) {
    for (const sentence of sentencesOf(text)) {
      for (const x of capsOf(sentence)) if (midSentence(sentence, x)) proper.add(x.w);
    }
  }

  const seen = new Map<string, Set<number>>();
  texts.forEach((text, ti) => {
    for (const sentence of sentencesOf(text)) {
      const body = capsOf(sentence).filter((x) => midSentence(sentence, x) || proper.has(x.w));

      for (let i = 0; i + 1 < body.length; i++) {
        // Only spaces may separate the words of a name.
        const gap = sentence.slice(body[i].i + body[i].w.length, body[i + 1].i);
        if (!/^ $/.test(gap)) continue;
        const pair = `${body[i].w} ${body[i + 1].w}`;
        let at = seen.get(pair);
        if (!at) seen.set(pair, (at = new Set()));
        at.add(ti * 100000 + body[i].i);
      }
    }
  });

  const pairs = [...seen.entries()]
    .filter(([, at]) => at.size >= 2)
    .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
    .map(([p]) => p);

  // Single-word names (Nicole, Maya): capitalized mid-sentence at least `singleMin` times and
  // never written in lower case anywhere in the text. Sentence-initial words alone do not count.
  // First names are listed even when they also occur inside a two-word name: the tokenizer
  // usually emits the bare first name, and that is the word the cloud shows.
  const joined = texts.join('\n');
  const midCount = new Map<string, number>();
  for (const text of texts) {
    for (const sentence of sentencesOf(text)) {
      for (const x of capsOf(sentence)) if (midSentence(sentence, x)) midCount.set(x.w, (midCount.get(x.w) ?? 0) + 1);
    }
  }
  const singles = [...midCount.entries()]
    .filter(([w, n]) => n >= singleMin && w.length >= 3
      && !DEFAULT_STOPWORDS.has(w.toLowerCase())
      && !new RegExp(`\\b${w.toLowerCase()}\\b`).test(joined))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([w]) => w);
  return [...pairs, ...singles];
}

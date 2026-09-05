/**
 * Chinese ↔ Latin transliteration matching for the equivalence picker (TODO C.10).
 *
 * The one thing that pairs 西德妮 with `sydney` without a network call is the
 * sound. This module is the smallest thing that can hear it:
 *
 *   1. every Chinese character used in transliteration is mapped to the *class*
 *      of its pinyin initial, not to its pinyin (`CONSONANT_OF`). Rhymes are
 *      dropped entirely — 西/希/夏 all collapse to `s`, which is exactly the
 *      ambiguity a translator has when writing `s`, `sh`, `si` or `ce`;
 *   2. the Latin side is reduced to the same alphabet by scanning its consonant
 *      digraphs and letters in order (`latinSkeleton`);
 *   3. the two skeletons are compared with a normalized edit distance.
 *
 * Trade-offs, stated because they bound what this can ever do:
 *
 * - **No pinyin dictionary.** A full 汉字→拼音 table is ~20 k entries and would
 *   dwarf the rest of core. The table below is ~230 characters — the ones that
 *   actually appear in 音译 — and returns `null` for anything else, so a Chinese
 *   *word* (合同, 剧组) simply has no skeleton and never scores. That is the
 *   desired failure: the signal must not fire on ordinary vocabulary.
 * - **Merged voicing and liquids.** `b/p`, `d/t`, `g/k`, `f/v/w`, `l/r`,
 *   `s/x/sh/z/c/th` are each one class. Chinese transliteration does not
 *   distinguish them reliably (Smith → 史密斯 spells θ as `s`), so keeping them
 *   apart would only produce misses.
 * - **Vowels are ignored.** They carry almost no information across the two
 *   writing systems and every attempt to align them costs recall.
 *
 * Nothing here is a language model and nothing here is a name list; it is a
 * spelling rule that happens to be about sound.
 */

/**
 * Transliteration characters → the class of their pinyin initial.
 * `''` means the syllable starts with a vowel (阿, 艾, 伊) and contributes no
 * consonant. Characters absent from the table make the whole word unromanizable.
 */
const CONSONANT_OF: Record<string, string> = {};
function put(cls: string, chars: string) {
  for (const c of chars) CONSONANT_OF[c] = cls;
}
// Vowel-initial syllables.
put('', '阿埃艾爱安奥欧恩厄伊依因英雅亚娅耶叶约尤优于奥昂鄂俄艾奧');
// b / p — voicing is not preserved by transliteration.
put('b', '巴拜邦保鲍贝本比彼宾波伯博布帕派潘佩皮普珀蓬彭庞普璞');
// f / v / w — 弗 for `f`, 维 for `v`, 沃 for `w` are interchangeable in practice.
put('f', '法菲弗夫福芙妃凡范维韦威卫沃万瓦娃王文雯乌伍温翁沃薇');
put('m', '玛马迈曼梅蒙米密摩莫姆穆缪蜜敏茉曼');
// d / t.
put('t', '达大戴丹道德登迪蒂帝都杜顿多妲娣东塔泰坦汤特提天铁廷通图托堤忒');
put('n', '娜纳奈南内尼妮诺纽妞尼奈纳');
// l / r — 尔 is the standard rendering of a final `r` or `l`.
put('l', '拉莱兰朗劳勒雷里丽莉利林琳灵卢露伦罗洛蕾萝龙隆瑞若让茹儒尔勒莲琳露');
// g / k / q(hard).
put('k', '卡凯康科克肯库奎甘高戈格古圭谷广桂昆坤刚盖葛');
put('h', '哈海汉豪荷赫华霍胡惠亨海韩');
// j / ch / zh / q(soft) — the affricates.
put('j', '基吉加杰金京佳嘉姬齐乔琴琪恰查车詹珍朱纪季捷娇');
// s / x / sh / z / c / th.
put('s', '萨塞桑瑟森沙山舍史斯苏索西希夏香谢辛修雪丝思茜施舒珊尚绍沈生士世书双水顺司松隋孙兹佐泽赛雪茜辛夕锡瑟');

/** Consonant classes reachable from Latin spelling, longest digraph first. */
const LATIN_RULES: [string, string][] = [
  ['sch', 's'], ['tch', 'j'],
  ['ch', 'j'], ['sh', 's'], ['th', 's'], ['ph', 'f'], ['gh', 'k'], ['ck', 'k'],
  ['qu', 'k'], ['ts', 's'], ['dg', 'j'], ['wh', 'f'], ['kn', 'n'], ['wr', 'l'],
  ['b', 'b'], ['p', 'b'],
  ['d', 't'], ['t', 't'],
  ['g', 'k'], ['k', 'k'], ['c', 'k'], ['q', 'k'],
  ['f', 'f'], ['v', 'f'], ['w', 'f'],
  ['l', 'l'], ['r', 'l'],
  ['m', 'm'], ['n', 'n'],
  ['s', 's'], ['z', 's'], ['x', 's'],
  ['j', 'j'],
  ['h', 'h'],
];

const CJK_RE = /^[一-鿿]+$/;
const LATIN_RE = /^[a-z][a-z'.\- ]*$/;

/**
 * The consonant-class skeleton of a Chinese string, or `null` when any character
 * is outside the transliteration table — i.e. when the word is ordinary Chinese
 * rather than a foreign name written in Chinese.
 */
export function cjkSkeleton(word: string): string | null {
  if (!CJK_RE.test(word)) return null;
  let out = '';
  for (const ch of word) {
    const c = CONSONANT_OF[ch];
    if (c === undefined) return null;
    out += c;
  }
  // 莉莉 and `lili` must reduce to the same thing, so both sides collapse runs.
  return out.replace(/(.)\1+/g, '$1');
}

/**
 * The consonant-class skeleton of a Latin string. A silent trailing `e` is
 * dropped (`claire` → `klr`, not `klr` + nothing) and doubled letters collapse,
 * because Chinese never spells them twice.
 */
export function latinSkeleton(word: string): string | null {
  const w = word.toLowerCase().trim();
  if (!LATIN_RE.test(w)) return null;
  const body = w.length > 2 && w.endsWith('e') ? w.slice(0, -1) : w;
  let out = '';
  let i = 0;
  outer: while (i < body.length) {
    // Soft c / g: `alice` is /s/ and `george` is /dʒ/, and Chinese hears them
    // that way (爱丽丝, 乔治). Only one letter is consumed.
    const soft = 'eiy'.includes(body[i + 1] ?? '');
    if (soft && (body[i] === 'c' || body[i] === 'g')) {
      const cls = body[i] === 'c' ? 's' : 'j';
      if (out.at(-1) !== cls) out += cls;
      i += 1;
      continue;
    }
    for (const [pat, cls] of LATIN_RULES) {
      if (body.startsWith(pat, i)) {
        if (out.at(-1) !== cls || pat.length > 1) out += cls;
        i += pat.length;
        continue outer;
      }
    }
    i += 1; // vowel, apostrophe, space, hyphen: no consonant
  }
  // Collapse runs the digraph branch above may have produced (`ss` → `s`).
  return out.replace(/(.)\1+/g, '$1');
}

/** Levenshtein distance, iterative, one row of state. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

/** 1 for identical strings, 0 for nothing in common. */
export function editSimilarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (!max) return 0;
  return 1 - editDistance(a, b) / max;
}

/**
 * How well one Chinese and one Latin string could be the same name, in 0..1.
 * Returns 0 unless exactly one side is Chinese and the other Latin, both
 * skeletons exist, and both are at least two consonants long — a one-consonant
 * skeleton matches far too much to be evidence.
 */
export function translitSimilarity(a: string, b: string): number {
  const pair = [a, b].map((s) => s.trim().toLowerCase());
  const skeletons = pair.map((s) => cjkSkeleton(s) ?? latinSkeleton(s));
  const cjkCount = pair.filter((s) => CJK_RE.test(s)).length;
  if (cjkCount !== 1) return 0;
  const [sa, sb] = skeletons;
  if (sa === null || sb === null) return 0;
  if (sa.length < 2 || sb.length < 2) return 0;
  return editSimilarity(sa, sb);
}

/**
 * Spelling-variant similarity between two Latin strings (sydney / sydny), in
 * 0..1. Zero unless both sides are Latin and at least three characters long.
 */
export function spellingSimilarity(a: string, b: string): number {
  const x = a.trim().toLowerCase(), y = b.trim().toLowerCase();
  if (!LATIN_RE.test(x) || !LATIN_RE.test(y)) return 0;
  if (x.length < 3 || y.length < 3) return 0;
  return editSimilarity(x, y);
}

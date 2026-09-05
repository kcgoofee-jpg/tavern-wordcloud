/**
 * English copy quality, pinned.
 *
 * `i18n.test.ts` proves every call site *has* a translation. This file proves the
 * translation is English: the 2026-09-05 audit found values that said something
 * other than the Chinese ("Uses the API key you entered" for 「用你自己填的接口」),
 * calques no native speaker writes ("Sorting files", "{w}×10k characters"), and
 * one concept spelled three ways (kind / category / class). Each class of defect
 * gets a rule here so it cannot come back unnoticed.
 *
 * Adding a legitimate exception is fine — add it to the list with a reason. A
 * silent regression is what this file is for.
 */
import { describe, expect, it } from 'vitest';
import { englishKeys, tenK, translate } from '../src/ui/i18n';

/** Every dictionary entry as [Chinese key, English value]. */
const ENTRIES: [string, string][] = englishKeys().map((k) => [k, translate('en', k)]);

/** Keys with no Chinese in them are proper nouns or format names; English may equal the key. */
const hasChinese = (s: string) => /[一-鿿]/.test(s);

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('English copy', () => {
  it('has an entry for every key', () => {
    expect(ENTRIES.length).toBeGreaterThan(700);
  });

  it('never leaves the Chinese source as the translation', () => {
    // A value equal to its key means the entry was added but never translated.
    const untranslated = ENTRIES.filter(([k, v]) => hasChinese(k) && k === v).map(([k]) => k);
    expect(untranslated).toEqual([]);
  });

  it('contains no CJK characters or full-width punctuation', () => {
    // Ideographs, kana, and the full-width forms (，。：；「」（）【】) that leak in when a
    // translation is written by editing the Chinese rather than by rewriting it.
    const cjk = /[　-〿぀-ヿ一-鿿＀-￯]/;
    const bad = ENTRIES.filter(([, v]) => cjk.test(v)).map(([k, v]) => `${k} → ${v}`);
    expect(bad).toEqual([]);
  });

  it('uses exactly the placeholders of its key', () => {
    // A placeholder the call site does not pass renders as a literal "{n}" on screen;
    // a dropped one silently loses a number.
    const bad = ENTRIES
      .filter(([k, v]) => placeholders(k).join(',') !== placeholders(v).join(','))
      .map(([k, v]) => `${k} → ${v}`);
    expect(bad).toEqual([]);
  });

  /**
   * Wordings removed by the audit. Substrings, matched case-sensitively: each one
   * was a real string in the table, not a hypothetical.
   */
  it('does not bring back the wordings the audit removed', () => {
    const BANNED: [string, string][] = [
      ['Sorting files', 'the tool sorts words into kinds, not files'],
      ['No words to file', '"file" is not a verb for classifying words'],
      ['Filed {n} words', 'same'],
      ['words to file', 'same'],
      ['Simp.', 'reads as an insult; the label is "Simplified"'],
      ['Trad.', 'pairs with Simp.; the label is "Traditional"'],
      ['×10k', 'English has no ×10,000 unit — see tenKCount()'],
      ['}0k characters', 'renders "5.20k" for a one-decimal count'],
      ['lorebook', 'the interface calls it world info'],
      ['Move out of its kind', 'not English'],
      ['Vendor official', 'not English'],
      ['Load model list', 'no such button exists; it is "Test connection"'],
      ['Data-like', 'not English'],
      ['Traditional-friendly', 'not English'],
      ['LLM segmentation', 'the term is tokenizing'],
      ['Default segmentation', 'same'],
      ['Theme surface', 'jargon for "Theme background"'],
      ['will not do', 'wrong register for an error message'],
    ];
    const hits: string[] = [];
    for (const [needle, why] of BANNED) {
      for (const [k, v] of ENTRIES) if (v.includes(needle)) hits.push(`${k} → ${v}   (${needle}: ${why})`);
    }
    expect(hits).toEqual([]);
  });

  it('spells the interface in American English', () => {
    // The legal documents in src/legal keep their own Commonwealth register; the
    // interface does not mix the two.
    const BRITISH = /\b(colour|colours|coloured|organisation|organisations|jewellery|analyse|analysed|analysing|tokenise|tokenised|tokenisation|recognise|recognised|grey|centre|favourite|behaviour|licence)\b/i;
    const bad = ENTRIES.filter(([, v]) => BRITISH.test(v)).map(([k, v]) => `${k} → ${v}`);
    expect(bad).toEqual([]);
  });

  it('uses one quote style and one dash', () => {
    // Quoting a word or a control: curly quotes, as in the majority of the table.
    // A straight double quote next to a placeholder or a control name is the tell.
    const straightQuoted = ENTRIES.filter(([, v]) => /"[^"]*"/.test(v)).map(([k, v]) => `${k} → ${v}`);
    expect(straightQuoted).toEqual([]);
    // " - " as a sentence break is a typed hyphen where an em dash belongs.
    const hyphenDash = ENTRIES.filter(([, v]) => v.includes(' - ')).map(([k, v]) => `${k} → ${v}`);
    expect(hyphenDash).toEqual([]);
  });

  it('keeps one name per concept', () => {
    // The glossary the audit settled on. Left: the term that is used. Right: terms
    // that mean the same thing and must not appear.
    const GLOSSARY: { use: string; not: RegExp; where?: (v: string) => boolean }[] = [
      { use: 'endpoint', not: /\bAPI address\b/ },
      { use: 'tokenize / tokenizing', not: /\bsegmentation\b/ },
      { use: 'world info', not: /\blorebooks?\b/i },
      { use: 'blocklist', not: /\bblock lists?\b/i },
      { use: 'operator (the person running the site)', not: /\bsite owner\b|\bmaintainer\b/i },
      { use: 'click (the interface is not touch-only)', not: /\btap\b/i },
    ];
    const hits: string[] = [];
    for (const { use, not } of GLOSSARY) {
      for (const [k, v] of ENTRIES) if (not.test(v)) hits.push(`${k} → ${v}   (use: ${use})`);
    }
    expect(hits).toEqual([]);
  });

  it('formats a 万字 count for the language that renders it', () => {
    // The key carries the 万 unit, so the number cannot be shared between the two
    // languages: "5.2 万字" and "52k characters" are the same 52,000 characters.
    expect(tenK(52_000, 'zh')).toBe('5.2');
    expect(tenK(52_000, 'en')).toBe('52k');
    expect(tenK(3_000, 'en')).toBe('3.0k');
    expect(tenK(14_770_000, 'en')).toBe('14.8M');
    expect(translate('zh', '{w} 万字 · 一次请求 · 大约要等 1~5 分钟', { w: tenK(52_000, 'zh') }))
      .toContain('5.2 万字');
    expect(translate('en', '{w} 万字 · 一次请求 · 大约要等 1~5 分钟', { w: '52k' }))
      .toBe('52k characters · one request · roughly 1–5 minutes');
  });
});

/**
 * Generic / template detection must count tokenizer tokens, not substrings of
 * the raw message (办公 inside 办公室 used to look like a word in every line).
 */
import { describe, expect, it } from 'vitest';
import { analyze, DEFAULT_ANALYZE_OPTIONS, detectGenericWords } from '../src/core/analyze';
import { tokenizeCorpus } from '../src/core/tokenize';

const chatOf = (texts: string[]) => [
  JSON.stringify({ user_name: 'u', character_name: 'c' }),
  ...texts.map((t, i) => JSON.stringify({ name: i % 2 ? 'c' : 'u', is_user: i % 2 === 0, mes: t })),
].join('\n');

describe('generic detection counts tokens, not substrings', () => {
  it('cat inside category is not a token of cat', () => {
    const tok = tokenizeCorpus(
      ['the category list is ready.', 'another category appears.', 'a cat sat down.'],
      { minLength: 2, minCount: 1, useStopwords: false, useNarrativeStopwords: false, mergeEnglishForms: false },
    );
    const cats = tok.tokensByMessage.flat().filter((t) => t === 'cat').length;
    const catsFull = tok.tokensByMessage.flat().filter((t) => t === 'category').length;
    expect(catsFull).toBe(2);
    expect(cats).toBe(1);
    expect(tok.tokensByMessage[0].includes('cat')).toBe(false);
  });

  it('a substring of a ubiquitous word is not tagged generic', () => {
    // Every message has "category"; only four also have the token "cat".
    // indexOf("cat") would fire on every "category" and look like filler.
    const texts = Array.from({ length: 20 }, (_, i) => {
      const line = `Day ${i} the category list was updated quietly.`;
      return i < 4 ? `${line} A cat walked by.` : line;
    });
    const r = analyze(
      [{ name: 'a.jsonl', content: chatOf(texts) }],
      {
        ...DEFAULT_ANALYZE_OPTIONS,
        roles: ['user', 'char'],
        tokenize: { ...DEFAULT_ANALYZE_OPTIONS.tokenize, minCount: 1, mergeEnglishForms: false },
      },
    );
    const kinds = (w: string) => r.allWords.find((x) => x.text === w)?.kinds?.map((k) => k.kind) ?? [];
    expect(kinds('cat')).not.toContain('generic');
  });

  it('detectGenericWords on token bags ignores a substring-only hit', () => {
    const tokens = Array.from({ length: 12 }, () => ['办公室', '合同']);
    tokens[0] = ['办公', '桌子'];
    tokens[1] = ['办公', '节奏'];
    const generic = detectGenericWords(
      [{ text: '办公', count: 2 }, { text: '办公室', count: 12 }, { text: '合同', count: 12 }],
      tokens,
      () => false,
    );
    expect(generic.has('办公')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { segmentToChunks, tokenizeCorpus, tokenizeCorpusAsync } from '../src/core/tokenize';

describe('tokenization', () => {
  it('punctuation breaks chunks', () => {
    const chunks = segmentToChunks('他走了。她来了。');
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.join('')).not.toContain('了她');
  });

  it('discovery reassembles names the segmenter split', () => {
    // 沈砚秋 is in no dictionary; discovery must recover it
    const texts = Array.from({ length: 12 }, (_, i) => `沈砚秋走进房间，沈砚秋看了他一眼，第${i}次。`);
    const res = tokenizeCorpus(texts, { discoverMinCount: 4, minCount: 2 });
    expect(res.words.map((w) => w.text)).toContain('沈砚秋');
  });

  it('collocations with function words are not discovered', () => {
    const texts = Array.from({ length: 30 }, () => '他喝了一口水，然后喝了一口茶。');
    const res = tokenizeCorpus(texts, { discoverMinCount: 3, minCount: 2 });
    expect(res.words.map((w) => w.text)).not.toContain('喝了一口');
  });

  it('stop words, numbers and short tokens are excluded', () => {
    const res = tokenizeCorpus(['我们的确 已经 2024 3.5% 合同 合同 合同'], { minCount: 1, minLength: 2 });
    const words = res.words.map((w) => w.text);
    expect(words).toContain('合同');
    expect(words).not.toContain('已经');
    expect(words).not.toContain('2024');
  });

  it('dictionary words are whole tokens', () => {
    const texts = Array.from({ length: 5 }, () => '楚天阔今天来了。');
    const res = tokenizeCorpus(texts, { dictionary: ['楚天阔'], minCount: 2, discoverPhrases: false });
    expect(res.words.map((w) => w.text)).toContain('楚天阔');
  });

  it('English is split by word and lower-cased', () => {
    const res = tokenizeCorpus(['Hello World hello world CONTRACT contract'], { minCount: 2, minLength: 3 });
    const m = new Map(res.words.map((w) => [w.text, w.count]));
    expect(m.get('hello')).toBe(2);
    expect(m.get('contract')).toBe(2);
  });

  it('empty corpus', () => {
    const res = tokenizeCorpus([]);
    expect(res.words).toEqual([]);
    expect(res.totalTokens).toBe(0);
  });
});


describe('async tokenization progress', () => {
  /**
   * A 5 MB export used to report per file, so the ring sat at 0/1 until the whole
   * thing was done. Progress is counted in characters now, one report per batch.
   */
  it('reports characters at least 20 times, monotonically, for a 1500-message log', async () => {
    const texts = Array.from({ length: 1500 }, (_, i) => `第${i}天，沈砚秋走进房间，看了他一眼。`);
    const seen: Array<[number, number]> = [];
    const res = await tokenizeCorpusAsync(
      texts, { discoverMinCount: 4, minCount: 2 }, undefined,
      (done, total) => seen.push([done, total]),
      () => Promise.resolve(),
    );
    expect(seen.length).toBeGreaterThanOrEqual(20);
    const totalChars = texts.reduce((n, t) => n + t.length, 0);
    for (let i = 1; i < seen.length; i++) expect(seen[i][0]).toBeGreaterThan(seen[i - 1][0]);
    expect(seen[seen.length - 1][0]).toBe(totalChars);
    for (const [, total] of seen) expect(total).toBe(totalChars);
    expect(res.words.length).toBeGreaterThan(0);
  });

  it('the character cap ends a batch early when messages are long', async () => {
    const long = 'a'.repeat(50_000);
    const texts = Array.from({ length: 40 }, () => long);
    const seen: number[] = [];
    await tokenizeCorpusAsync(texts, {}, undefined, (d) => seen.push(d), () => Promise.resolve(), 40, 100_000);
    // 40 texts would have been one batch on the message cap alone
    expect(seen.length).toBeGreaterThan(1);
  });
});

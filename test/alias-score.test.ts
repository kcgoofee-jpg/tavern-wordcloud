/**
 * Ordering properties of the equivalence-candidate score (core/aliasScore.ts).
 * Constructed data only — nothing here reads the local corpus.
 */
import { describe, expect, it } from 'vitest';
import { ALIAS_WEIGHTS, rankAliasCandidates, scoreAliasCandidate } from '../src/core/aliasScore';
import { buildCooccur, cooccurRate, stripCooccur, type Cooccur } from '../src/core/cooccur';

const target = { text: '西德妮', count: 30, kind: 'person' as const };

/** pairs are symmetric; docs are message-presence counts. */
function co(docs: Record<string, number>, pairs: [string, string, number][]): Cooccur {
  const out: Cooccur = { docs, pairs: {} };
  for (const [a, b, c] of pairs) {
    (out.pairs[a] ??= {})[b] = c;
    (out.pairs[b] ??= {})[a] = c;
  }
  return out;
}

describe('cooccurRate', () => {
  const idx = co({ '西德妮': 30, 'sydney': 20, '超市': 25 }, [['西德妮', 'sydney', 20], ['西德妮', '超市', 5]]);

  it('divides by the rarer word and stays in 0..1', () => {
    expect(cooccurRate(idx, '西德妮', 'sydney')).toBe(1);
    expect(cooccurRate(idx, '西德妮', '超市')).toBeCloseTo(5 / 25);
  });

  it('is symmetric, case-insensitive and 0 for unknown pairs', () => {
    expect(cooccurRate(idx, 'SYDNEY', '西德妮')).toBe(1);
    expect(cooccurRate(idx, 'sydney', '超市')).toBe(0);
    expect(cooccurRate(null, 'a', 'b')).toBe(0);
  });
});

describe('scoreAliasCandidate', () => {
  it('rules out a candidate that does not match what was typed', () => {
    expect(scoreAliasCandidate({ text: '超市', count: 9 }, target, { needle: 'syd' })).toBeNull();
  });

  it('scores a prefix above a substring match', () => {
    const pre = scoreAliasCandidate({ text: 'sydney', count: 9 }, target, { needle: 'syd' })!;
    const sub = scoreAliasCandidate({ text: 'asydneyb', count: 9 }, target, { needle: 'syd' })!;
    expect(pre - sub).toBe(ALIAS_WEIGHTS.prefix - ALIAS_WEIGHTS.includes);
  });

  it('adds the kind bonus and the co-occurrence term, and penalises an existing alias', () => {
    const idx = co({ '西德妮': 10, 'sydney': 10 }, [['西德妮', 'sydney', 10]]);
    const plain = scoreAliasCandidate({ text: 'zzzzzz', count: 1 }, target)!;
    const same = scoreAliasCandidate({ text: 'zzzzzz', count: 1, kind: 'person' }, target)!;
    expect(same - plain).toBe(ALIAS_WEIGHTS.kind);
    const withCo = scoreAliasCandidate({ text: 'sydney', count: 9 }, target, { cooccur: idx })!;
    const noCo = scoreAliasCandidate({ text: 'sydney', count: 9 }, target)!;
    expect(withCo - noCo).toBeCloseTo(ALIAS_WEIGHTS.cooccur);
    const demoted = scoreAliasCandidate({ text: 'sydney', count: 9 }, target, { aliased: new Set(['sydney']) })!;
    expect(demoted - noCo).toBe(ALIAS_WEIGHTS.aliased);
  });

  it('rewards a similar length', () => {
    const near = scoreAliasCandidate({ text: '西德尼x', count: 1 }, target)!;
    const far = scoreAliasCandidate({ text: '一二三四五六七八', count: 1 }, target)!;
    expect(near - far).toBe(ALIAS_WEIGHTS.length);
  });
});

describe('rankAliasCandidates', () => {
  const words = [
    { text: '西德妮', count: 30, kind: 'person' as const },
    { text: 'sydney', count: 20 },
    { text: '超市', count: 25 },
    { text: '早餐', count: 24 },
  ];

  it('puts a fully co-occurring word first and never offers the target itself', () => {
    const idx = co({ '西德妮': 30, 'sydney': 20, '超市': 25, '早餐': 24 },
      [['西德妮', 'sydney', 20], ['西德妮', '超市', 3], ['西德妮', '早餐', 2]]);
    const out = rankAliasCandidates(target, words, { cooccur: idx });
    expect(out[0].text).toBe('sydney');
    expect(out.map((w) => w.text)).not.toContain('西德妮');
  });

  it('honours the limit and orders equal scores by count', () => {
    const out = rankAliasCandidates(target, words, {}, 2);
    expect(out).toHaveLength(2);
    expect(out[0].count).toBeGreaterThanOrEqual(out[1].count);
  });
});

describe('buildCooccur', () => {
  const texts = ['西德妮去超市', '西德妮 sydney 一起', 'sydney 又见西德妮', '超市关门了'];
  const words = [{ text: '西德妮' }, { text: 'sydney' }, { text: '超市' }];

  it('counts messages holding both words and drops single-message pairs', () => {
    const idx = buildCooccur(texts, words);
    expect(idx.docs['西德妮']).toBe(3);
    expect(idx.pairs['西德妮']?.['sydney']).toBe(2);
    // 西德妮 + 超市 share only one message, below the minimum.
    expect(idx.pairs['西德妮']?.['超市']).toBeUndefined();
  });

  it('respects topN and the pair cap, and survives an empty corpus', () => {
    expect(buildCooccur(texts, words, { topN: 1 }).pairs).toEqual({});
    expect(buildCooccur(texts, words, { maxPairs: 0 }).pairs).toEqual({});
    expect(buildCooccur([], words)).toEqual({ docs: {}, pairs: {} });
  });

  it('stripCooccur removes the index without mutating the input', () => {
    const r = { words: [], cooccur: buildCooccur(texts, words) };
    const out = stripCooccur(r);
    expect('cooccur' in out).toBe(false);
    expect(r.cooccur).toBeDefined();
  });
});

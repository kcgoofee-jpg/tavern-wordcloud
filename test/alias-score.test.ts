/**
 * Ordering properties of the equivalence-candidate score (core/aliasScore.ts).
 * Constructed data only — nothing here reads the local corpus.
 */
import { describe, expect, it } from 'vitest';
import {
  affixScore, ALIAS_WEIGHTS, neighborSimilarity, rankAliasCandidates, scoreAliasCandidate,
} from '../src/core/aliasScore';
import { cjkSkeleton, spellingSimilarity, translitSimilarity } from '../src/core/translit';
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
    // Both candidates are the same string apart from where the needle sits, so
    // every other signal cancels and only prefix − includes is left.
    const pre = scoreAliasCandidate({ text: 'qqzz', count: 9 }, target, { needle: 'qq' })!;
    const sub = scoreAliasCandidate({ text: 'zqqz', count: 9 }, target, { needle: 'qq' })!;
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
    // sydney wins on transliteration; the two words that tie at zero evidence
    // are then ordered by count, which is what the tie-break has to guarantee.
    expect(out[0].text).toBe('sydney');
    // 超市 and 早餐 carry no evidence at all against 西德妮 and tie on score,
    // so the count breaks the tie and the more frequent word comes first.
    const tied = rankAliasCandidates(target, words, {}).filter((w) => w.text === '超市' || w.text === '早餐');
    expect(tied.map((w) => w.text)).toEqual(['超市', '早餐']);
  });
});

/** The signals added by TODO C.10, each measured on its own. */
describe('C.10 的新信号', () => {
  it('把同指组里的短称排到最前', () => {
    const words = [
      { text: '砚秋', count: 5 },
      { text: '合同', count: 400, kind: 'person' as const },
      { text: '剧组', count: 380, kind: 'person' as const },
    ];
    const full = { text: '沈砚秋', count: 9, kind: 'person' as const };
    const coref = [{ full: '沈砚秋', aliases: ['砚秋'] }];
    expect(rankAliasCandidates(full, words, { coref })[0].text).toBe('砚秋');
    // Without the group the far more frequent same-kind words win instead.
    expect(rankAliasCandidates(full, words, { signals: { coref: false, affix: false } })[0].text)
      .not.toBe('砚秋');
  });

  it('缩写：子串按覆盖率给分，取字缩写走子序列', () => {
    expect(affixScore('砚山文化', '砚山')).toBeGreaterThan(ALIAS_WEIGHTS.contain);
    expect(affixScore('中央戏剧学院', '中戏')).toBe(ALIAS_WEIGHTS.subsequence);
    // Same first character but neither contains nor selects from the other.
    expect(affixScore('电话', '电视')).toBe(0);
    // Single characters are too common to be evidence.
    expect(affixScore('电话', '电')).toBe(0);
  });

  it('音译：中英各一边才算，普通中文词没有骨架', () => {
    expect(translitSimilarity('西德妮', 'sydney')).toBe(1);
    expect(translitSimilarity('玛丽', 'mary')).toBe(1);
    expect(translitSimilarity('艾莉丝', 'alice')).toBe(1);
    expect(translitSimilarity('索菲亚', 'sophia')).toBe(1);
    expect(translitSimilarity('莉莉丝', 'lilith')).toBe(1);
    // 合同 is ordinary Chinese: not one character is in the transliteration table.
    expect(cjkSkeleton('合同')).toBeNull();
    expect(translitSimilarity('合同', 'contract')).toBe(0);
    // Two Chinese words, or two Latin words, are not this signal's business.
    expect(translitSimilarity('玛丽', '玛雅')).toBe(0);
    expect(translitSimilarity('mary', 'mari')).toBe(0);
  });

  it('英文异写用编辑距离，拼写差得远的不算', () => {
    expect(spellingSimilarity('sydney', 'sydny')).toBeGreaterThan(0.8);
    expect(spellingSimilarity('claire', 'clair')).toBeGreaterThan(0.8);
    expect(spellingSimilarity('sydney', 'sandy')).toBeLessThan(0.6);
  });

  it('互补分布不单独成立：没有别的证据时邻居相似度不给分', () => {
    // a and b never share a message (no pair between them) but keep identical company.
    const idx = co({ a: 10, b: 10, x: 10, y: 10 }, [['a', 'x', 8], ['a', 'y', 8], ['b', 'x', 8], ['b', 'y', 8]]);
    expect(neighborSimilarity(idx, 'a', 'b')).toBeCloseTo(1);
    const alone = scoreAliasCandidate({ text: 'b', count: 5 }, { text: 'a', count: 5 }, { cooccur: idx })!;
    const withKind = scoreAliasCandidate(
      { text: 'b', count: 5, kind: 'person' }, { text: 'a', count: 5, kind: 'person' }, { cooccur: idx },
    )!;
    // Same length in both calls, so the gap is the kind bonus plus the neighbour
    // bonus that the kind evidence unlocked — never the neighbour bonus alone.
    expect(withKind - alone).toBeCloseTo(ALIAS_WEIGHTS.kind + ALIAS_WEIGHTS.neighbor);
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

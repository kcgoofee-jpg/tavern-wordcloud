/**
 * Junk rate: share of a curated list of filler words in the TOP n of a cloud.
 * The list is what real exports showed in their TOP 40 before the generated
 * stop words and the generic-word tag existed (2026-09-04). Every entry must be
 * a stop word (test/junk.test.ts pins that), so a non-zero rate means a leak.
 */
import type { WordCount } from '../../src/core/types';

export const JUNK: readonly string[] = `
那只 那片 那双 那股 那条 那些 一股 一只 一片 一双 一条 一阵 一丝 一抹 每个 这片 这只 这股
极度 彻底 几乎 刚刚 原本 本来 顿时 瞬间 随即 立即 随后 此刻 此时 同时 逐渐 渐渐 完全 根本 简直
上方 下方 前方 后方 左侧 右侧 两侧 向上 向下 向前 向后 顺着 沿着 朝着 身前 身后 身侧 眼前 面前
`.trim().split(/\s+/);

/** Deliberately content-bearing words that share a character with the junk list; they must never be stop words. */
export const NOT_JUNK: readonly string[] = ['片场', '股份', '条件', '内部', '中心', '双手', '对面的人'];

export function junkRate(words: readonly WordCount[], n = 40): { rate: number; hits: string[] } {
  const junk = new Set(JUNK);
  const hits = words.slice(0, n).map((w) => w.text).filter((t) => junk.has(t));
  return { rate: hits.length / Math.max(1, Math.min(n, words.length)), hits };
}

/**
 * Complexity guards for the cleaning passes. Separate file so the behavioural
 * cases in clean.test.ts stay untouched (2026-09-05 security review).
 */
import { describe, expect, it } from 'vitest';
import { stripJsonBlocks } from '../src/core/clean';

describe('stripJsonBlocks is linear in the input', () => {
  it('a wall of unmatched openers returns in well under 200 ms', () => {
    // Every `[` used to start its own 200 k-character scan: O(n²), tens of seconds
    // of blocked event loop on one message.
    for (const wall of ['['.repeat(200_000), '{'.repeat(200_000), '[{'.repeat(100_000)]) {
      const t0 = Date.now();
      const out = stripJsonBlocks(wall);
      expect(`len ${out.length}, ms < 200: ${Date.now() - t0 < 200}`).toBe(`len ${wall.length}, ms < 200: true`);
    }
  });

  it('the skip does not hide a real JSON block behind a stray opener', () => {
    // The span is only skipped when the nesting depth never came back down, so a
    // block after `[[` (whose depth does come down) is still found and removed.
    const mes = '前文 [[ 未闭合 {"op": "insert", "path": "/a/b", "value": 12345} 后文';
    expect(stripJsonBlocks(mes)).not.toContain('insert');
    // …and a well-formed block on its own is still removed
    expect(stripJsonBlocks('前 {"op":"set","path":"/x","value":[1,2,3]} 后').replace(/\s+/g, ' ')).toBe('前 后');
  });
});

/**
 * Complexity guards for the cleaning passes. Separate file so the behavioural
 * cases in clean.test.ts stay untouched (2026-09-05 security review).
 */
import { describe, expect, it } from 'vitest';
import { cleanMessageText, DEFAULT_CLEAN_OPTIONS, stripJsonBlocks, stripMarkdownLinks } from '../src/core/clean';

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

describe('stripMarkdownLinks is linear in the input', () => {
  it('a wall of unmatched brackets returns in well under 200 ms', () => {
    // `[^\]]*` from every `[` was O(n²). Same skip as stripJsonBlocks: no `]`
    // ahead means no later `[` can close a link either.
    for (const wall of ['['.repeat(200_000), '['.repeat(100_000) + ']', '!['.repeat(50_000)]) {
      const t0 = Date.now();
      const out = stripMarkdownLinks(wall);
      expect(`len ${out.length}, ms < 200: ${Date.now() - t0 < 200}`).toBe(`len ${wall.length}, ms < 200: true`);
    }
  });

  it('keeps link text, drops image alts, leaves a lone [bracket] alone', () => {
    expect(stripMarkdownLinks('见[这篇](https://a.b)文章')).toBe('见这篇文章');
    expect(stripMarkdownLinks('图![x](https://a.b/i.png)后')).toBe('图 后');
    expect(stripMarkdownLinks('就是[这样]而已')).toBe('就是[这样]而已');
  });

  it('macros and links still run through the full cleaner', () => {
    const out = cleanMessageText('{{char}} 见[这篇](https://a.b)文章', DEFAULT_CLEAN_OPTIONS);
    expect(out).not.toContain('{{');
    expect(out).toContain('这篇');
    expect(out).not.toContain('https://');
  });
});

describe('other cleaning regexes are linear', () => {
  it('split of a fence wall is cheap (sanity)', () => {
    const wall = '```'.repeat(30_000);
    const t0 = Date.now();
    expect(wall.split('```').length).toBe(30_001);
    expect(Date.now() - t0).toBeLessThan(50);
  });

  it('unmatched comments, tags, fences, OOC and backticks return in well under 200 ms', () => {
    const walls: [string, string][] = [
      ['comment', '<!--'.repeat(40_000)],
      ['tag', '<a'.repeat(50_000)],
      ['fence', '```'.repeat(30_000)],
      ['ooc', '[OOC:'.repeat(20_000)],
      ['tick', '`'.repeat(80_000)],
    ];
    for (const [name, wall] of walls) {
      const t0 = Date.now();
      const out = cleanMessageText(wall, DEFAULT_CLEAN_OPTIONS);
      expect(Date.now() - t0, `${name} in=${wall.length} out=${out.length}`).toBeLessThan(200);
    }
  });
});

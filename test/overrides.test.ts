import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { applyOverrides, applyPriority, hasAliasCycle, parsePriority } from '../src/core/overrides';
import type { WordCount, WordOverride } from '../src/core/types';
import { analyze, DEFAULT_ANALYZE_OPTIONS } from '../src/core/analyze';

function wc(text: string, count: number, extra: Partial<WordCount> = {}): WordCount {
  return { text, count, ...extra };
}

describe('parsePriority', () => {
  it('splits on ASCII and fullwidth semicolons, trims, drops empties', () => {
    expect(parsePriority('a; b ；c ;; ')).toEqual(['a', 'b', 'c']);
  });

  it('treats fullwidth space as whitespace to trim', () => {
    expect(parsePriority('　foo　;bar')).toEqual(['foo', 'bar']);
  });

  it('all spaces/semicolons -> no priority words', () => {
    expect(parsePriority('  ；;  ；')).toEqual([]);
    expect(parsePriority('')).toEqual([]);
  });

  it('case-insensitive dedupe keeps first spelling', () => {
    expect(parsePriority('Maya；maya；MAYA')).toEqual(['Maya']);
  });

  it('drops items over 32 chars', () => {
    const long = 'a'.repeat(33);
    const ok = 'b'.repeat(32);
    expect(parsePriority(`${long};${ok}`)).toEqual([ok]);
  });

  it('caps at 50 items', () => {
    const many = Array.from({ length: 60 }, (_, i) => `w${i}`).join(';');
    const out = parsePriority(many);
    expect(out).toHaveLength(50);
    expect(out[0]).toBe('w0');
    expect(out[49]).toBe('w49');
  });
});

describe('applyPriority', () => {
  it('50 priority words + empty corpus: only those words, no crash', () => {
    const priority = Array.from({ length: 50 }, (_, i) => `p${i}`);
    const out = applyPriority([], priority);
    expect(out).toHaveLength(50);
    expect(out.every((w) => w.priority)).toBe(true);
  });

  it('does not mutate input', () => {
    const words = [wc('a', 10)];
    const snapshot = JSON.parse(JSON.stringify(words));
    applyPriority(words, ['a', 'b']);
    expect(words).toEqual(snapshot);
  });

  it('replaces count for an existing word rather than adding to it', () => {
    const words = [wc('a', 10), wc('b', 5)];
    const out = applyPriority(words, ['a']);
    const a = out.find((w) => w.text === 'a')!;
    // n=1, i=0 -> c = maxC * (1 + 1/1) = 2*maxC = 20
    expect(a.count).toBe(20);
    expect(a.priority).toBe(true);
  });

  it('adds missing priority words as kind:plain, priority:true', () => {
    const words = [wc('a', 10)];
    const out = applyPriority(words, ['zzz']);
    const z = out.find((w) => w.text === 'zzz')!;
    expect(z.kind).toBe('plain');
    expect(z.priority).toBe(true);
    expect(z.count).toBeGreaterThan(10);
  });

  it('counts are monotonically decreasing by rank, in (maxC, 2*maxC]', () => {
    const words = [wc('a', 100)];
    const priority = ['p0', 'p1', 'p2'];
    const out = applyPriority(words, priority);
    const cs = priority.map((p) => out.find((w) => w.text === p)!.count);
    expect(cs[0]).toBeGreaterThan(cs[1]);
    expect(cs[1]).toBeGreaterThan(cs[2]);
    for (const c of cs) {
      expect(c).toBeGreaterThan(100);
      expect(c).toBeLessThanOrEqual(200);
    }
  });

  it('empty priority list is a no-op (identity)', () => {
    const words = [wc('a', 10)];
    expect(applyPriority(words, [])).toEqual(words);
  });

  it('no-result corpus: maxC falls back to 1', () => {
    const out = applyPriority([], ['solo']);
    expect(out[0].count).toBe(2); // maxC=1, n=1,i=0 -> 1*(1+1)=2
  });
});

describe('applyOverrides', () => {
  it('display does not change count, kind, or text', () => {
    const words = [wc('a', 10, { kind: 'person' })];
    const out = applyOverrides(words, { a: { display: 'A!' } });
    const a = out.find((w) => w.text === 'a')!;
    expect(a.display).toBe('A!');
    expect(a.count).toBe(10);
    expect(a.kind).toBe('person');
  });

  it('alias merges count into target (single hop)', () => {
    const words = [wc('a', 10), wc('b', 5)];
    const out = applyOverrides(words, { a: { alias: 'b' } });
    const b = out.find((w) => w.text === 'b')!;
    expect(b.count).toBe(15);
    expect(out.find((w) => w.text === 'a')).toBeUndefined(); // count dropped to 0, filtered
  });

  it('alias follows multi-hop chains to the final target', () => {
    const words = [wc('a', 1), wc('b', 2), wc('c', 3)];
    const out = applyOverrides(words, { a: { alias: 'b' }, b: { alias: 'c' } });
    const c = out.find((w) => w.text === 'c')!;
    expect(c.count).toBe(6);
  });

  it('cyclic alias is ignored; words keep their own counts', () => {
    const words = [wc('a', 1), wc('b', 2)];
    const out = applyOverrides(words, { a: { alias: 'b' }, b: { alias: 'a' } });
    // Cycle detected: neither alias is applied.
    expect(out.find((w) => w.text === 'a')?.count).toBe(1);
    expect(out.find((w) => w.text === 'b')?.count).toBe(2);
  });

  it('hasAliasCycle detects a would-be cycle before writing', () => {
    const ov: Record<string, WordOverride> = { b: { alias: 'c' }, c: { alias: 'd' } };
    // Setting a.alias = 'b' now: does the chain from b ever get back to a? No.
    expect(hasAliasCycle(ov, 'a', 'b')).toBe(false);
    // Setting d.alias = 'a', and a already aliases to b->c->d: d->a->b->c->d is a cycle.
    const ov2: Record<string, WordOverride> = { ...ov, a: { alias: 'b' } };
    expect(hasAliasCycle(ov2, 'd', 'a')).toBe(true);
  });

  it('keys match case-insensitively', () => {
    const words = [wc('Maya', 10)];
    const out = applyOverrides(words, { maya: { display: 'M' } });
    expect(out[0].display).toBe('M');
  });

  it('rotate and kind are attached directly', () => {
    const words = [wc('a', 1)];
    const out = applyOverrides(words, { a: { rotate: 'v', kind: 'place' } });
    expect(out[0].rotate).toBe('v');
    expect(out[0].kind).toBe('place');
  });

  it('does not mutate input and is a no-op for empty overrides', () => {
    const words = [wc('a', 1)];
    expect(applyOverrides(words, {})).toEqual(words);
    const snapshot = JSON.parse(JSON.stringify(words));
    applyOverrides(words, { a: { display: 'x' } });
    expect(words).toEqual(snapshot);
  });

  it('alias to a target not present in the word list: source keeps its count', () => {
    const words = [wc('a', 5)];
    const out = applyOverrides(words, { a: { alias: 'ghost' } });
    expect(out.find((w) => w.text === 'a')?.count).toBe(5);
  });
});

describe('perf: 1500-layer fixture, 50 priority + 200 overrides < 5ms', () => {
  const dir = path.join(process.cwd(), 'fixtures');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')) : [];

  it.skipIf(files.length === 0)('stays under budget', () => {
    // Pick the largest fixture by file size (biggest layer count).
    let biggest = files[0];
    let biggestSize = 0;
    for (const f of files) {
      const size = fs.statSync(path.join(dir, f)).size;
      if (size > biggestSize) {
        biggestSize = size;
        biggest = f;
      }
    }
    const raw = fs.readFileSync(path.join(dir, biggest), 'utf8');
    const result = analyze([{ name: biggest, content: raw }], DEFAULT_ANALYZE_OPTIONS);
    const words = result.words;
    expect(words.length).toBeGreaterThan(0);

    const priority = parsePriority(
      Array.from({ length: 55 }, (_, i) => `优先词${i}`).join(';'),
    );
    expect(priority.length).toBe(50);

    const overrides: Record<string, WordOverride> = {};
    const sample = words.slice(0, 200);
    sample.forEach((w, i) => {
      overrides[w.text.toLowerCase()] = i % 3 === 0
        ? { display: `${w.text}!` }
        : i % 3 === 1
        ? { rotate: i % 2 === 0 ? 'h' : 'v' }
        : { kind: 'plain' };
    });

    const t0 = performance.now();
    const withPriority = applyPriority(words, priority);
    const finalWords = applyOverrides(withPriority, overrides);
    const elapsed = performance.now() - t0;

    expect(finalWords.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(5);
  });
});

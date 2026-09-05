/** Layout regression with a fake text measurer (width = size per CJK character, height = size x 0.92); guards against the spiral not reaching the canvas edges. */
import { describe, expect, it } from 'vitest';
import { canStack, layoutCloud, stackedLines, VERTICAL_LINE_RATIO, type Measure } from '../src/render/layout';
import type { WordCount } from '../src/core/types';
import snapshot from './layout-snapshot.json';

const measure: Measure = (text, fontSize) => ({ w: text.length * fontSize, h: fontSize * 0.92 });

const words: WordCount[] = Array.from({ length: 120 }, (_, i) => ({
  text: '词' + i,
  count: Math.round(500 / (i + 1)) + 1,
}));

/** All-CJK words, so the vertical ones take the stacked path (the `词N` set has ASCII digits). */
const NUM = '零一二三四五六七八九';
const cjkWords: WordCount[] = Array.from({ length: 120 }, (_, i) => ({
  text: '词' + NUM[Math.floor(i / 100)] + NUM[Math.floor(i / 10) % 10] + NUM[i % 10],
  count: Math.round(500 / (i + 1)) + 1,
}));

const opts = {
  width: 2560, height: 1440,
  maxFontSize: 262, minFontSize: 26,
  rotateRatio: 0.2, steps: 6, padding: 9, idleAmplitude: 4.5,
  seed: 1, fontFamily: 'sans-serif', fontWeight: '600',
};

describe('cloud layout', () => {
  it('most words fit', () => {
    const p = layoutCloud(words, opts, measure);
    expect(p.length).toBeGreaterThanOrEqual(Math.floor(words.length * 0.8));
  });

  it('spreads out instead of clustering in the center', () => {
    const p = layoutCloud(words, opts, measure);
    const xs = p.map((q) => q.x);
    const ys = p.map((q) => q.y);
    // At least 70% of the width and 55% of the height (the spiral is flattened)
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(opts.width * 0.7);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(opts.height * 0.55);
  });

  it('bounding boxes do not overlap', () => {
    const p = layoutCloud(words, opts, measure);
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) {
        const a = p[i], b = p[j];
        const overlap =
          Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;
        expect(overlap, `${a.text} 和 ${b.text} 叠了`).toBe(false);
      }
    }
  });

  it('float amplitude is inside the gap, so floating never overlaps', () => {
    const p = layoutCloud(words, opts, measure);
    let worstGap = Infinity;
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) {
        const a = p[i], b = p[j];
        const gx = Math.abs(a.x - b.x) - (a.w + b.w) / 2;
        const gy = Math.abs(a.y - b.y) - (a.h + b.h) / 2;
        if (Math.max(gx, gy) < worstGap) worstGap = Math.max(gx, gy);
      }
    }
    expect(worstGap).toBeGreaterThanOrEqual(opts.idleAmplitude);
  });

  it('all six ramp steps are used', () => {
    const p = layoutCloud(words, opts, measure);
    expect(new Set(p.map((q) => q.step)).size).toBeGreaterThanOrEqual(5);
  });

  it('same input, same layout', () => {
    const a = layoutCloud(words, opts, measure);
    const b = layoutCloud(words, opts, measure);
    expect(a.map((p) => `${p.text}@${p.x},${p.y}`)).toEqual(b.map((p) => `${p.text}@${p.x},${p.y}`));
  });
});

/**
 * Byte-identical placement lock. Shared links and exports replay a layout from
 * (words, seed, options), so any change in the spiral order or in a landing point
 * silently breaks old links. Optimisations must keep every field identical.
 * Regenerating this file is only allowed together with a deliberate layout change.
 */
describe('placement is byte-identical', () => {
  const many: WordCount[] = Array.from({ length: 400 }, (_, i) => ({
    text: '词' + i,
    count: Math.round(2000 / (i + 1)) + 1,
  }));
  const portraitOpts = { ...opts, width: 750, height: 1624, maxFontSize: 136, minFontSize: 26, padding: 5, idleAmplitude: 2.4 };
  const insetOpts = { ...opts, inset: { top: 16, right: 16, bottom: 236, left: 156 } };
  /** All-CJK, every word forced vertical: locks the stacked box size and the spiral it produces. */
  const stackedWords = cjkWords.map((w) => ({ ...w, rotate: 'v' as const }));
  const stackedOpts = { ...opts, rotateRatio: 1 };
  const ser = (ws: WordCount[], o: typeof opts) =>
    layoutCloud(ws, o, measure).map(
      (p) =>
        `${p.text}|${p.x}|${p.y}|${p.w}|${p.h}|${p.fontSize}|${p.rotated ? 1 : 0}${p.stacked ? 'S' : ''}|${p.step}|${p.delay}|${p.phase}`,
    );

  /**
   * The snapshot was generated on macOS. Linux libm rounds Math.sin/cos differently in the
   * last ulp, which flips a handful of spiral collision tests, so CI (ubuntu) only checks the
   * platform-independent part: same words placed in the same order with the same sizes.
   * Full byte identity is asserted where the snapshot came from.
   */
  const exact = process.platform === 'darwin' ? it : it.skip;
  const order = (lines: string[]) => lines.map((l) => { const [t, , , w, h, f, r] = l.split('|'); return `${t}|${w}|${h}|${f}|${r}`; });
  exact('landscape, 120 words', () => expect(ser(words, opts)).toEqual(snapshot.landscape120));
  exact('landscape, 400 candidates', () => expect(ser(many, opts)).toEqual(snapshot.landscape400));
  exact('portrait, 120 words', () => expect(ser(words, portraitOpts)).toEqual(snapshot.portrait120));
  exact('with insets, 120 words', () => expect(ser(words, insetOpts)).toEqual(snapshot.inset120));
  exact('all-CJK stacked, 120 words', () => expect(ser(stackedWords, stackedOpts)).toEqual(snapshot.stacked120));
  it('same words, order and sizes on every platform', () => {
    expect(order(ser(words, opts))).toEqual(order(snapshot.landscape120));
    expect(order(ser(words, portraitOpts))).toEqual(order(snapshot.portrait120));
    expect(order(ser(stackedWords, stackedOpts))).toEqual(order(snapshot.stacked120));
  });
});

describe('typography rules', () => {
  it('the three largest words are never rotated', () => {
    const p = layoutCloud(words, { ...opts, rotateRatio: 1 }, measure);
    const top = p.slice(0, 3);
    expect(top.every((q) => !q.rotated)).toBe(true);
  });
});

/**
 * A vertical word used to be the whole word tipped onto its side. For Chinese that is
 * wrong typography: a vertical CJK word is a column of upright glyphs. Latin words have
 * to keep the rotation, because a column of single letters is unreadable, so the two
 * shapes coexist and the boxes must be right for both.
 */
describe('vertical CJK stacks upright instead of lying on its side', () => {
  const allVertical = { ...opts, rotateRatio: 1 };
  const upright = cjkWords.map((w) => ({ ...w, rotate: 'v' as const }));

  it('an all-CJK word stacks, a Latin or mixed one does not', () => {
    expect(canStack('星澜文化')).toBe(true);
    expect(canStack('酒馆')).toBe(true);
    expect(canStack('ロボット')).toBe(true);
    expect(canStack('sydney')).toBe(false);
    expect(canStack('rav4')).toBe(false);
    expect(canStack('A4')).toBe(false);
    // Mixed: the Latin tail would have to be stacked letter by letter, so the whole word rotates.
    expect(canStack('星澜文化AI')).toBe(false);
    expect(canStack('第4章')).toBe(false);
  });

  it('每字正立、逐字递增: glyph centres step down by exactly one pitch', () => {
    const fontSize = 40;
    const pitch = fontSize * VERTICAL_LINE_RATIO;
    const lines = stackedLines('星澜文化', fontSize);
    expect(lines.map((l) => l.ch)).toEqual(['星', '澜', '文', '化']);
    expect(lines.map((l) => l.dy)).toEqual([-1.5 * pitch, -0.5 * pitch, 0.5 * pitch, 1.5 * pitch]);
    // Centred on the word's own centre, so the box is symmetric around y.
    expect(lines[0].dy + lines[3].dy).toBeCloseTo(0, 10);
    // A single glyph sits exactly on the centre: no visible rotation at all.
    expect(stackedLines('馆', fontSize)).toEqual([{ ch: '馆', dy: 0 }]);
  });

  it('a stacked box is one glyph wide and one pitch per glyph tall', () => {
    const p = layoutCloud(upright, allVertical, measure);
    const stacked = p.filter((q) => q.stacked);
    expect(stacked.length).toBeGreaterThan(50);
    for (const q of stacked) {
      expect(q.rotated).toBe(true);
      // measure() is width = chars x fontSize, so the widest single glyph is fontSize.
      expect(q.w).toBeCloseTo(q.fontSize, 6);
      expect(q.h).toBeCloseTo([...q.text].length * q.fontSize * VERTICAL_LINE_RATIO, 6);
      // Taller than wide: it really is a column.
      expect(q.h).toBeGreaterThan(q.w);
    }
  });

  it('Latin, digit and mixed words still rotate as one block', () => {
    const mixed = [
      { text: 'sydney', count: 90 },
      { text: 'rav4', count: 80 },
      { text: 'A4', count: 70 },
      { text: '星澜文化AI', count: 60 },
      { text: '星澜文化', count: 50 },
    ].map((w) => ({ ...w, rotate: 'v' as const }));
    // Small type: a 6-letter word rotated at the default max size would not fit anywhere.
    const p = layoutCloud(mixed, { ...allVertical, maxFontSize: 90, minFontSize: 26 }, measure);
    const at = (t: string) => p.find((q) => q.text === t)!;
    for (const t of ['sydney', 'rav4', 'A4', '星澜文化AI']) {
      expect(at(t).rotated, t).toBe(true);
      expect(at(t).stacked, t).toBe(false);
      // Rotated: the box is the measured height across and the measured width down.
      expect(at(t).w).toBeCloseTo(at(t).fontSize * 0.92, 6);
      expect(at(t).h).toBeCloseTo(t.length * at(t).fontSize, 6);
    }
    expect(at('星澜文化').stacked).toBe(true);
  });

  it('horizontal CJK words are never stacked', () => {
    const p = layoutCloud(cjkWords, { ...opts, rotateRatio: 0 }, measure);
    expect(p.length).toBeGreaterThan(50);
    expect(p.every((q) => !q.stacked)).toBe(true);
  });

  it('stacked boxes collide like any other box: no overlap, float amplitude still spare', () => {
    const p = layoutCloud(upright, allVertical, measure);
    expect(p.some((q) => q.stacked)).toBe(true);
    let worstGap = Infinity;
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) {
        const a = p[i], b = p[j];
        const overlap = Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;
        expect(overlap, `${a.text} 和 ${b.text} 叠了`).toBe(false);
        const gx = Math.abs(a.x - b.x) - (a.w + b.w) / 2;
        const gy = Math.abs(a.y - b.y) - (a.h + b.h) / 2;
        worstGap = Math.min(worstGap, Math.max(gx, gy));
      }
    }
    expect(worstGap).toBeGreaterThanOrEqual(opts.idleAmplitude);
  });
});

describe('aspect ratio', () => {
  const portrait = { ...opts, width: 750, height: 1624, maxFontSize: 136, minFontSize: 26, padding: 5, idleAmplitude: 2.4 };

  it('portrait fills the canvas', () => {
    const p = layoutCloud(words, portrait, measure);
    expect(p.length).toBeGreaterThanOrEqual(Math.floor(words.length * 0.8));
    const ys = p.map((q) => q.y);
    // In portrait the height is the long side and must be used
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(portrait.height * 0.7);
  });

  it('no overlap in portrait', () => {
    const p = layoutCloud(words, portrait, measure);
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) {
        const a = p[i], b = p[j];
        expect(Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h).toBe(false);
      }
    }
  });
});

describe('safe margins', () => {
  it('words never land under the toolbar', () => {
    const inset = { top: 16, right: 16, bottom: 236, left: 156 };
    const p = layoutCloud(words, { ...opts, inset }, measure);
    expect(p.length).toBeGreaterThan(20);
    for (const q of p) {
      expect(q.x - q.w / 2).toBeGreaterThanOrEqual(inset.left);
      expect(q.y - q.h / 2).toBeGreaterThanOrEqual(inset.top);
      expect(q.x + q.w / 2).toBeLessThanOrEqual(opts.width - inset.right);
      expect(q.y + q.h / 2).toBeLessThanOrEqual(opts.height - inset.bottom);
    }
  });
});

describe('performance', () => {
  // Layout is the only heavy main-thread work; a single layout must stay fast
  it('one layout stays within budget', () => {
    const many = Array.from({ length: 400 }, (_, i) => ({
      text: '词' + i, count: Math.round(2000 / (i + 1)) + 1,
    }));
    const t0 = performance.now();
    const p = layoutCloud(many, { ...opts, maxWords: 400 } as typeof opts, measure);
    const ms = performance.now() - t0;
    // 400 words do not fit (about 158 do); overflow is skipped, not overlapped
    expect(p.length).toBeGreaterThan(120);
    // 400 ms: guards against second-scale regressions on slow CI, not precise timing
    expect(ms).toBeLessThan(400);
    console.log(`  400 个词候选 -> 放下 ${p.length} 个，耗时 ${ms.toFixed(0)}ms`);
  });
});

/** An explicit rotation from the word table applies to the biggest words too (reported 2026-09-05). */
import { describe, expect, it } from 'vitest';
import { layoutCloud } from '../src/render/layout';

const measure = (t: string, f: number) => ({ w: t.length * f, h: f * 0.92 });
const opts = { width: 1400, height: 900, maxFontSize: 90, minFontSize: 20, rotateRatio: 0, steps: 6, padding: 6, idleAmplitude: 2, seed: 1 };

describe('forced rotation', () => {
  const words = Array.from({ length: 10 }, (_, i) => ({ text: '词' + i, count: 100 - i * 5 }));
  it('applies to the top three, which the dice never rotate', () => {
    const forced = words.map((w, i) => (i === 0 ? { ...w, rotate: 'v' as const } : w));
    const p = layoutCloud(forced, opts, measure).find((x) => x.text === '词0');
    expect(p?.rotated).toBe(true);
  });
  it('leaves the rest of the layout alone', () => {
    const a = layoutCloud(words, opts, measure).map((p) => `${p.text}|${p.x}|${p.y}`);
    const forced = words.map((w, i) => (i === 0 ? { ...w, rotate: 'h' as const } : w));
    const b = layoutCloud(forced, opts, measure).map((p) => `${p.text}|${p.x}|${p.y}`);
    expect(b).toEqual(a);
  });
});

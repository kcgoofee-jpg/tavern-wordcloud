/**
 * Vector export. Hard rule 4 says layout and export agree: the SVG must place words at the
 * exact coordinates `layoutCloud` produced, the same ones the frozen canvas pose draws.
 */
import { describe, expect, it } from 'vitest';
import { layoutCloud, stackedLines, type Measure } from '../src/render/layout';
import { cloudToSvg, escapeXml } from '../src/render/svg';
import { CloudRenderer } from '../src/render/renderer';
import { THEMES } from '../src/theme/themes';
import type { WordCount } from '../src/core/types';

const measure: Measure = (text, fontSize) => ({ w: text.length * fontSize, h: fontSize * 0.92 });

const words: WordCount[] = Array.from({ length: 60 }, (_, i) => ({
  text: '词' + i,
  count: Math.round(500 / (i + 1)) + 1,
}));

const layoutOpts = {
  width: 1600, height: 900,
  maxFontSize: 180, minFontSize: 22,
  rotateRatio: 0.3, steps: 6, padding: 9, idleAmplitude: 4.5,
  seed: 7, fontFamily: 'sans-serif', fontWeight: '600',
};

const ramp = ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666'];

const svgOpts = {
  width: layoutOpts.width, height: layoutOpts.height,
  ramp, fontFamily: 'Inter', fontWeight: '600',
  background: '#ffffff' as string | null,
};

/** Every `<text>` element in document order, with its attributes parsed out. */
function texts(svg: string) {
  return [...svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)].map((m) => {
    const attrs = m[1];
    const at = (k: string) => attrs.match(new RegExp(`\\b${k}="([^"]*)"`))?.[1];
    return { x: Number(at('x')), y: Number(at('y')), fill: at('fill'), transform: at('transform'), body: m[2] };
  });
}

describe('cloudToSvg matches the layout', () => {
  const placements = layoutCloud(words, layoutOpts, measure);

  it('writes one <text> per placement, in the same order', () => {
    const found = texts(cloudToSvg(placements, svgOpts));
    expect(placements.length).toBeGreaterThan(10);
    // `词N` carries ASCII digits, so nothing here takes the stacked path (covered below).
    expect(placements.every((p) => !p.stacked)).toBe(true);
    expect(found).toHaveLength(placements.length);
    expect(found.map((f) => f.body)).toEqual(placements.map((p) => p.display ?? p.text));
  });

  it('every x/y equals the placement exactly', () => {
    const found = texts(cloudToSvg(placements, svgOpts));
    placements.forEach((p, i) => {
      expect(found[i].x).toBe(Math.round(p.x * 1000) / 1000);
      expect(found[i].y).toBe(Math.round(p.y * 1000) / 1000);
    });
  });

  it('scaling the output does not move a single word: only the group transform changes', () => {
    const a = texts(cloudToSvg(placements, svgOpts));
    const b = texts(cloudToSvg(placements, { ...svgOpts, outWidth: 3200, outHeight: 1800 }));
    expect(b.map((t) => [t.x, t.y])).toEqual(a.map((t) => [t.x, t.y]));
    const big = cloudToSvg(placements, { ...svgOpts, outWidth: 3200, outHeight: 1800 });
    expect(big).toContain('scale(2)');
  });

  it('colours come from the ramp step', () => {
    const found = texts(cloudToSvg(placements, svgOpts));
    placements.forEach((p, i) => expect(found[i].fill).toBe(ramp[p.step]));
  });

  it('rotated words carry rotate(-90 x y), upright ones carry no transform', () => {
    const found = texts(cloudToSvg(placements, svgOpts));
    const rotated = placements.filter((p) => p.rotated);
    expect(rotated.length).toBeGreaterThan(0);
    placements.forEach((p, i) => {
      if (p.rotated) expect(found[i].transform).toMatch(/^rotate\(-90 /);
      else expect(found[i].transform).toBeUndefined();
    });
  });
});

/**
 * Hard rule 4 across the two vertical shapes. An all-CJK vertical word is a column of
 * upright glyphs on the canvas, so the vector file has to put the glyphs at the very same
 * centres — `stackedLines` is the single source both read, and this asserts the SVG really
 * used it rather than a `writing-mode` the renderer places differently.
 */
describe('vertical CJK exports as an upright column, Latin still rotates', () => {
  const vertical: WordCount[] = [
    { text: '星澜文化', count: 90, rotate: 'v' },
    { text: '酒馆词云', count: 80, rotate: 'v' },
    { text: '猫', count: 70, rotate: 'v' },
    { text: 'sydney', count: 60, rotate: 'v' },
    { text: '星澜文化AI', count: 50, rotate: 'v' },
    { text: 'rav4', count: 40, rotate: 'v' },
  ];
  // Small type: a 6-letter word rotated at the default max size would not fit anywhere.
  const placements = layoutCloud(vertical, { ...layoutOpts, maxFontSize: 90, minFontSize: 22 }, measure);
  const at = (t: string) => placements.find((p) => p.text === t)!;

  it('a stacked word becomes one <text> per glyph at the canvas glyph centres', () => {
    const found = texts(cloudToSvg(placements, svgOpts));
    const p = at('星澜文化');
    expect(p.stacked).toBe(true);
    const lines = stackedLines(p.text, p.fontSize);
    const mine = found.filter((f) => lines.some((l) => l.ch === f.body));
    expect(mine.map((f) => f.body)).toEqual(['星', '澜', '文', '化']);
    lines.forEach((l, i) => {
      // x is the word centre for every glyph (text-anchor="middle" on the group)
      expect(mine[i].x).toBe(Math.round(p.x * 1000) / 1000);
      // y walks down by one pitch, exactly what ctx.fillText(ch, 0, l.dy) draws
      expect(mine[i].y).toBe(Math.round((p.y + l.dy) * 1000) / 1000);
      // upright: no per-glyph transform at all
      expect(mine[i].transform).toBeUndefined();
    });
  });

  it('the column stays inside the placement box the layout reserved', () => {
    const p = at('酒馆词云');
    for (const l of stackedLines(p.text, p.fontSize)) {
      expect(Math.abs(l.dy) + p.fontSize / 2).toBeLessThanOrEqual(p.h / 2 + 0.001);
    }
  });

  it('a one-glyph vertical word is a single upright <text>, never a rotated one', () => {
    const found = texts(cloudToSvg(placements, svgOpts));
    const one = found.filter((f) => f.body === '猫');
    expect(at('猫').stacked).toBe(true);
    expect(one).toHaveLength(1);
    expect(one[0].transform).toBeUndefined();
    expect(one[0].y).toBe(Math.round(at('猫').y * 1000) / 1000);
  });

  it('Latin and mixed vertical words stay one rotated <text>', () => {
    const found = texts(cloudToSvg(placements, svgOpts));
    for (const t of ['sydney', 'rav4', '星澜文化AI']) {
      expect(at(t).stacked, t).toBe(false);
      const f = found.filter((q) => q.body === t);
      expect(f, t).toHaveLength(1);
      expect(f[0].transform, t).toMatch(/^rotate\(-90 /);
    }
  });

  /**
   * The canvas half of hard rule 4. A stub 2D context records what the frozen export pose
   * actually paints; at progress 1 the entrance easing is finished, so the only transform
   * left is the translate to the word centre — which makes every fillText offset directly
   * comparable to the `<text> y` the vector export wrote.
   */
  it('the frozen canvas paints each glyph where the SVG puts it', () => {
    const drawn: { ch: string; x: number; y: number; rotate: number }[] = [];
    let tx = 0, ty = 0, rot = 0;
    const stack: number[][] = [];
    const ctx = {
      canvas: {}, letterSpacing: '0px',
      save: () => { stack.push([tx, ty, rot]); },
      restore: () => { [tx, ty, rot] = stack.pop() ?? [0, 0, 0]; },
      translate: (x: number, y: number) => { tx += x; ty += y; },
      rotate: (a: number) => { rot += a; },
      scale: () => {}, clearRect: () => {}, fillRect: () => {},
      fillText: (ch: string, x: number, y: number) => drawn.push({ ch, x: tx + x, y: ty + y, rotate: rot }),
    } as unknown as CanvasRenderingContext2D;

    const renderer = new CloudRenderer({
      placements, theme: THEMES[0], qr: null,
      width: layoutOpts.width, height: layoutOpts.height,
      fontFamily: 'Inter', fontWeight: '600', tracking: 0, idleAmplitude: 0,
    });
    renderer.draw(ctx, {
      progress: 1, morph: 0, time: 0, pointer: null, highlight: null,
      frozen: true, scale: 1, panX: 0, panY: 0, dt: 0.016,
    });

    const svgTexts = texts(cloudToSvg(placements, svgOpts));
    expect(drawn).toHaveLength(svgTexts.length);
    drawn.forEach((d, i) => {
      expect(d.ch, `#${i}`).toBe(svgTexts[i].body);
      expect(d.x, `#${i} x`).toBeCloseTo(svgTexts[i].x, 3);
      expect(d.y, `#${i} y`).toBeCloseTo(svgTexts[i].y, 3);
      // A stacked glyph is upright on the canvas exactly where the SVG carries no transform.
      const upright = Math.abs(d.rotate) < 1e-9;
      expect(upright, `#${i} rotate`).toBe(svgTexts[i].transform === undefined);
    });
    // Both shapes are actually present in this fixture, so the check means something.
    expect(placements.some((p) => p.stacked)).toBe(true);
    expect(placements.some((p) => p.rotated && !p.stacked)).toBe(true);
  });

  it('tracking is cancelled per glyph, matching the canvas', () => {
    const svg = cloudToSvg(placements, { ...svgOpts, tracking: 0.06 });
    expect(svg).toContain('letter-spacing="0.06em"');
    // Every glyph of a column carries the override; the rotated words do not need it.
    expect([...svg.matchAll(/letter-spacing="0"/g)]).toHaveLength(
      placements.filter((p) => p.stacked).reduce((n, p) => n + [...p.text].length, 0),
    );
  });
});

describe('cloudToSvg background and escaping', () => {
  const one: WordCount[] = [{ text: 'a', count: 1 }];
  const p = layoutCloud(one, layoutOpts, measure);

  it('a transparent background draws no <rect>', () => {
    const svg = cloudToSvg(p, { ...svgOpts, background: null });
    expect(svg).not.toContain('<rect');
  });

  it('a solid background draws one full-size <rect>, rounded by radius', () => {
    const svg = cloudToSvg(p, { ...svgOpts, background: '#102030', radius: 24 });
    expect(svg).toContain('<rect x="0" y="0" width="1600" height="900" rx="24" ry="24" fill="#102030"/>');
  });

  it('escapes XML metacharacters in the word text', () => {
    const tricky = [{ ...p[0], text: 'a&b<c>d"e', display: undefined }];
    const svg = cloudToSvg(tricky, svgOpts);
    expect(svg).toContain('a&amp;b&lt;c&gt;d&quot;e');
    expect(svg).not.toMatch(/<text[^>]*>[^<]*<c>/);
    expect(escapeXml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;');
  });

  it('the hidden watermark lands in a comment and in <metadata>, never in pixels', () => {
    const svg = cloudToSvg(p, { ...svgOpts, hiddenText: 'owner: A & B' });
    expect(svg).toContain('<metadata>owner: A &amp; B</metadata>');
    expect(svg).toMatch(/<!--\s*owner: A & B\s*-->/);
  });

  it('a visible watermark is one extra <text> outside the word group', () => {
    const svg = cloudToSvg(p, { ...svgOpts, watermark: 'card · 2026-09-04', watermarkPos: 'br' });
    expect(texts(svg)).toHaveLength(p.length + 1);
    expect(svg).toContain('text-anchor="end"');
  });
});

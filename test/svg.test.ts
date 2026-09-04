/**
 * Vector export. Hard rule 4 says layout and export agree: the SVG must place words at the
 * exact coordinates `layoutCloud` produced, the same ones the frozen canvas pose draws.
 */
import { describe, expect, it } from 'vitest';
import { layoutCloud, type Measure } from '../src/render/layout';
import { cloudToSvg, escapeXml } from '../src/render/svg';
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

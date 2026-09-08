/**
 * Layout and stacking tokens (plan A1/A2, 2026-09-08): the stylesheets, the canvas inset and the
 * font stack must all read the same numbers from 00-tokens-base.css.
 *
 *   - a `var(--x)` without a fallback must have `--x` defined somewhere (a typo used to resolve
 *     to nothing: 50-kind-groups read `--card`, `--fs-sm`, `--ink-2` and drew no box at all);
 *   - every z-index is a `var(--z-*)` step of the ladder, except the listed in-component ones;
 *   - the ladder is strictly increasing in the order it is declared;
 *   - the export page's own `--exp-*` literals (kept as px for export-layout.test.ts) equal the
 *     shared tokens they mirror; CloudCanvas's literal fallback equals the tokens too;
 *   - the UI font stack starts with the system Latin face, in fonts.ts and in the body fallback.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FONT_STACKS } from '../../src/theme/fonts';

const DIR = new URL('../../src/ui/styles/', import.meta.url);
const files = readdirSync(DIR).filter((f) => f.endsWith('.css') && f !== 'index.css').sort();
const css = Object.fromEntries(files.map((f) => [f, readFileSync(new URL(f, DIR), 'utf8')]));
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const all = Object.values(css).map(stripComments).join('\n');
const tokens = stripComments(css['00-tokens-base.css']);

/** Custom properties set from JavaScript at runtime (useSettings) rather than in a stylesheet. */
const runtime = new Set(
  [...readFileSync(new URL('../../src/ui/hooks/useSettings.ts', import.meta.url), 'utf8').matchAll(/'(--[\w-]+)'/g)].map((m) => m[1]),
);
const defined = new Set([...all.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));

/** z-index literals that are stacking inside one component, not part of the page ladder. */
const LOCAL_Z: Record<string, string[]> = {
  '01-hero.css': ['2'],          // .demo-catch: under the hint pill, over the canvas
  '38-export.css': ['1'],        // sticky title bar inside the phone export page
  '42-words-edit.css': ['2'],    // sticky search row inside the word table
  '40-kind-list.css': ['20'],    // re-file menu inside a panel
  '48-review.css': ['5'],        // re-file menu inside the review panel
};

const px = (src: string, name: string): number => {
  const m = new RegExp(`${name}:\\s*(-?[\\d.]+)px`).exec(src);
  expect(m, `${name} is missing`).toBeTruthy();
  return Number(m![1]);
};

describe('layout tokens', () => {
  it('every var() without a fallback names a defined custom property', () => {
    const missing: string[] = [];
    for (const [f, src] of Object.entries(css)) {
      for (const m of stripComments(src).matchAll(/var\((--[\w-]+)\s*\)/g)) {
        if (!defined.has(m[1]) && !runtime.has(m[1])) missing.push(`${f}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every z-index is a step of the --z-* ladder (in-component stacking listed by name)', () => {
    const bad: string[] = [];
    for (const [f, src] of Object.entries(css)) {
      for (const m of stripComments(src).matchAll(/z-index:\s*([^;]+);/g)) {
        const v = m[1].trim();
        if (/^var\(--z-[\w-]+\)$/.test(v)) continue;
        if ((LOCAL_Z[f] ?? []).includes(v)) continue;
        bad.push(`${f}: z-index: ${v}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('the ladder rises in declaration order', () => {
    const steps = [...tokens.matchAll(/(--z-[\w-]+):\s*(\d+)/g)].map((m) => [m[1], Number(m[2])] as const);
    expect(steps.length).toBeGreaterThanOrEqual(12);
    for (let i = 1; i < steps.length; i++) expect(steps[i][1], `${steps[i][0]} after ${steps[i - 1][0]}`).toBeGreaterThan(steps[i - 1][1]);
  });

  it('the export page literals and the canvas fallback equal the shared tokens', () => {
    const exp = stripComments(css['38-export.css']);
    expect(px(exp, '--exp-rail')).toBe(px(tokens, '--inset-left'));
    expect(px(exp, '--exp-inset')).toBe(px(tokens, '--edge'));
    expect(px(exp, '--exp-top')).toBe(px(tokens, '--inset-top'));
    expect(px(exp, '--exp-controls-w')).toBe(px(tokens, '--panel-w'));
    const canvas = readFileSync(new URL('../../src/ui/CloudCanvas.tsx', import.meta.url), 'utf8');
    const m = /DESKTOP_INSET = \{ top: (\d+), right: (\d+), bottom: (\d+), left: (\d+) \}/.exec(canvas);
    expect(m, 'DESKTOP_INSET literal').toBeTruthy();
    expect([Number(m![1]), Number(m![2]), Number(m![3]), Number(m![4])]).toEqual([
      px(tokens, '--cloud-top'), px(tokens, '--cloud-right'), px(tokens, '--cloud-bottom'), px(tokens, '--inset-left'),
    ]);
    // edge + rail + gap is what "clears the rail" means
    expect(px(tokens, '--inset-left')).toBe(px(tokens, '--edge') + px(tokens, '--rail-w') + px(tokens, '--rail-gap'));
  });
});

describe('UI font stack', () => {
  it('starts with the system Latin face, at runtime and in the stylesheet fallback', () => {
    expect(FONT_STACKS.sans.trim().startsWith('system-ui')).toBe(true);
    const bodyRules = [...all.matchAll(/body\s*\{[^}]*font-family:\s*([^;]+);/g)].map((m) => m[1]);
    expect(bodyRules.length).toBeGreaterThan(0);
    const last = bodyRules[bodyRules.length - 1];
    expect(last.replace(/^var\(--font-ui,\s*/, '').trim().startsWith('system-ui')).toBe(true);
  });
});

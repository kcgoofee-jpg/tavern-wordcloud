/**
 * Export preview containment.
 *
 * The point of the export view is that you can judge a 4868 × 2864 file from it, so the
 * picture has to be as large as the stage allows — and never one pixel larger, in either
 * axis. A previous attempt (c704da7c) sized the picture from the width alone and it painted
 * on top of the controls for every export taller than the stage; `npm run audit`'s layout
 * check only looks at left/right bounds, so nothing caught it.
 *
 * This file is the check that would have. It walks a grid of viewports × export ratios and
 * asserts, numerically, that the preview box fits inside the stage in BOTH axes, that it
 * actually fills one of them, and that it keeps the output's aspect ratio.
 *
 * To convince yourself it is real: change `previewBox` in src/ui/exportLayout.ts to
 *   `const w = Math.floor(availW); const h = Math.floor(w / r);`
 * (the max-width-only rule) and this file goes red on every portrait ratio.
 *
 * The second half guards the other half of the problem: the arithmetic here models the
 * stylesheet, so it reads `38-export.css` back and fails if the two sets of numbers drift.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EXPORT_LAYOUT, panelBox, previewBox, sheetBox, stageBox, stageContentBox,
} from '../../src/ui/exportLayout';
import { SIZE_PRESETS } from '../../src/ui/export';
import { PLATFORM_PRESETS } from '../../src/ui/exportPresets';

/** 360 (small phone) to 2560 (5K half-screen), plus both sides of every breakpoint. */
const WIDTHS = [
  360, 375, 390, 414, 480, 560, 600, 639, 640, 700, 720, 721, 768, 820, 899, 900,
  1024, 1180, 1280, 1440, 1600, 1920, 2200, 2560,
];
/** Short laptops and a rotated phone matter as much as the widths. */
const HEIGHTS = [640, 700, 800, 844, 900, 1080, 1200];

/**
 * Every ratio the panel can be asked to show: the on-screen canvas times 1–3× (which keeps its
 * ratio), all five general presets and all fifteen platform presets, plus the extremes a
 * hand-typed custom size can reach.
 */
const RATIOS: { name: string; r: number }[] = [
  { name: 'canvas 16:9', r: 16 / 9 },
  { name: 'canvas 2:1', r: 2 },
  ...SIZE_PRESETS.map((p) => ({ name: `preset ${p.id} ${p.w}×${p.h}`, r: p.w / p.h })),
  ...PLATFORM_PRESETS.map((p) => ({ name: `platform ${p.id} ${p.w}×${p.h}`, r: p.w / p.h })),
  { name: 'custom 8192×1', r: 8192 },
  { name: 'custom 1×8192', r: 1 / 8192 },
];

describe('the export preview is contained by its stage in both axes', () => {
  it('fits at every viewport in the grid, for every ratio the presets can produce', () => {
    const overflow: string[] = [];
    for (const vw of WIDTHS) {
      for (const vh of HEIGHTS) {
        const stage = stageContentBox(vw, vh);
        for (const { name, r } of RATIOS) {
          const box = previewBox(stage, r);
          if (box.w > stage.w || box.h > stage.h) {
            overflow.push(
              `${vw}×${vh} ${name}: preview ${box.w}×${box.h} in stage ${stage.w}×${stage.h}`,
            );
          }
        }
      }
    }
    expect(overflow).toEqual([]);
    // The grid is worth what it covers: 24 widths × 7 heights × 22 ratios.
    expect(WIDTHS.length * HEIGHTS.length * RATIOS.length).toBeGreaterThan(3000);
  });

  it('fills one axis exactly, so the picture is as large as the stage allows', () => {
    const slack: string[] = [];
    for (const vw of WIDTHS) {
      for (const vh of HEIGHTS) {
        const stage = stageContentBox(vw, vh);
        for (const { name, r } of RATIOS) {
          const box = previewBox(stage, r);
          // A 1:8192 export is a hairline: it is contained (asserted above) but "fills the
          // stage" stops meaning anything once one side rounds down to a pixel or two.
          if (box.w < 4 || box.h < 4) continue;
          const used = Math.max(box.w / stage.w, box.h / stage.h);
          // One pixel of floor on each side; anything looser means wasted room.
          if (used < 1 - 2 / Math.min(stage.w, stage.h)) {
            slack.push(`${vw}×${vh} ${name}: uses ${(used * 100).toFixed(1)}% of the stage`);
          }
        }
      }
    }
    expect(slack).toEqual([]);
  });

  it('keeps the output ratio, so the preview is not a stretched lie', () => {
    for (const vw of [390, 768, 1440, 2560]) {
      for (const { r } of RATIOS) {
        const box = previewBox(stageContentBox(vw, 900), r);
        // Only where both sides are big enough for flooring to be a rounding detail.
        if (box.w < 40 || box.h < 40) continue;
        expect(box.w / box.h).toBeGreaterThan(r * 0.97);
        expect(box.w / box.h).toBeLessThan(r * 1.03);
      }
    }
  });

  it('the picture is the subject: it takes most of the stage the panel has', () => {
    // Wide: the stage is everything left of the 340px controls column.
    const wide = stageBox(1440, 900);
    expect(wide.w).toBe(1440 - EXPORT_LAYOUT.wide.left - EXPORT_LAYOUT.wide.right - EXPORT_LAYOUT.controlsW);
    // A 1920×1080 export at 1440×900 gets roughly a thousand CSS pixels, not 232.
    expect(previewBox(stageContentBox(1440, 900), 16 / 9).w).toBeGreaterThan(900);
    // Phone: the stage still gets a third of the screen rather than a 60px strip.
    expect(stageBox(390, 844).h).toBeGreaterThan(844 * 0.3);
    expect(previewBox(stageContentBox(390, 844), 16 / 9).w).toBeGreaterThan(300);
  });

  it('degrades to a floor rather than to nothing on a very short viewport', () => {
    for (const vh of [320, 400, 500]) {
      for (const vw of [360, 1440]) {
        const stage = stageContentBox(vw, vh);
        expect(stage.h).toBeGreaterThan(0);
        const box = previewBox(stage, 1080 / 1920);
        expect(box.h).toBeLessThanOrEqual(stage.h);
        expect(box.w).toBeLessThanOrEqual(stage.w);
      }
    }
  });

  it('a bad ratio falls back instead of producing NaN', () => {
    const stage = { w: 600, h: 400 };
    for (const bad of [0, -1, NaN, Infinity]) {
      const box = previewBox(stage, bad);
      expect(Number.isFinite(box.w) && Number.isFinite(box.h)).toBe(true);
      expect(box.w).toBeLessThanOrEqual(stage.w);
      expect(box.h).toBeLessThanOrEqual(stage.h);
    }
  });
});

describe('the arithmetic and the stylesheet use the same numbers', () => {
  const css = readFileSync(new URL('../../src/ui/styles/38-export.css', import.meta.url), 'utf8');
  const px = (name: string): number => {
    const m = new RegExp(`--${name}:\\s*(-?[\\d.]+)px`).exec(css);
    expect(m, `--${name} is missing from 38-export.css`).toBeTruthy();
    return Number(m![1]);
  };

  it('the insets, the bar, the stage padding and the controls column all match', () => {
    expect(px('exp-rail')).toBe(EXPORT_LAYOUT.wide.left);
    expect(px('exp-inset')).toBe(EXPORT_LAYOUT.wide.right);
    expect(px('exp-inset')).toBe(EXPORT_LAYOUT.wide.bottom);
    expect(px('exp-top')).toBe(EXPORT_LAYOUT.wide.top);
    expect(px('exp-mid-inset')).toBe(EXPORT_LAYOUT.mid.left);
    expect(px('exp-mid-top')).toBe(EXPORT_LAYOUT.mid.top);
    expect(px('exp-bar-h')).toBe(EXPORT_LAYOUT.barH);
    expect(px('exp-stage-pad')).toBe(EXPORT_LAYOUT.stagePad);
    expect(px('exp-foot-h')).toBe(EXPORT_LAYOUT.footH);
    expect(px('exp-stage-min')).toBe(EXPORT_LAYOUT.stageMinH);
    expect(px('exp-controls-w')).toBe(EXPORT_LAYOUT.controlsW);
  });

  it('the stacked split and the side-by-side breakpoint match', () => {
    const rows = /\.export-panel\s*\{[^}]*grid-template-rows:\s*([^;]+);/.exec(css);
    expect(rows).toBeTruthy();
    const frs = [...rows![1].matchAll(/([\d.]+)fr/g)].map((m) => Number(m[1]));
    expect(frs).toEqual([EXPORT_LAYOUT.stageFr, EXPORT_LAYOUT.controlsFr]);
    expect(css).toContain(`@media (min-width: ${EXPORT_LAYOUT.sideBySideAt}px)`);
    // Below 640 the full-screen rule owns the box; at and above it, the two inset bands do.
    expect(css).toContain(`@media (min-width: ${EXPORT_LAYOUT.fullscreenBelow}px) and (max-width: 720px)`);
    expect(css).toContain('@media (min-width: 721px)');
  });

  it('the stage still clips, which is the backstop the layout audit can see', () => {
    const stage = /\.export-stage\s*\{([^}]*)\}/.exec(css);
    expect(stage).toBeTruthy();
    expect(stage![1]).toContain('overflow: hidden');
    expect(stage![1]).toContain('position: relative');
    const fit = /\.export-fit\s*\{([^}]*)\}/.exec(css);
    expect(fit![1]).toContain('position: absolute');
    expect(fit![1]).toContain('inset: var(--exp-stage-pad)');
    const canvas = /\.export-preview-canvas\s*\{([^}]*)\}/.exec(css);
    expect(canvas![1]).toContain('max-width: 100%');
    expect(canvas![1]).toContain('max-height: 100%');
  });
});

describe('the boxes the arithmetic is built from', () => {
  it('the sheet is the viewport below 640 and inset above it', () => {
    expect(sheetBox(390, 844)).toEqual({ w: 390, h: 844 });
    expect(sheetBox(700, 900)).toEqual({ w: 700 - 16, h: 900 - 128 });
    expect(sheetBox(1440, 900)).toEqual({ w: 1440 - 90, h: 900 - 86 });
  });

  it('the panel is the sheet minus its title bar', () => {
    expect(panelBox(1440, 900).h).toBe(sheetBox(1440, 900).h - EXPORT_LAYOUT.barH);
  });
});

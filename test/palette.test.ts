/** Palette invariants, recomputed independently of the generator. */
import { describe, expect, it } from 'vitest';
import { THEMES, THEME_SPECS, THEME_GROUPS, themeById, DEFAULT_CUSTOM } from '../src/theme/themes';
import { buildTheme, cvdMinDeltaE, cvdLevel, flipMode, simulateCvd, CVD_SAFE_DE } from '../src/theme/palette';
import { FONT_STACKS } from '../src/theme/fonts';
import { toScannerDark } from '../src/render/qr';

const s2lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] as const;
};
const relLum = (hex: string) => {
  const [r, g, b] = rgb(hex).map(s2lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
function oklab(hex: string) {
  const [r, g, b] = rgb(hex).map(s2lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return { L, hue: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

describe('theme palettes', () => {
  it('all themes present, light by default', () => {
    expect(THEMES.map((t) => t.id).sort()).toEqual(
      [
        'claude', 'colorful', 'minimal',
        'lab', 'journal-sci', 'journal-med', 'journal-eng', 'viridis', 'magma',
        'forest', 'ocean', 'glacier', 'snow', 'alpine',
        'sunset', 'aurora', 'warm', 'nsfw', 'neon',
        'sepia', 'wood',
        'realistic', 'hyper',
        'okabe-ito', 'tol-bright', 'tol-muted', 'high-contrast',
      ].sort(),
    );
    expect(THEMES.find((t) => t.id === 'realistic')!.mode).toBe('light');
  });

  it('every theme has a font stack without web fonts', () => {
    // Offline use: no url() or web font names in the stacks
    for (const t of THEMES) {
      expect(t.uiFont.length).toBeGreaterThan(10);
      expect(t.cloudFont.length).toBeGreaterThan(10);
      expect(t.uiFont).not.toMatch(/url\(|https?:/);
      expect(t.cloudFont).not.toMatch(/url\(|https?:/);
    }
  });

  it('the default is the system font', () => {
    // Fonts are a separate layer from themes
    for (const t of THEMES) {
      expect(t.cloudFont).toMatch(/PingFang|system-ui|sans-serif/);
    }
  });

  it('the Palatino fallback stack is available', () => {
    // Harding is Nature's commercial typeface; Palatino, serif is its documented fallback
    expect(FONT_STACKS.palatino).toMatch(/Palatino/);
    const t = themeById('lab', { font: { cloud: 'palatino', weight: '700', tracking: -0.02 } });
    expect(t.cloudFont).toMatch(/Palatino/);
    expect(t.fonts.cloudTracking).toBeLessThan(0);
    // Nature requires system fonts for interactive elements
    expect(t.uiFont).toMatch(/PingFang|system-ui/);
  });

  for (const t of THEMES) {
    describe(`${t.id} (${t.label})`, () => {
      // Cloud colors encode frequency, so sequential-palette criteria apply
      it('ramp lightness is monotonic', () => {
        const Ls = t.ramp.map((c) => oklab(c).L);
        const asc = Ls.every((v, i) => i === 0 || v > Ls[i - 1]);
        const desc = Ls.every((v, i) => i === 0 || v < Ls[i - 1]);
        expect(asc || desc).toBe(true);
      });

      it('adjacent steps differ in lightness by >= 0.06', () => {
        const Ls = t.ramp.map((c) => oklab(c).L);
        for (let i = 1; i < Ls.length; i++) {
          expect(Math.abs(Ls[i] - Ls[i - 1])).toBeGreaterThanOrEqual(0.06);
        }
      });

      it('the faintest step reads on the background (>= 2:1)', () => {
        const sorted = [...t.ramp].sort((a, b) => oklab(a).L - oklab(b).L);
        const faintest = t.mode === 'light' ? sorted[sorted.length - 1] : sorted[0];
        expect(contrast(faintest, t.surface)).toBeGreaterThanOrEqual(2);
      });

      it('single-hue ramp, not a rainbow', () => {
        // The colorful theme is exempt: multi-hue sequential (viridis-like) with strictly monotonic lightness
        const spec = THEME_SPECS.find((x) => x.id === t.id);
        if (spec?.hueShift) return;
        const hues = t.ramp.map((c) => oklab(c).hue);
        let spread = Math.max(...hues) - Math.min(...hues);
        if (spread > 180) spread = 360 - spread;
        expect(spread).toBeLessThanOrEqual(40);
      });

      it('text and accent contrast meet the targets', () => {
        expect(contrast(t.fg, t.surface)).toBeGreaterThanOrEqual(8);
        expect(contrast(t.fgDim, t.surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(t.accent, t.surface)).toBeGreaterThanOrEqual(3);
      });

      it('QR modules are dark on light with contrast >= 7:1', () => {
        // Inverted QR codes do not scan; direction is checked as well as contrast
        expect(relLum(t.qrLight)).toBeGreaterThan(relLum(t.qrDark));
        expect(contrast(t.qrDark, t.qrLight)).toBeGreaterThanOrEqual(7);
      });

      it('every ramp step is dark enough after QR clamping', () => {
        // QR module colors come from the ramp; the lightest step is the risky one
        for (const c of t.ramp) {
          expect(contrast(toScannerDark(c), t.qrLight)).toBeGreaterThanOrEqual(7);
        }
      });
    });
  }
});

describe('custom palettes', () => {
  // Custom palettes use the same generator; sweep the hue in both schemes
  const hues = Array.from({ length: 24 }, (_, i) => i * 15);
  for (const mode of ['light', 'dark'] as const) {
    it(`${mode}：色相扫一圈，每一档都达标`, () => {
      for (const hue of hues) {
        const t = themeById('custom', { custom: { hue, chroma: 0.12, spread: DEFAULT_CUSTOM.spread }, mode });
        const Ls = t.ramp.map((c) => oklab(c).L);
        const asc = Ls.every((v, i) => i === 0 || v > Ls[i - 1]);
        const desc = Ls.every((v, i) => i === 0 || v < Ls[i - 1]);
        expect(asc || desc, `hue ${hue} 明度不单调`).toBe(true);
        for (let i = 1; i < Ls.length; i++) {
          expect(Math.abs(Ls[i] - Ls[i - 1]), `hue ${hue} 第 ${i} 步太近`).toBeGreaterThanOrEqual(0.06);
        }
        expect(contrast(t.fg, t.surface), `hue ${hue} 正文对比度`).toBeGreaterThanOrEqual(7.5);
        expect(contrast(t.fgDim, t.surface), `hue ${hue} 次要文字对比度`).toBeGreaterThanOrEqual(4.4);
        expect(contrast(t.accent, t.surface), `hue ${hue} 强调色对比度`).toBeGreaterThanOrEqual(2.9);
        expect(relLum(t.qrLight)).toBeGreaterThan(relLum(t.qrDark));
        expect(contrast(t.qrDark, t.qrLight), `hue ${hue} 二维码对比度`).toBeGreaterThanOrEqual(7);
        for (const c of t.ramp) {
          expect(contrast(toScannerDark(c), t.qrLight), `hue ${hue} 色阶压暗后`).toBeGreaterThanOrEqual(7);
        }
      }
    });
  }
});

describe('palette groups', () => {
  it('every theme declares a group, and every group has members', () => {
    for (const spec of THEME_SPECS) {
      expect(spec.group, `${spec.id} 没有分组`).toBeDefined();
      expect(THEME_GROUPS).toContain(spec.group!);
    }
    // A group with no members would render an empty collapsible section
    for (const g of THEME_GROUPS) {
      expect(THEME_SPECS.filter((s) => s.group === g).length, `${g} 组是空的`).toBeGreaterThan(0);
    }
  });

  it('推荐 is exactly claude / 彩色 / 极简', () => {
    expect(THEME_SPECS.filter((s) => s.group === 'recommended').map((s) => s.id))
      .toEqual(['claude', 'colorful', 'minimal']);
  });

  it('the cvd grade matches a recomputed simulation', () => {
    // Never authored: it has to fall out of the ramp
    for (const t of THEMES) expect(t.cvd).toBe(cvdLevel(t.ramp));
  });

  it('the simulation leaves neutral greys alone', () => {
    // A wrong colour space (matrices applied to RGB instead of LMS) shifts greys and
    // would silently mark greyscale ramps unsafe
    for (const kind of ['protan', 'deutan', 'tritan'] as const) {
      for (const grey of ['#000000', '#808080', '#ffffff']) {
        const out = simulateCvd(grey, kind);
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(out.slice(i, i + 2), 16));
        expect(Math.max(r, g, b) - Math.min(r, g, b), `${kind} ${grey} -> ${out}`).toBeLessThanOrEqual(6);
      }
    }
  });

  it('每一套无障碍方案在两种明暗下都是 safe', () => {
    // The gate in tools/optimize/a11y.mjs asserts the same thing; this is the fast copy
    const specs = THEME_SPECS.filter((s) => s.group === 'accessible');
    expect(specs.length).toBeGreaterThanOrEqual(4);
    for (const spec of specs) {
      for (const mode of ['light', 'dark'] as const) {
        const t = buildTheme(flipMode(spec, mode));
        expect(cvdMinDeltaE(t.ramp), `${spec.id}/${mode}`).toBeGreaterThanOrEqual(CVD_SAFE_DE);
        expect(t.cvd, `${spec.id}/${mode}`).toBe('safe');
      }
    }
  });
});

/** Theme generator shared by the build script and the app; custom palettes use the same path. */

import { DEFAULT_FONTS, FONT_STACKS, resolveFontStack, type ThemeFonts } from './fonts';
import { zh } from '../core/zh';

export type ThemeMode = 'light' | 'dark';

export interface ThemeSpec {
  id: string;
  label: string;
  mode: ThemeMode;
  surface: string;
  /** Base hue of the ramp (OKLCH degrees) */
  hue: number;
  chroma: number;
  /** Lightness range */
  lo: number;
  hi: number;
  /** Hue shift across the ramp in degrees. 0 = single hue (sequential); the colorful theme shifts hue like viridis while keeping lightness monotonic. */
  hueShift?: number;
  group?: ThemeGroup;
  /** Font for this style; defaults to sans */
  fonts?: Partial<ThemeFonts>;
  /** One-line description shown in the palette panel */
  note?: string;
}

export interface Theme {
  id: string;
  label: string;
  mode: ThemeMode;
  surface: string;
  surface2: string;
  line: string;
  fg: string;
  fgDim: string;
  accent: string;
  qrDark: string;
  qrLight: string;
  /** Frequency ramp, low -> high */
  ramp: string[];
  fonts: ThemeFonts;
  /** CSS font-family string */
  uiFont: string;
  cloudFont: string;
  note?: string;
  /** Which section of the palette panel this belongs to */
  group: ThemeGroup;
  /** Colour-vision grade, derived from the ramp by `cvdLevel` */
  cvd: CvdLevel;
}

/**
 * Palette groups. `custom` is not a browsable group: it is the user's own hue.
 * Order here is the order shown in the panel.
 */
export type ThemeGroup =
  | 'recommended' | 'science' | 'nature' | 'modern' | 'vintage' | 'realistic' | 'accessible' | 'custom';

export const THEME_GROUPS: ThemeGroup[] = [
  'recommended', 'science', 'nature', 'modern', 'vintage', 'realistic', 'accessible',
];

/** Only `recommended` is open when the palette panel is first shown. */
export const DEFAULT_OPEN_GROUPS: ThemeGroup[] = ['recommended'];

/**
 * How well the ramp survives colour-vision deficiency.
 *   safe    every adjacent pair stays >= 10 OKLab dE under all three simulations
 *   partial every adjacent pair stays >= 6
 *   no      at least one pair collapses below 6
 * Never written by hand: `buildTheme` computes it from the ramp (see `cvdLevel`).
 */
export type CvdLevel = 'safe' | 'partial' | 'no';

/** The three simulations, in the order the settings tab lists them. */
export type CvdKind = 'protan' | 'deutan' | 'tritan';
export const CVD_KINDS: CvdKind[] = ['protan', 'deutan', 'tritan'];

/**
 * Which simulations a colour-vision setting has to survive.
 * Red-green covers protanopia and deuteranopia; blue-yellow is tritanopia.
 */
export type ColorVision = 'normal' | 'rg' | 'by';

/**
 * Brettel/Vienot dichromacy simulation.
 *
 * Linear sRGB -> LMS (Vienot 1999 / Hunt-Pointer-Estevez as tabulated by Vienot), the missing
 * cone's response rebuilt from the two that remain, then back to linear sRGB. The reduction has
 * to happen in LMS: applying these rows to RGB directly would move neutral greys, which is wrong.
 */
const RGB_TO_LMS = [
  [17.8824, 43.5161, 4.11935],
  [3.45565, 27.1554, 3.86714],
  [0.0299566, 0.184309, 1.46709],
];
const LMS_TO_RGB = [
  [0.080944, -0.130504, 0.116721],
  [-0.0102485, 0.0540194, -0.113615],
  [-0.000365294, -0.00412163, 0.693513],
];

/** Rows replaced in LMS space: the lost cone is a linear combination of the surviving two. */
const CVD_MATRIX: Record<CvdKind, number[][]> = {
  protan: [[0, 2.02344, -2.52581], [0, 1, 0], [0, 0, 1]],
  deutan: [[1, 0, 0], [0.494207, 0, 1.24827], [0, 0, 1]],
  tritan: [[1, 0, 0], [0, 1, 0], [-0.395913, 0.801109, 0]],
};

const apply = (m: number[][], v: number[]) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);

/** Simulate one kind of dichromacy on a hex colour and return the hex it is seen as. */
export function simulateCvd(hex: string, kind: CvdKind): string {
  const n = parseInt(hex.slice(1), 16);
  const lin = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map(s2lin);
  const out = apply(LMS_TO_RGB, apply(CVD_MATRIX[kind], apply(RGB_TO_LMS, lin)));
  return '#' + out.map((v) => Math.round(lin2s(v) * 255).toString(16).padStart(2, '0')).join('');
}

/** OKLab distance, scaled by 100 so the thresholds read like CIE dE numbers. */
export function deltaE(a: string, b: string): number {
  const x = hexToOklab(a), y = hexToOklab(b);
  return 100 * Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);
}

export const CVD_SAFE_DE = 10;
export const CVD_PARTIAL_DE = 6;

/** Smallest adjacent-step distance across all three simulations. */
export function cvdMinDeltaE(ramp: string[]): number {
  let min = Infinity;
  for (const kind of CVD_KINDS) {
    const sim = ramp.map((c) => simulateCvd(c, kind));
    for (let i = 1; i < sim.length; i++) min = Math.min(min, deltaE(sim[i - 1], sim[i]));
  }
  return min;
}

/** Grade a ramp. Computed, never authored. */
export function cvdLevel(ramp: string[]): CvdLevel {
  const d = cvdMinDeltaE(ramp);
  if (d >= CVD_SAFE_DE) return 'safe';
  if (d >= CVD_PARTIAL_DE) return 'partial';
  return 'no';
}

/** Whether a palette is usable under a colour-vision setting. */
export function cvdAllows(vision: ColorVision, level: CvdLevel): boolean {
  return vision === 'normal' || level === 'safe';
}

const s2lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lin2s = (c: number) => {
  const x = Math.max(0, Math.min(1, c));
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
};

export function oklchToRgb(L: number, C: number, Hdeg: number): [number, number, number] {
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
     4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

const inGamut = (rgb: number[]) => rgb.every((c) => c >= -0.001 && c <= 1.001);

/** Reduce chroma stepwise until the color is inside sRGB; hue and lightness unchanged. */
export function oklchToHex(L: number, C: number, H: number): string {
  let c = C;
  let rgb = oklchToRgb(L, c, H);
  while (!inGamut(rgb) && c > 0) { c -= 0.002; rgb = oklchToRgb(L, c, H); }
  return '#' + rgb.map((v) => Math.round(lin2s(v) * 255).toString(16).padStart(2, '0')).join('');
}

export function hexToOklab(hex: string): { L: number; a: number; b: number } {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, bl] = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map(s2lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl);
  return {
    L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  };
}

export function relLum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map(s2lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const RAMP_STEPS = 6;

/** Frequency ramp: dark to light in dark mode, light to dark in light mode. */
export function buildRamp(spec: ThemeSpec, steps = RAMP_STEPS): string[] {
  const shift = spec.hueShift ?? 0;
  const out: string[] = [];
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const L = spec.mode === 'dark' ? spec.lo + (spec.hi - spec.lo) * t : spec.hi - (spec.hi - spec.lo) * t;
    out.push(oklchToHex(L, spec.chroma, spec.hue + shift * t));
  }
  return out;
}

/** UI text / stroke / accent derived from the same hue, pushed until contrast targets are met. */
export function buildTheme(spec: ThemeSpec): Theme {
  const dark = spec.mode === 'dark';
  const seek = (fromL: number, toL: number, chroma: number, need: number) => {
    const dir = toL > fromL ? 0.01 : -0.01;
    let best = oklchToHex(toL, chroma, spec.hue);
    for (let L = fromL; dir > 0 ? L <= toL : L >= toL; L += dir) {
      const hex = oklchToHex(L, chroma, spec.hue);
      if (contrast(hex, spec.surface) >= need) return hex;
      best = hex;
    }
    return best;
  };

  const fg = seek(dark ? 0.95 : 0.2, dark ? 0.5 : 0.75, 0.012, 8);
  const fgDim = seek(dark ? 0.8 : 0.35, dark ? 0.4 : 0.8, 0.016, 4.5);
  const line = seek(dark ? 0.2 : 0.92, dark ? 0.6 : 0.4, 0.014, 1.35);
  const accent = seek(0.62, dark ? 0.92 : 0.3, spec.chroma + 0.03, 3);
  const surface2 = oklchToHex(dark ? 0.095 : 0.94, 0.01, spec.hue);

  const fonts: ThemeFonts = { ...DEFAULT_FONTS, ...spec.fonts };
  const ramp = buildRamp(spec);

  return {
    id: spec.id,
    label: spec.label,
    mode: spec.mode,
    fonts,
    uiFont: FONT_STACKS[fonts.ui],
    cloudFont: resolveFontStack(fonts.cloud),
    note: spec.note,
    group: spec.group ?? 'modern',
    surface: spec.surface,
    surface2,
    line,
    fg,
    fgDim,
    accent,
    // QR modules are always dark on white; inverted codes do not scan. The theme only affects hue.
    qrLight: '#ffffff',
    qrDark: oklchToHex(0.32, Math.min(0.09, spec.chroma), spec.hue),
    ramp,
    cvd: cvdLevel(ramp),
  };
}

/** Flip a theme to the other color scheme; background and lightness range are re-derived from the hue. */
export function flipMode(spec: ThemeSpec, mode: ThemeMode): ThemeSpec {
  if (spec.mode === mode) return spec;
  const span = Math.min(0.60, Math.max(0.34, spec.hi - spec.lo));
  return {
    ...spec,
    mode,
    surface: mode === 'dark'
      ? oklchToHex(0.155, Math.min(0.014, spec.chroma), spec.hue)
      : oklchToHex(0.955, Math.min(0.012, spec.chroma), spec.hue),
    // Keep the spec's lightness span: it is what carries the frequency signal, and for the
    // accessible palettes it is also what keeps them readable under dichromacy.
    lo: mode === 'dark' ? Math.max(0.32, 0.92 - span) : Math.max(0.16, 0.74 - span),
    hi: mode === 'dark' ? 0.92 : Math.min(0.74, 0.16 + span),
  };
}

/** Custom palette: the user gives hue and scheme, everything else is derived. */
export function customSpec(hue: number, mode: ThemeMode, chroma = 0.13, spread = 0.44): ThemeSpec {
  // The span expands around the midpoint so overall lightness stays put; both ends are clamped for legibility.
  const mid = mode === 'dark' ? 0.68 : 0.51;
  const half = Math.max(0.15, Math.min(0.3, spread / 2));
  return {
    id: 'custom',
    label: zh('自定义'),
    mode,
    hue,
    chroma,
    surface: mode === 'dark' ? oklchToHex(0.16, 0.012, hue) : oklchToHex(0.965, 0.008, hue),
    lo: Math.max(0.24, mid - half),
    hi: Math.min(0.9, mid + half),
  };
}

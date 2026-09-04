import {
  buildTheme, customSpec, flipMode, THEME_GROUPS,
  type ColorVision, type CvdLevel, type Theme, type ThemeGroup, type ThemeMode, type ThemeSpec,
} from './palette';
import { zh } from '../core/zh';
import type { FontKey } from './fonts';

export type { ColorVision, CvdLevel, Theme, ThemeGroup, ThemeMode, ThemeSpec };
export { THEME_GROUPS };

/**
 * Themes are specifications (hue / chroma / lightness range / background / font);
 * concrete colors are derived by palette.ts. Custom palettes use the same path.
 *
 * Checked by test/palette.test.ts: monotonic ramp lightness, step dL >= 0.06,
 * faintest step >= 2:1 on the background, body >= 8:1, secondary >= 4.5:1,
 * accent >= 3:1, QR >= 7:1 dark on light.
 *
 * Fonts are a separate layer (fontChoice). System fonts only.
 */
export const THEME_SPECS: ThemeSpec[] = [
  // ── 推荐 ──
  {
    id: 'claude', label: 'Claude', group: 'recommended', mode: 'light',
    surface: '#f4f2ec', hue: 46, chroma: 0.105, lo: 0.30, hi: 0.72,
    note: zh('暖米底 + 陶土色，词云用衬线体'),
  },
  // Colorful is a deliberate exception: hue shifts with lightness (viridis-like) while lightness stays monotonic.
  {
    id: 'colorful', label: zh('彩色'), group: 'recommended', mode: 'light',
    surface: '#f7f5f2', hue: 95, chroma: 0.130, lo: 0.28, hi: 0.70, hueShift: 185,
    note: zh('色相随词频推移，明度仍然单调'),
  },
  { id: 'minimal', label: zh('极简'), group: 'recommended', mode: 'light', surface: '#f5f5f3', hue: 95, chroma: 0.012, lo: 0.20, hi: 0.70,
    note: zh('近乎黑白') },

  // ── 科研 ──
  // Journal-style palettes: the hues are the public colour values these journals' figures are
  // known for, used as a look only. No journal name is used as a brand or endorsement.
  {
    id: 'lab', label: zh('自然期刊风'), group: 'science', mode: 'light', surface: '#f1f3f6', hue: 250, chroma: 0.110, lo: 0.30, hi: 0.72,
    // Follows Nature's typography: Palatino serif fallback for body/headings, system fonts for controls, negative letter spacing on headings.
    note: zh('按 Nature 排版规范：衬线正文、负字距，交互元素用系统字体'),
  },
  { id: 'journal-sci', label: zh('科学期刊风'), group: 'science', mode: 'light', surface: '#f4f2ef', hue: 30, chroma: 0.095, lo: 0.28, hi: 0.74,
    note: zh('砖红单色阶，图表底色偏暖') },
  { id: 'journal-med', label: zh('医学期刊风'), group: 'science', mode: 'light', surface: '#f2f4f2', hue: 155, chroma: 0.090, lo: 0.28, hi: 0.74,
    note: zh('墨绿单色阶，正文衬线') },
  { id: 'journal-eng', label: zh('工程期刊风'), group: 'science', mode: 'light', surface: '#f3f4f6', hue: 225, chroma: 0.085, lo: 0.26, hi: 0.74,
    note: zh('钢蓝单色阶，克制的强调色') },
  { id: 'viridis', label: 'viridis', group: 'science', mode: 'dark', surface: '#0b0f14', hue: 275, chroma: 0.120, lo: 0.44, hi: 0.90, hueShift: -160,
    note: zh('matplotlib 的顺序色阶：紫到黄，明度单调') },
  { id: 'magma', label: 'magma', group: 'science', mode: 'dark', surface: '#0a0810', hue: 305, chroma: 0.120, lo: 0.44, hi: 0.90, hueShift: -230,
    note: zh('matplotlib 的顺序色阶：紫到橙白') },

  // ── 自然 ──
  { id: 'forest', label: zh('森林'), group: 'nature', mode: 'dark', surface: '#0b1109', hue: 140, chroma: 0.110, lo: 0.42, hi: 0.88,
    note: zh('林下深绿到嫩芽') },
  { id: 'ocean', label: zh('大海'), group: 'nature', mode: 'dark', surface: '#050d14', hue: 235, chroma: 0.115, lo: 0.42, hi: 0.88,
    note: zh('深海蓝到浪花') },
  { id: 'glacier', label: zh('冰川'), group: 'nature', mode: 'light', surface: '#eef4f7', hue: 210, chroma: 0.075, lo: 0.26, hi: 0.74,
    note: zh('冰蓝，低彩度') },
  { id: 'snow', label: zh('雪地'), group: 'nature', mode: 'light', surface: '#f6f7f9', hue: 250, chroma: 0.030, lo: 0.18, hi: 0.72,
    note: zh('近白底，只留一点冷灰') },
  { id: 'alpine', label: zh('高山'), group: 'nature', mode: 'light', surface: '#f0eeea', hue: 100, chroma: 0.055, lo: 0.24, hi: 0.72,
    note: zh('岩灰与苔绿') },

  // ── 现代 ──
  {
    id: 'sunset', label: zh('晚霞'), group: 'modern', mode: 'light',
    surface: '#f8f3ee', hue: 25, chroma: 0.150, lo: 0.30, hi: 0.72, hueShift: 70,
    note: zh('橙红到紫，明度单调'),
  },
  {
    id: 'aurora', label: zh('极光'), group: 'modern', mode: 'dark',
    surface: '#070b12', hue: 160, chroma: 0.140, lo: 0.50, hi: 0.90, hueShift: 120,
    note: zh('深底上青绿到紫'),
  },
  { id: 'warm', label: zh('暖色'), group: 'modern', mode: 'dark', surface: '#17120d', hue: 68, chroma: 0.130, lo: 0.46, hi: 0.88,
    note: zh('深底暖光') },
  { id: 'nsfw', label: zh('深红'), group: 'modern', mode: 'dark', surface: '#120a0d', hue: 12, chroma: 0.140, lo: 0.44, hi: 0.84,
    note: zh('近黑底 + 玫瑰红，词云用楷体') },
  { id: 'neon', label: zh('酷炫'), group: 'modern', mode: 'dark', surface: '#05070e', hue: 205, chroma: 0.150, lo: 0.50, hi: 0.90,
    note: zh('霓虹青') },

  // ── 复古 ──
  { id: 'sepia', label: zh('旧纸'), group: 'vintage', mode: 'light', surface: '#f2ebdd', hue: 70, chroma: 0.065, lo: 0.26, hi: 0.72,
    note: zh('泛黄纸面，褪色墨迹') },
  { id: 'wood', label: zh('原木'), group: 'vintage', mode: 'light', surface: '#efe6d8', hue: 50, chroma: 0.085, lo: 0.26, hi: 0.72,
    note: zh('木纹褐，暖而不艳') },

  // ── 写实 ──
  { id: 'realistic', label: zh('写实'), group: 'realistic', mode: 'light', surface: '#ece5da', hue: 58, chroma: 0.070, lo: 0.26, hi: 0.72,
    note: zh('纸与褐') },
  { id: 'hyper', label: zh('超写实'), group: 'realistic', mode: 'light', surface: '#eeeae4', hue: 58, chroma: 0.060, lo: 0.10, hi: 0.72,
    note: zh('拉满明暗跨度，高低频对比更强') },

  // ── 无障碍 ──
  // Wide lightness spans on purpose: under dichromacy only lightness survives, and every
  // adjacent step here clears dE 10 in all three simulations (checked by tools/optimize/a11y.mjs).
  { id: 'okabe-ito', label: 'Okabe-Ito', group: 'accessible', mode: 'light', surface: '#f6f4f0', hue: 200, chroma: 0.070, lo: 0.08, hi: 0.72,
    note: zh('色盲安全配色的经典取值，蓝橙轴') },
  { id: 'tol-bright', label: 'Tol bright', group: 'accessible', mode: 'light', surface: '#f5f6f7', hue: 260, chroma: 0.080, lo: 0.08, hi: 0.72,
    note: zh('Paul Tol 的明亮组，明度跨度拉满') },
  { id: 'tol-muted', label: 'Tol muted', group: 'accessible', mode: 'light', surface: '#f4f4f2', hue: 150, chroma: 0.070, lo: 0.08, hi: 0.72,
    note: zh('Paul Tol 的柔和组，低彩度') },
  { id: 'high-contrast', label: zh('高对比'), group: 'accessible', mode: 'light', surface: '#ffffff', hue: 250, chroma: 0.010, lo: 0.06, hi: 0.72,
    note: zh('黑白为主，只留一个强调色') },
];

export const THEMES: Theme[] = THEME_SPECS.map(buildTheme);

/** Light by default. */
export const DEFAULT_THEME_ID = 'realistic';

export const GROUP_LABEL: Record<ThemeGroup, string> = {
  recommended: zh('推荐'),
  science: zh('科研'),
  nature: zh('自然'),
  modern: zh('现代'),
  vintage: zh('复古'),
  realistic: zh('写实'),
  accessible: zh('无障碍'),
  custom: zh('自定义'),
};

/** Specs of one group, in declaration order. */
export function specsInGroup(group: ThemeGroup): ThemeSpec[] {
  return THEME_SPECS.filter((s) => (s.group ?? 'modern') === group);
}

export interface CustomThemeSetting {
  hue: number;
  chroma: number;
  /** Lightness span of the ramp; larger = stronger contrast between frequent and rare words */
  spread: number;
}

export const DEFAULT_CUSTOM: CustomThemeSetting = { hue: 320, chroma: 0.12, spread: 0.44 };

/** Scheme: follow system / force light / force dark. */
export type ModePref = 'auto' | 'light' | 'dark';
export const DEFAULT_MODE: ModePref = 'auto';

export interface FontChoice {
  /** Cloud font. Either a built-in FontKey, or (when `custom` is true) an imported font's family name. */
  cloud: FontKey | (string & {});
  weight: string;
  /** Letter spacing, em */
  tracking: number;
  /** True when `cloud` names a user-imported font rather than a built-in FontKey. */
  custom?: boolean;
}

/** Default is the system sans. */
export const DEFAULT_FONT_CHOICE: FontChoice = { cloud: 'sans', weight: '600', tracking: 0 };

export function resolveMode(pref: ModePref): ThemeMode {
  if (pref !== 'auto') return pref;
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export interface ThemeRequest {
  custom?: CustomThemeSetting;
  mode?: ModePref;
  font?: FontChoice;
}

export function themeById(id: string, opts: ThemeRequest = {}): Theme {
  const mode = resolveMode(opts.mode ?? DEFAULT_MODE);
  const f = opts.font ?? DEFAULT_FONT_CHOICE;
  const fonts = { ui: 'sans' as FontKey, cloud: f.cloud, cloudWeight: f.weight, cloudTracking: f.tracking };

  if (id === 'custom') {
    const c = opts.custom ?? DEFAULT_CUSTOM;
    return buildTheme({ ...customSpec(c.hue, mode, c.chroma, c.spread), group: 'custom', fonts });
  }
  const spec = THEME_SPECS.find((t) => t.id === id) ?? THEME_SPECS.find((t) => t.id === DEFAULT_THEME_ID)!;
  return buildTheme({ ...flipMode(spec, mode), fonts });
}

/** Preview swatches in the palette panel, rendered for the current scheme. */
export function previewTheme(spec: ThemeSpec, mode: ThemeMode): Theme {
  return buildTheme(flipMode(spec, mode));
}

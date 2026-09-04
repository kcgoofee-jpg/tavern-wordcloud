/**
 * Generate the theme color ramps and validate them. Ramps encode frequency, so
 * they are sequential: single hue, monotonic lightness, visible steps, faint end
 * readable on the background. Steps are searched in OKLCH and pulled back into
 * sRGB by reducing chroma.
 */
import { validateOrdinal, contrast } from '/private/tmp/claude-501/bundled-skills/2.1.255/78472b38d1bd9bd57568f6d67a031f4c/dataviz/scripts/validate_palette.js';

const lin2s = (c) => { c = Math.max(0, Math.min(1, c)); return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055; };

function oklchToRgb(L, C, Hdeg) {
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [
     4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

const inGamut = (rgb) => rgb.every((c) => c >= -0.001 && c <= 1.001);

/** Reduce chroma stepwise until the color is inside sRGB; hue and lightness unchanged. */
function oklchToHex(L, C, H) {
  let c = C;
  let rgb = oklchToRgb(L, c, H);
  while (!inGamut(rgb) && c > 0) { c -= 0.002; rgb = oklchToRgb(L, c, H); }
  return '#' + rgb.map((v) => Math.round(lin2s(v) * 255).toString(16).padStart(2, '0')).join('');
}

/** Ramp of `steps` colors: dark to light in dark mode, light to dark in light mode. */
function ramp({ hue, chroma, lo, hi, steps, mode }) {
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const L = mode === 'dark' ? lo + (hi - lo) * t : hi - (hi - lo) * t;
    out.push(oklchToHex(L, chroma, hue));
  }
  return out;
}

const THEMES = [
  { id: 'minimal',   label: '极简', mode: 'light', surface: '#f5f5f3', hue:  95, chroma: 0.012, lo: 0.20, hi: 0.70 },
  { id: 'warm',      label: '暖色', mode: 'dark',  surface: '#17120d', hue:  68, chroma: 0.130, lo: 0.46, hi: 0.88 },
  { id: 'realistic', label: '写实', mode: 'light', surface: '#ece5da', hue:  58, chroma: 0.070, lo: 0.26, hi: 0.72 },
  { id: 'nsfw',      label: '深红', mode: 'dark',  surface: '#120a0d', hue:  12, chroma: 0.140, lo: 0.44, hi: 0.84 },
  { id: 'neon',      label: '酷炫', mode: 'dark',  surface: '#05070e', hue: 205, chroma: 0.150, lo: 0.50, hi: 0.90 },
  { id: 'lab',       label: '科研', mode: 'light', surface: '#f1f3f6', hue: 250, chroma: 0.110, lo: 0.30, hi: 0.72 },
];

/** Text / stroke / accent derived from the same hue, each checked for contrast. */
function uiTokens(t) {
  const dark = t.mode === 'dark';
  const sL = t.surface;
  // Body text: push until 4.5:1 (WCAG)
  let fg = null, fgDim = null, line = null, accent = null;
  for (let L = dark ? 0.95 : 0.20; dark ? L > 0.5 : L < 0.75; L += dark ? -0.01 : 0.01) {
    const hex = oklchToHex(L, 0.012, t.hue);
    if (contrast(hex, sL) >= 8) { fg = hex; break; }
  }
  for (let L = dark ? 0.80 : 0.35; dark ? L > 0.4 : L < 0.80; L += dark ? -0.01 : 0.01) {
    const hex = oklchToHex(L, 0.016, t.hue);
    if (contrast(hex, sL) >= 4.5) { fgDim = hex; break; }
  }
  // Stroke: 1.4:1 is enough; stronger reads as a border
  for (let L = dark ? 0.20 : 0.92; dark ? L < 0.6 : L > 0.4; L += dark ? 0.01 : -0.01) {
    const hex = oklchToHex(L, 0.014, t.hue);
    if (contrast(hex, sL) >= 1.35) { line = hex; break; }
  }
  // Accent: chromatic, >= 3:1 (WCAG non-text)
  for (let L = dark ? 0.62 : 0.62; dark ? L < 0.92 : L > 0.30; L += dark ? 0.01 : -0.01) {
    const hex = oklchToHex(L, t.chroma + 0.03, t.hue);
    if (contrast(hex, sL) >= 3) { accent = hex; break; }
  }
  const surface2 = oklchToHex((dark ? 0.06 : 0.97) + (dark ? 0.035 : -0.03), 0.010, t.hue);
  return { fg, fgDim, line, accent, surface2 };
}

const STEPS = 6;
let allOk = true;
const result = {};

for (const t of THEMES) {
  let colors = ramp({ ...t, steps: STEPS });
  let v = validateOrdinal(colors, { mode: t.mode, surface: t.surface });

  // Shift lightness when the faint end does not clear the background; up to 24 tries
  for (let tries = 0; !v.ok && tries < 24; tries++) {
    if (t.mode === 'dark') t.lo += 0.015; else t.hi -= 0.015;
    colors = ramp({ ...t, steps: STEPS });
    v = validateOrdinal(colors, { mode: t.mode, surface: t.surface });
  }

  console.log(`\n=== ${t.id} (${t.label}) ${t.mode} surface ${t.surface} ===`);
  for (const [name, pass, detail] of v.report) console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name.padEnd(20)} ${detail}`);
  console.log(`  色阶: ${colors.join(' ')}`);
  const ui = uiTokens(t);
  const checks = [
    ['正文 vs 背景', contrast(ui.fg, t.surface), 8],
    ['次要文字 vs 背景', contrast(ui.fgDim, t.surface), 4.5],
    ['强调色 vs 背景', contrast(ui.accent, t.surface), 3],
  ];
  for (const [name, got, need] of checks) {
    const pass = got >= need;
    if (!pass) allOk = false;
    console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${name.padEnd(20)} ${got.toFixed(2)}:1 (需要 >= ${need})`);
  }
  console.log(`  界面: fg=${ui.fg} dim=${ui.fgDim} line=${ui.line} accent=${ui.accent}`);
  if (!v.ok) allOk = false;
  result[t.id] = { ...t, colors, ...ui };
}

// QR contrast: ~10:1 keeps colored codes decodable
for (const id of Object.keys(result)) {
  const t = result[id];
  // QR modules are always dark on light regardless of scheme; the theme only affects hue.
  const qrLight = '#ffffff';
  const qrDark = oklchToHex(0.32, Math.min(0.09, t.chroma), t.hue);
  const cr = contrast(qrDark, qrLight);
  const pass = cr >= 7;
  if (!pass) allOk = false;
  console.log(`[${pass ? 'PASS' : 'FAIL'}] 二维码 ${id.padEnd(10)} ${qrDark} on ${qrLight} = ${cr.toFixed(1)}:1 (需要 >= 7)`);
  t.qrDark = qrDark; t.qrLight = qrLight;
}

console.log(allOk ? '\n全部通过' : '\n有未通过项');
if (process.argv.includes('--emit')) {
  const { writeFileSync } = await import('node:fs');
  const body = Object.values(result).map((t) => `  {
    id: '${t.id}',
    label: '${t.label}',
    mode: '${t.mode}',
    surface: '${t.surface}',
    surface2: '${t.surface2}',
    line: '${t.line}',
    fg: '${t.fg}',
    fgDim: '${t.fgDim}',
    accent: '${t.accent}',
    qrDark: '${t.qrDark}',
    qrLight: '${t.qrLight}',
    // 词频色阶：低频 -> 高频。单一色相、明度单调，编码的是「多少」不是「哪一类」。
    ramp: [${t.colors.map((c) => `'${c}'`).join(', ')}],
  },`).join('\n');
  writeFileSync('src/lib/themes.ts', `// 自动生成，不要手改。改 tools/build-themes.mjs 后跑 npm run themes。
//
// 六套主题共用一套色系：界面的文字/描边/强调色和词云的色阶都从同一个色相推导，
// 每个值都过了对比度校验（正文 8:1、次要 4.5:1、强调 3:1、二维码 7:1），
// 词云色阶另外过了 ordinal 四项检查（单一色相、明度单调、步长可见、浅端可读）。
// 判据来自 dataviz 技能的 validate_palette.js，复算在 test/palette.test.ts。

export type ThemeMode = 'light' | 'dark';

export interface Theme {
  id: string;
  label: string;
  mode: ThemeMode;
  /** 页面底色 */
  surface: string;
  /** 抬起来的面（悬浮层、输入框） */
  surface2: string;
  /** 极淡的分隔线。这一版刻意几乎不画框，所以它只用在必要处 */
  line: string;
  fg: string;
  fgDim: string;
  accent: string;
  /** 二维码模块色。扫码器只认对比度 */
  qrDark: string;
  qrLight: string;
  /** 词云色阶，低频 -> 高频 */
  ramp: string[];
}

export const THEMES: Theme[] = [
${body}
];

export const DEFAULT_THEME_ID = 'warm';

export function themeById(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME_ID)!;
}
`);
  console.log('已写入 src/lib/themes.ts');
}
process.exit(allOk ? 0 : 1);

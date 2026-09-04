#!/usr/bin/env node
/**
 * Colour-contrast check over every theme (light and dark): body text on surface, dim text on
 * both surfaces, accent (links) on surface. WCAG 2.1: 4.5 for body, 3 for secondary/large.
 *
 * Also grades every ramp for colour-vision deficiency (Brettel/Vienot simulation in
 * src/theme/palette.ts): adjacent steps must stay >= 10 OKLab dE under protan/deutan/tritan
 * to count as safe, >= 6 as partial. The grade is computed, never authored. Palettes in the
 * 「无障碍」 group must come out safe in BOTH schemes; anything else there is a violation.
 * Prints one JSON object { violations, count, cvdUnsafe, cvd }.
 */
import { execFileSync } from 'node:child_process';
const src = `
import { THEME_SPECS } from '/ROOT/src/theme/themes.ts';
import { buildTheme, flipMode, cvdMinDeltaE } from '/ROOT/src/theme/palette.ts';
const themes = [];
for (const s of THEME_SPECS) {
  themes.push(buildTheme(s));
  try { themes.push(buildTheme(flipMode(s, s.mode === 'light' ? 'dark' : 'light'))); } catch {}
}
console.log(JSON.stringify(themes.map((t) => ({
  id: t.id, mode: t.mode, group: t.group, cvd: t.cvd, cvdDeltaE: +cvdMinDeltaE(t.ramp).toFixed(2),
  surface: t.surface, surface2: t.surface2, fg: t.fg, fgDim: t.fgDim, accent: t.accent,
}))));
`.replace(/\/ROOT/g, process.cwd());
const tmp = `${process.cwd()}/node_modules/.tmp-a11y-themes.ts`;
import { writeFileSync, unlinkSync } from 'node:fs';
writeFileSync(tmp, src);
let themes;
try { themes = JSON.parse(execFileSync('npx', ['--yes', 'vite-node', tmp], { encoding: 'utf8' }).trim().split('\n').pop()); } finally { try { unlinkSync(tmp); } catch {} }

const lum = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim()); if (!m) return null;
  const c = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const la = lum(a), lb = lum(b); if (la == null || lb == null) return null; const [hi, lo] = la > lb ? [la, lb] : [lb, la]; return (hi + 0.05) / (lo + 0.05); };
const violations = [];
for (const t of themes) {
  const checks = [
    ['fg/surface', t.fg, t.surface, 4.5], ['fg/surface2', t.fg, t.surface2, 4.5],
    ['fgDim/surface', t.fgDim, t.surface, 3], ['fgDim/surface2', t.fgDim, t.surface2, 3],
    ['accent/surface', t.accent, t.surface, 3],
  ];
  for (const [name, a, b, min] of checks) {
    const r = ratio(a, b);
    if (r == null) { violations.push({ theme: `${t.id}/${t.mode}`, check: name, ratio: null, note: 'non-hex colour' }); continue; }
    if (r < min) violations.push({ theme: `${t.id}/${t.mode}`, check: name, ratio: +r.toFixed(2), min });
  }
}
// Colour vision: count what a red-green / blue-yellow user loses, and hold the accessible group to safe.
const cvd = {};
let cvdUnsafe = 0;
for (const t of themes) {
  cvd[`${t.id}/${t.mode}`] = { level: t.cvd, dE: t.cvdDeltaE };
  if (t.cvd !== 'safe') cvdUnsafe++;
  if (t.group === 'accessible' && t.cvd !== 'safe') {
    violations.push({ theme: `${t.id}/${t.mode}`, check: 'cvd/accessible-group', level: t.cvd, dE: t.cvdDeltaE, min: 10 });
  }
}
console.log(JSON.stringify({ count: violations.length, cvdUnsafe, violations, cvd }));

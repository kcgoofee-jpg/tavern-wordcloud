/**
 * Builds `public/og.png`, the 1200x630 link preview card (og:image / twitter:image).
 *
 *   npm run og:card
 *
 * The card is a real word cloud produced by the project's own code, not a drawing:
 * the palette comes from `src/theme` (`buildTheme` on one of the shipped `THEME_SPECS`),
 * the positions come from `layoutCloud` in `src/render/layout.ts`, and vertical CJK words
 * are stacked with the same `stackedLines` the canvas and the SVG export use. Changing a
 * theme therefore changes the card, and the card can never drift into a look the app
 * cannot produce.
 *
 * Text measurement and rasterisation go through `tools/og-card.swift` (CoreText, macOS
 * only) — see the header there for why. The output is committed, so this script runs only
 * when someone wants a new card; nothing in the build, the tests, the CI or the deploy
 * calls it.
 *
 * The word list below is invented product vocabulary. No chat log, character card or world
 * info has ever been near this file, and none may be added to it.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { buildTheme } from '../src/theme/palette';
import { THEME_SPECS } from '../src/theme/themes';
import { canStack, hashSeed, layoutCloud, stackedLines, type Measure } from '../src/render/layout';
import type { WordCount } from '../src/core/types';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'public', 'og.png');
const SWIFT = path.join(ROOT, 'tools', 'og-card.swift');

/** Open Graph's recommended size; X renders `summary_large_image` at this 1.91:1 ratio. */
const WIDTH = 1200;
const HEIGHT = 630;

/** Dark card: it sits well in both a light and a dark timeline, and matches `theme-color`. */
const THEME_ID = 'warm';

/**
 * What the tool is about, in both languages, with invented weights. `main` sorts by
 * weight before laying out — `layoutCloud` places in array order and never rotates the
 * first three, so the order has to be the frequency order or the card would put a minor
 * term in the middle.
 */
const WORDS: [string, number][] = [
  ['酒馆词云', 100], ['SillyTavern', 82], ['WordCloud', 74], ['聊天记录', 66],
  ['中文分词', 62], ['词频', 58], ['角色卡', 55], ['tokenize', 54], ['关键词', 52],
  ['offline', 50], ['世界书', 48], ['privacy', 47], ['离线', 46], ['隐私', 45],
  ['export', 44], ['浏览器', 43], ['导出', 42], ['chat log', 41], ['新词发现', 40],
  ['人名', 39], ['地点', 38], ['时间', 37], ['词类', 36], ['character card', 36],
  ['停用词', 35], ['清洗', 34], ['思维链', 33], ['world info', 33], ['状态栏', 32],
  ['群聊', 31], ['主题', 30], ['frequency', 30], ['PNG', 30], ['配色', 29],
  ['二维码', 28], ['SVG', 28], ['本地版', 27], ['entities', 27], ['单文件', 26],
  ['CSV', 26], ['词频表', 25], ['筛选', 24], ['open source', 24], ['zip', 24],
  ['同指', 23], ['别名', 22], ['jsonl', 22], ['无需词典', 21],
];

interface Sized { w: number; h: number }

/**
 * CoreText widths through `og-card.swift`. Measured once per string at `PROBE`, then
 * scaled: a CTLine's advance is linear in point size (no hinting at this path), so one
 * probe covers every font size the layout asks for. Verified below.
 */
const PROBE = 100;

function swift(mode: 'measure' | 'draw', payload: unknown): string {
  const r = spawnSync('swift', [SWIFT, mode], { input: JSON.stringify(payload), encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.error) throw new Error(`swift not runnable (${r.error.message}). This card can only be regenerated on macOS with the Xcode command line tools.`);
  if (r.status !== 0) throw new Error(`og-card.swift ${mode} failed:\n${r.stderr}`);
  return r.stdout;
}

/** CSS font-family string -> the family names, unquoted, generics dropped. */
function familyNames(stack: string): string[] {
  return stack
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter((s) => s && !/^(sans-serif|serif|monospace|cursive|fantasy|system-ui|ui-\w+|-apple-system)$/.test(s));
}

function main(): void {
  const spec = THEME_SPECS.find((t) => t.id === THEME_ID);
  if (!spec) throw new Error(`no theme ${THEME_ID}`);
  const theme = buildTheme(spec);
  const family = familyNames(theme.cloudFont);
  const bold = true;

  // Every string the layout can ask about: whole words, plus each glyph of a word that
  // could end up as a vertical CJK column.
  const texts = new Set<string>();
  for (const [text] of WORDS) {
    texts.add(text);
    if (canStack(text)) for (const ch of text) texts.add(ch);
  }
  const measured = JSON.parse(swift('measure', { family, bold, size: PROBE, texts: [...texts] })) as Record<string, Sized>;

  // The linearity the single probe relies on, checked rather than assumed.
  const probe = [...texts][0];
  const half = JSON.parse(swift('measure', { family, bold, size: PROBE / 2, texts: [probe] })) as Record<string, Sized>;
  const ratio = half[probe].w / (measured[probe].w / 2);
  if (!(ratio > 0.99 && ratio < 1.01)) throw new Error(`CoreText width is not linear in font size (ratio ${ratio}); measure per size instead`);

  const measure: Measure = (text, fontSize) => {
    const m = measured[text];
    if (!m) throw new Error(`unmeasured string ${JSON.stringify(text)}`);
    const k = fontSize / PROBE;
    return { w: m.w * k, h: m.h * k };
  };

  const words: WordCount[] = [...WORDS].sort((a, b) => b[1] - a[1]).map(([text, count]) => ({ text, count }));
  // The bottom band carries the title and the URL, so the cloud is kept out of it.
  const inset = { top: 40, right: 48, bottom: 168, left: 48 };
  const placements = layoutCloud(words, {
    width: WIDTH,
    height: HEIGHT,
    maxFontSize: 62,
    minFontSize: 15,
    rotateRatio: 0.16,
    steps: theme.ramp.length,
    padding: 7,
    idleAmplitude: 0,
    seed: hashSeed('tavern-wordcloud/og'),
    fontFamily: theme.cloudFont,
    fontWeight: '600',
    inset,
  }, measure);

  const items: Record<string, unknown>[] = [];
  for (const p of placements) {
    const color = theme.ramp[Math.max(0, Math.min(theme.ramp.length - 1, p.step))];
    if (p.stacked) {
      for (const l of stackedLines(p.text, p.fontSize)) {
        items.push({ text: l.ch, x: p.x, y: p.y + l.dy, size: p.fontSize, color, bold });
      }
      continue;
    }
    // `rotate: 90` in CoreGraphics (y up) is the same quarter turn the SVG export writes
    // as rotate(-90) and the canvas renderer draws: the word reads bottom to top.
    items.push({ text: p.text, x: p.x, y: p.y, size: p.fontSize, color, bold, rotate: p.rotated ? 90 : 0 });
  }

  // Title band: name and URL on one baseline, the bilingual one-liner under them.
  const bandY = HEIGHT - inset.bottom + 88;
  const ink = theme.ramp[theme.ramp.length - 1];
  items.push({ text: '酒馆词云 · Tavern WordCloud', x: inset.left, y: bandY, size: 44, color: ink, bold, align: 'left', baseline: 'alphabetic' });
  items.push({ text: 'wordcloud.davidzhao.top', x: WIDTH - inset.right, y: bandY, size: 26, color: theme.accent, bold, align: 'right', baseline: 'alphabetic' });
  items.push({ text: '把 SillyTavern 聊天记录变成词云 · turn SillyTavern chat logs into a word cloud', x: inset.left, y: bandY + 42, size: 24, color: theme.fgDim, align: 'left', baseline: 'alphabetic' });

  mkdirSync(path.dirname(OUT), { recursive: true });
  swift('draw', { width: WIDTH, height: HEIGHT, background: theme.surface, family, out: OUT, items });
  console.log(`og.png  ${WIDTH}x${HEIGHT}  theme=${THEME_ID}  words=${placements.length}/${WORDS.length}  -> ${path.relative(ROOT, OUT)}`);
}

main();

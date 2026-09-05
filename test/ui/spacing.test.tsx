// @vitest-environment happy-dom
/**
 * One vertical rhythm for panel contents.
 *
 * Three screenshots of three different panels showed the same defect: a segmented control
 * flush against the row under it (详细/简洁 over the kind chips, 尺寸 over 常用尺寸,
 * 格式 over 尺寸). The fix is a shared scale (--sp-1…--sp-4 in 00-tokens-base.css) applied
 * by the rhythm block at the top of 05-controls.css, not a margin per panel — so this file
 * checks the rhythm where it is used, and forbids panels from nudging it again.
 *
 * happy-dom has no layout engine, so the assertions read computed margins and collapse
 * adjacent siblings the way the box model does (the larger of the two wins); they do not
 * measure pixels on screen.
 */
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ExportPanel, FilterPanel, FontPanel, ThemePanel } from '../../src/ui/panels';
import ImportPanel, { type ImportSummary } from '../../src/ui/ImportPanel';
import CardInfo from '../../src/ui/CardInfo';
import type { ChatMeta, CharacterGroup } from '../../src/core/meta';
import { DEFAULT_ANALYZE_OPTIONS } from '../../src/core/analyze';
import { DEFAULT_SETTINGS } from '../../src/ui/settings';
import { setCurrentLang } from '../../src/ui/i18n';

// Palette and kind labels are dynamic values (tx) read from the module-level language.
setCurrentLang('zh');

afterEach(cleanup);

const STYLES = path.join(process.cwd(), 'src/ui/styles');

/** The cascade exactly as index.css builds it: one file per area, import order = cascade order. */
function stylesheet(): string {
  const index = fs.readFileSync(path.join(STYLES, 'index.css'), 'utf8');
  const files = [...index.matchAll(/@import\s+'\.\/([^']+)'/g)].map((m) => m[1]);
  expect(files.length).toBeGreaterThan(20);
  return files.map((f) => fs.readFileSync(path.join(STYLES, f), 'utf8')).join('\n');
}

let SP: Record<'sp1' | 'sp2' | 'sp3' | 'sp4', number>;

beforeAll(() => {
  const style = document.createElement('style');
  style.textContent = stylesheet();
  document.head.append(style);
  const root = getComputedStyle(document.documentElement);
  const tok = (n: number) => {
    const v = root.getPropertyValue(`--sp-${n}`).trim();
    expect(v, `--sp-${n} must be defined on :root`).toMatch(/^\d+px$/);
    return parseFloat(v);
  };
  SP = { sp1: tok(1), sp2: tok(2), sp3: tok(3), sp4: tok(4) };
});

const px = (v: string) => parseFloat(v) || 0;

/** Adjacent block siblings collapse their margins: the gap is the larger of the two. */
function gapAfter(el: Element): number {
  const below = px(getComputedStyle(el).marginBottom);
  const next = el.nextElementSibling;
  return next ? Math.max(below, px(getComputedStyle(next).marginTop)) : below;
}

/* ---------- the panels that contain a segmented control ---------- */

const meta: ChatMeta = {
  character: '排练厅的下午', startedAt: null, endedAt: null, worldInfo: null, authorNote: null,
  models: [], apis: [], messages: 20, userMessages: 10, charMessages: 10,
  swipeRate: 0, avgGenSeconds: null, rawChars: 900, cleanChars: 800, lastInContextMessageId: null,
};
const group = (character: string): CharacterGroup => ({ character, files: [`${character}.jsonl`], meta: { ...meta, character } });
const summary: ImportSummary = {
  fileCount: 1, chars: 1000, uploadBytes: 3000, characters: ['排练厅的下午'], bundle: null, fromZip: false,
};

/** Every panel with a `.seg`, and the file it lives in — `covers every panel` keeps this honest. */
const PANELS: { name: string; file: string; node: () => React.ReactElement }[] = [
  {
    name: 'FilterPanel',
    file: 'src/ui/panels/FilterPanel.tsx',
    node: () => (
      <FilterPanel options={DEFAULT_ANALYZE_OPTIONS} setOptions={vi.fn()} kindOverrides={{}}
        setKindOverrides={vi.fn()} rotateRatio={0} setRotateRatio={vi.fn()} result={null}
        kindView="fine" setKindView={vi.fn()} />
    ),
  },
  {
    name: 'ExportPanel',
    file: 'src/ui/panels/ExportPanel.tsx',
    node: () => (
      <ExportPanel opts={{ ...DEFAULT_SETTINGS.exportOpts, watermark: true }} setOpts={vi.fn()}
        size={{ w: 1000, h: 500 }} all={1176} onPng={vi.fn()} onCsv={vi.fn()} onJson={vi.fn()} onCopy={vi.fn()} />
    ),
  },
  {
    name: 'ThemePanel',
    file: 'src/ui/panels/ThemePanel.tsx',
    node: () => <ThemePanel settings={DEFAULT_SETTINGS} patch={vi.fn()} />,
  },
  {
    name: 'FontPanel',
    file: 'src/ui/panels/FontPanel.tsx',
    node: () => (
      <FontPanel font={DEFAULT_SETTINGS.font} setFont={vi.fn()} traditional={false} setTraditional={vi.fn()} />
    ),
  },
  {
    name: 'ImportPanel',
    file: 'src/ui/ImportPanel.tsx',
    node: () => (
      <ImportPanel summary={summary} options={DEFAULT_ANALYZE_OPTIONS} setOptions={vi.fn()} busy={false}
        progress={null} onStart={vi.fn()} onCancel={vi.fn()} onConfigureAi={vi.fn()}
        contribute={false} hasServer={false} />
    ),
  },
  {
    name: 'CardInfo',
    file: 'src/ui/CardInfo.tsx',
    node: () => (
      <CardInfo meta={meta} bundle={null} groups={[group('排练厅的下午'), group('雨夜的车站')]}
        perSource={[]} accent="#8c6344" onlyCharacter={null} setOnlyCharacter={vi.fn()}
        open setOpen={vi.fn()} />
    ),
  },
];

describe('vertical rhythm: a segmented control is never flush against the next row', () => {
  it.each(PANELS)('$name keeps --sp-3 under every segmented control', ({ node }) => {
    const { container } = render(node());
    const segs = [...container.querySelectorAll('.seg')];
    expect(segs.length, 'the panel is expected to render a segmented control').toBeGreaterThan(0);
    for (const seg of segs) {
      const label = seg.getAttribute('aria-label') ?? seg.textContent?.slice(0, 20) ?? '?';
      // The gap belongs to the control, not to whatever happens to follow it.
      expect(px(getComputedStyle(seg).marginBottom), `.seg (${label}) margin-bottom`).toBe(SP.sp3);
      // …and nothing after it may eat that gap.
      expect(gapAfter(seg), `gap under .seg (${label})`).toBeGreaterThanOrEqual(SP.sp3);
    }
  });

  /** The three panels the user photographed, named one by one so a regression says which. */
  it('详细/简洁 is --sp-3 clear of the kind chips', () => {
    const { container } = render(PANELS[0].node());
    const seg = [...container.querySelectorAll('.seg')]
      .find((s) => s.textContent?.includes('详细') && s.textContent.includes('简洁'));
    expect(seg, 'the 详细/简洁 switch').toBeTruthy();
    expect(seg!.nextElementSibling?.className).toMatch(/kind-groups|kinds/);
    expect(gapAfter(seg!)).toBe(SP.sp3);
  });

  it('尺寸 is --sp-3 clear of 常用尺寸, and 格式 gets a full --sp-4 section break before 尺寸', () => {
    const { container } = render(PANELS[1].node());
    const seg = (label: string) => container.querySelector(`.seg[aria-label="${label}"]`)!;
    expect(seg('尺寸')).toBeTruthy();
    // Desktop width in happy-dom, so the presets are the dropdown, which sets no margin of its own.
    expect(seg('尺寸').nextElementSibling?.className).toContain('export-preset');
    expect(gapAfter(seg('尺寸'))).toBe(SP.sp3);
    // 格式 is followed by the next section heading; --sp-4 collapses over the control's --sp-3.
    expect(seg('格式').nextElementSibling?.className).toContain('group-label');
    expect(gapAfter(seg('格式'))).toBe(SP.sp4);
    expect(SP.sp4).toBeGreaterThan(SP.sp3);
  });

  it('a section heading owns the section break above it and --sp-2 under it', () => {
    const { container } = render(PANELS[1].node());
    const heading = container.querySelector('.group-label')!;
    expect(px(getComputedStyle(heading).marginBottom)).toBe(SP.sp2);
    // Only the first heading in a panel hugs the top edge.
    const later = [...container.querySelectorAll('.group-label')].filter((h) => h !== heading);
    expect(later.length).toBeGreaterThan(0);
    for (const h of later) expect(px(getComputedStyle(h).marginTop)).toBe(SP.sp4);
  });
});

/* ---------- the rhythm has one home ---------- */

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
/** Innermost `selector { body }` pairs; @media / @keyframes wrappers never match themselves. */
const rules = (css: string) => [...stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => ({ selector: m[1].trim(), body: m[2] }));

/** Vertical margin values a declaration block sets, shorthand expanded to top / bottom. */
function verticalMargins(body: string): string[] {
  const out: string[] = [];
  for (const decl of body.split(';')) {
    const [rawProp, ...rest] = decl.split(':');
    const prop = rawProp.trim();
    const value = rest.join(':').trim();
    if (!value) continue;
    if (prop === 'margin-top' || prop === 'margin-bottom') out.push(value);
    else if (prop === 'margin-block') out.push(...value.split(/\s+/));
    else if (prop === 'margin') {
      // 1 value: all sides; 2–3: top and bottom are the 1st and 3rd (or the 1st twice); 4: 1st and 3rd.
      const parts = value.split(/(?<!,)\s+(?![^(]*\))/).filter(Boolean);
      out.push(parts[0], parts.length >= 3 ? parts[2] : parts[0]);
    }
  }
  return out.filter(Boolean);
}

describe('no panel stylesheet nudges a segmented control', () => {
  const files = fs.readdirSync(STYLES).filter((f) => f.endsWith('.css'));

  it('only 05-controls.css gives a .seg a vertical margin, and it is the token', () => {
    const offenders: string[] = [];
    let canonical = 0;
    for (const file of files) {
      for (const { selector, body } of rules(fs.readFileSync(path.join(STYLES, file), 'utf8'))) {
        if (!/(^|[\s,>+~])\.seg\b/.test(selector)) continue;
        const vertical = verticalMargins(body);
        if (!vertical.length) continue;
        if (file === '05-controls.css' && selector === '.seg' && vertical.join(' ') === '0 var(--sp-3)') {
          canonical += 1;
          continue;
        }
        // A .seg laid out in a row (the landing header) may opt out with a zero, nothing else.
        if (vertical.every((v) => v === '0' || v === '0px')) continue;
        offenders.push(`${file}: ${selector} { ${body.trim()} }`);
      }
    }
    expect(offenders, 'panel stylesheets must take their spacing from the rhythm').toEqual([]);
    expect(canonical, 'the one shared rule must exist').toBe(1);
  });

  it('the scale is a scale: four rising steps, defined once', () => {
    const tokens = fs.readFileSync(path.join(STYLES, '00-tokens-base.css'), 'utf8');
    for (const n of [1, 2, 3, 4]) {
      expect(tokens.match(new RegExp(`--sp-${n}:`, 'g')), `--sp-${n}`).toHaveLength(1);
    }
    expect([SP.sp1, SP.sp2, SP.sp3, SP.sp4]).toEqual([...new Set([SP.sp1, SP.sp2, SP.sp3, SP.sp4])].sort((a, b) => a - b));
  });

  /** A new panel with a switch must be added to PANELS above, not left unchecked. */
  it('covers every panel that renders a segmented control', () => {
    const src = path.join(process.cwd(), 'src/ui');
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (
      e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]
    ));
    const withSeg = walk(src)
      .filter((f) => f.endsWith('.tsx') && /className=(["'`])seg[\s"'`]/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(process.cwd(), f));
    // Landing's switch sits in a centred flex row, not a column: it opts out in 34-landing.css.
    expect(new Set(withSeg)).toEqual(new Set([...PANELS.map((p) => p.file), 'src/ui/Landing.tsx']));
  });
});

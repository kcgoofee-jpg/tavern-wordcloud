// @vitest-environment happy-dom
/**
 * Every box the user types into is one shape.
 *
 * The real stylesheet (styles/index.css, in its own import order) is loaded into the
 * document, every panel that carries an input is rendered under it, and each control is
 * then measured through getComputedStyle. Two things are asserted:
 *
 *   1. At rest, every input / textarea / select resolves to the SAME border-radius,
 *      border-width and background source, and to a height from the shared rhythm.
 *   2. On focus, the radius does not move. happy-dom's getComputedStyle ignores
 *      pseudo-class rules, so the focus state is computed from the CSSOM instead:
 *      every rule whose selector matches the element once its :focus / :focus-visible
 *      pseudo is stripped is a rule that applies while the box has focus. A focus rule
 *      may set colour and outline; anything that changes the geometry (radius, border
 *      width, padding, height, box-sizing) reflows the box and is a failure.
 *
 * This is the regression that prompted the file: 50-focus.css used to add
 * `border-radius: inherit` to its :focus-visible ring. `:where(…)` is specificity 0 but
 * `:focus-visible` adds (0,1,0), which ties with `.ai-url { border-radius: var(--ctl-r) }`
 * and wins on order — so clicking the endpoint panel's address box collapsed its corners
 * to the parent's 0 while the key box below it stayed rounded.
 */
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ANALYZE_OPTIONS } from '../../src/core/analyze';
import { DEFAULT_AI_CONFIG } from '../../src/core/aiTokenizer';
import { DEFAULT_SETTINGS } from '../../src/ui/settings';
import type { WordCount } from '../../src/core/types';
import {
  AdvancedPanel, AiPanel, CommunityPanel, ExportPanel, FilterPanel, FontPanel,
  PriorityPanel, ReviewPanel, ThemePanel, WordsPanel, type CommunityStats,
} from '../../src/ui/panels';

/* ------------------------------------------------------------------ the stylesheet */

/** index.css is a list of @imports and the import order is the cascade order. */
function appCss(): string {
  const dir = path.join(process.cwd(), 'src/ui/styles');
  const index = fs.readFileSync(path.join(dir, 'index.css'), 'utf8');
  const files = [...index.matchAll(/@import\s+'\.\/([^']+)'/g)].map((m) => m[1]);
  expect(files.length).toBeGreaterThan(40); // the parse actually found the imports
  return files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
}

let sheet: CSSStyleSheet;
beforeAll(() => {
  const style = document.createElement('style');
  style.id = 'app-css';
  style.textContent = appCss();
  document.head.appendChild(style);
  sheet = style.sheet!;
  expect(sheet.cssRules.length).toBeGreaterThan(100);
});
afterAll(() => { document.getElementById('app-css')?.remove(); });
afterEach(cleanup);

/* ------------------------------------------------------- the panels carrying inputs */

const WORDS: WordCount[] = [{ text: '西德妮', count: 12 }, { text: '咖啡馆', count: 5 }];

const STATS: CommunityStats = {
  contributors: 7, contributions: 12, messages: 900, chars: 123456,
  views30d: 300, analyses30d: 40, minContributors: 3,
  words: [{ text: '西德妮', count: 9, people: 4 }],
  trend: [{ day: '2026-08-01', contributions: 0, analyses: 0, views: 10 }],
  hours: Array.from({ length: 24 }, () => 1),
  sizes: [{ label: '<1万', n: 2 }],
  zhRatio: 0.8, models: [], endpoints: [], kinds: [], genMs: null, updated: 0,
};

const noop = () => {};

/**
 * Every panel with a typing surface, in one tree: the endpoint panel (address / key /
 * model), the filter and advanced panels (checkboxes, sliders, stop-word and wrong-word
 * boxes), the word table (search box), priority words, export (numbers, colour, selects,
 * name template), theme (colour), fonts (ranges) and review (search).
 */
function Panels() {
  return (
    <div className="app">
      <div className="sheet"><div className="sheet-body">
        <AiPanel ai={DEFAULT_AI_CONFIG} setAi={noop} canRun={false} busy={false} onRun={noop} relay={false} />
      </div></div>
      <div className="sheet"><div className="sheet-body">
        <FilterPanel options={DEFAULT_ANALYZE_OPTIONS} setOptions={noop} kindOverrides={{}}
          setKindOverrides={noop} rotateRatio={0} setRotateRatio={noop} result={null} />
      </div></div>
      <div className="sheet"><div className="sheet-body">
        <AdvancedPanel options={DEFAULT_ANALYZE_OPTIONS} setOptions={noop} />
      </div></div>
      <div className="sheet"><div className="sheet-body">
        <WordsPanel words={WORDS} options={DEFAULT_ANALYZE_OPTIONS} setOptions={noop}
          onHover={noop} hovered={null} overrides={{}} setOverrides={noop} />
      </div></div>
      <div className="sheet"><div className="sheet-body">
        <PriorityPanel value="" setValue={noop} />
      </div></div>
      <div className="sheet"><div className="sheet-body">
        <ExportPanel
          opts={{ ...DEFAULT_SETTINGS.exportOpts, sizeMode: 'custom', bg: 'custom', watermark: true }}
          setOpts={noop} size={{ w: 1000, h: 500 }}
          all={100} onPng={noop} onCsv={noop} onJson={noop} onCopy={noop} />
      </div></div>
      <div className="sheet"><div className="sheet-body">
        <ThemePanel settings={DEFAULT_SETTINGS} patch={noop} />
      </div></div>
      <div className="sheet"><div className="sheet-body">
        <FontPanel font={DEFAULT_SETTINGS.font} setFont={noop} traditional={false} setTraditional={noop} />
      </div></div>
      <div className="sheet"><div className="sheet-body">
        <ReviewPanel words={WORDS} overrides={{}} setOverrides={noop} extraStopwords={[]} setExtraStopwords={noop} />
      </div></div>
      <div className="community-page">
        <CommunityPanel stats={STATS} contribute={false} setContribute={noop} loading={false} offline={false} />
      </div>
    </div>
  );
}

/** Renders everything, then opens the two surfaces that only exist after a click. */
async function renderAll() {
  const user = userEvent.setup();
  const view = render(<Panels />);
  // The claim form (three inputs) is behind its own toggle.
  await user.click(screen.getByRole('button', { name: '认领我的角色卡' }));
  // The word table's in-place rename editor only exists while a row is being renamed.
  await user.click(screen.getAllByTitle(/在云上显示的字/)[0]);
  return view.container;
}

/* ----------------------------------------------------------------- the measurements */

/** What the app owns the corner of. Checkbox / radio / file keep the native widget. */
const PAINTED = 'input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select';
/** …of those, the ones the app also draws a frame and a fill for. A range is a track and
 *  a thumb, both browser-drawn pseudo-elements, so it takes the radius and nothing else. */
const FRAMED = `${PAINTED}`.split(', ').map((s) => `${s}:not([type=range])`).join(', ');
/** Everything the user can put a cursor in, native widgets included. */
const EVERY = 'input, textarea, select';

const named = (el: Element) =>
  `${el.tagName.toLowerCase()}[type=${el.getAttribute('type') ?? '-'}]` +
  `${el.className ? '.' + String(el.className).split(' ').join('.') : ''}` +
  `${el.getAttribute('aria-label') ? ` (${el.getAttribute('aria-label')})` : ''}`;

/** Split a selector list on top-level commas: `:is(a, b) c, d` -> [':is(a, b) c', 'd']. */
function selectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) { out.push(list.slice(start, i)); start = i + 1; }
  }
  out.push(list.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

const FOCUS_PSEUDO = /:focus-visible|:focus-within|:focus/g;

/** Every style rule in the sheet, media rules flattened (the query is evaluated by happy-dom). */
function styleRules(): CSSStyleRule[] {
  const out: CSSStyleRule[] = [];
  const walk = (rules: CSSRuleList) => {
    for (const r of Array.from(rules)) {
      if ('selectorText' in r) out.push(r as CSSStyleRule);
      else if ('cssRules' in r && 'media' in r) walk((r as CSSMediaRule).cssRules);
    }
  };
  walk(sheet.cssRules);
  return out;
}

const hasFocus = (sel: string) => { FOCUS_PSEUDO.lastIndex = 0; const r = FOCUS_PSEUDO.test(sel); FOCUS_PSEUDO.lastIndex = 0; return r; };

/**
 * Rules that apply to `el`, in sheet order (so the last one naming a property wins among
 * equals). `state: 'focus'` keeps only the rules whose selector carries a focus pseudo and
 * matches once that pseudo is stripped — i.e. what comes into force when the box is
 * focused. Pseudo-*element* rules (::-webkit-slider-thumb and friends) style a part the
 * browser draws, not the box, and are skipped.
 */
function matchingRules(el: Element, state: 'rest' | 'focus'): { selector: string; style: CSSStyleDeclaration }[] {
  const out: { selector: string; style: CSSStyleDeclaration }[] = [];
  for (const rule of styleRules()) {
    for (const sel of selectors(rule.selectorText)) {
      if (sel.includes('::')) continue;
      if (hasFocus(sel) !== (state === 'focus')) continue;
      const base = state === 'focus' ? sel.replace(FOCUS_PSEUDO, '').trim() : sel;
      if (!base) continue;
      let hit = false;
      try { hit = el.matches(base); } catch { hit = false; }
      if (hit) { out.push({ selector: sel, style: rule.style }); break; }
    }
  }
  return out;
}

const focusDeclarations = (el: Element) => matchingRules(el, 'focus');

/** The border-radius the box has while focused, resolved the way a browser would. */
function focusRadius(el: Element): string {
  const rest = getComputedStyle(el).borderRadius;
  let declared: string | null = null;
  for (const { style } of focusDeclarations(el)) {
    const v = style.getPropertyValue('border-radius') || style.getPropertyValue('border-top-left-radius');
    if (v) declared = v.trim();
  }
  if (declared === null) return rest;
  if (declared === 'inherit') {
    return el.parentElement ? getComputedStyle(el.parentElement).borderRadius : '0px';
  }
  if (declared.startsWith('var(')) {
    const name = declared.slice(4, declared.indexOf(')')).split(',')[0].trim();
    return getComputedStyle(el).getPropertyValue(name).trim() || declared;
  }
  return declared;
}

describe('input surfaces', () => {
  it('the panels between them carry every kind of typing surface', async () => {
    const c = await renderAll();
    const types = new Set(
      [...c.querySelectorAll(EVERY)].map((el) => (el.tagName === 'INPUT' ? el.getAttribute('type') ?? 'text' : el.tagName.toLowerCase())),
    );
    for (const kind of ['text', 'url', 'password', 'number', 'color', 'range', 'checkbox', 'search', 'textarea', 'select']) {
      expect([...types], kind).toContain(kind);
    }
    // More than one panel's worth, and the claim form / rename editor opened.
    expect(c.querySelectorAll(PAINTED).length).toBeGreaterThan(15);
    expect(c.querySelector('.ai-url')).not.toBeNull();
    expect(c.querySelector('.claim-field input')).not.toBeNull();
    expect(c.querySelector('.word-edit')).not.toBeNull();
    expect(c.querySelector('.priority-input')).not.toBeNull();
    expect(c.querySelector('.search')).not.toBeNull();
  });

  it('every input, textarea and select resolves to the same border-radius', async () => {
    const c = await renderAll();
    const radius = getComputedStyle(document.documentElement).getPropertyValue('--ctl-r').trim();
    expect(radius).toBe('9px');
    const seen = new Map<string, string[]>();
    for (const el of c.querySelectorAll(PAINTED)) {
      const r = getComputedStyle(el).borderRadius;
      seen.set(r, [...(seen.get(r) ?? []), named(el)]);
    }
    expect(seen.size, JSON.stringify([...seen], null, 1)).toBe(1);
    expect([...seen.keys()]).toEqual([radius]);
  });

  it('and to the same border width and the same fill token', async () => {
    const c = await renderAll();
    const width = getComputedStyle(document.documentElement).getPropertyValue('--ctl-bw').trim();
    expect(width).toBe('1px');
    for (const el of c.querySelectorAll(FRAMED)) {
      expect(getComputedStyle(el).borderTopWidth, named(el)).toBe(width);
      // The fill comes from one token, never a hard-coded colour. happy-dom drops
      // color-mix() from a computed background, so the check is on the declarations that
      // reach the element rather than on the resolved colour.
      for (const state of ['rest', 'focus'] as const) {
        for (const { selector, style } of matchingRules(el, state)) {
          for (const prop of ['background', 'background-color']) {
            const v = style.getPropertyValue(prop).trim();
            if (v) expect(v, `${selector} on ${named(el)}`).toMatch(/^var\(--ctl-bg(-hover)?\)$/);
          }
        }
      }
    }
  });

  it('their heights come from the shared rhythm, and only the in-row editor steps down', async () => {
    const c = await renderAll();
    const full = getComputedStyle(document.documentElement).getPropertyValue('--ctl-h').trim();
    const row = getComputedStyle(document.documentElement).getPropertyValue('--ctl-h-row').trim();
    expect([full, row]).toEqual(['32px', '26px']);
    for (const el of c.querySelectorAll(PAINTED)) {
      // Colour and range are painted by the browser; they sit in a slider row, not a field row.
      if (el.matches("input[type='color'], input[type='range']")) continue;
      const want = el.classList.contains('word-edit') ? row : full;
      expect(getComputedStyle(el).minHeight, named(el)).toBe(want);
    }
    // min-height alone would let a box outgrow the buttons beside it: `font: inherit`
    // hands it the body's 21.7px leading, which with the padding and border comes to
    // ~34px. The shared rule pins the leading to what makes the box exactly --ctl-h.
    const shared = fs.readFileSync(path.join(process.cwd(), 'src/ui/styles/10-fields.css'), 'utf8');
    expect(shared.replace(/\s+/g, '')).toContain(
      'line-height:calc(var(--ctl-h)-2*var(--ctl-pad-y)-2*var(--ctl-bw))',
    );
    expect(shared.indexOf('font: inherit')).toBeLessThan(shared.indexOf('line-height:'));
  });

  it('focus never moves the radius — not on one panel, on all of them', async () => {
    const c = await renderAll();
    const boxes = [...c.querySelectorAll(PAINTED)];
    const radii = new Set<string>();
    for (const el of boxes) {
      const rest = getComputedStyle(el).borderRadius;
      expect(focusRadius(el), `${named(el)} changes shape on focus`).toBe(rest);
      radii.add(focusRadius(el));
    }
    expect([...radii]).toEqual(['9px']);
  });

  it('a focus rule may repaint a control but never resize it', async () => {
    const c = await renderAll();
    // Colour and outline only. Anything else in this list reflows the box.
    const GEOMETRY = [
      'border-radius', 'border-top-left-radius', 'border-top-right-radius',
      'border-bottom-left-radius', 'border-bottom-right-radius',
      'border', 'border-width', 'border-top-width', 'border-right-width',
      'border-bottom-width', 'border-left-width', 'border-style',
      'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
      'width', 'height', 'min-height', 'max-height', 'box-sizing', 'font-size', 'transform',
    ];
    const bad: string[] = [];
    for (const el of c.querySelectorAll(EVERY)) {
      for (const { selector, style } of focusDeclarations(el)) {
        for (const prop of GEOMETRY) {
          if (style.getPropertyValue(prop)) bad.push(`${selector} sets ${prop} on ${named(el)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('no panel stylesheet paints a box of its own any more', () => {
    const dir = path.join(process.cwd(), 'src/ui/styles');
    const shared = fs.readFileSync(path.join(dir, '10-fields.css'), 'utf8');
    expect(shared).toContain('--ctl-r');
    // Radius, border and fill are declared for a typing surface in exactly one file.
    const offenders: string[] = [];
    for (const f of fs.readdirSync(dir)) {
      if (f === '10-fields.css' || !f.endsWith('.css')) continue;
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const block of text.split('}')) {
        const head = block.slice(block.lastIndexOf('*/') + 1);
        const [sel, body = ''] = head.split('{');
        // ::-webkit-slider-thumb and friends style a part the browser draws, not the box.
        if (sel.includes('::')) continue;
        if (!/\b(input|textarea|select|\.search|\.word-edit|\.priority-input|\.export-tpl|\.ai-url|\.ai-key|\.ai-model)\b/.test(sel)) continue;
        if (/(^|;|\s)border-radius\s*:/.test(body)) offenders.push(`${f}: ${sel.trim()} sets border-radius`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

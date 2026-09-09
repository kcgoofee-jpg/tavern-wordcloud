/**
 * The cascade is the import order in styles/index.css (plan A8, 2026-09-08). Three things keep
 * it honest: every stylesheet is imported exactly once and exists; the mobile overrides stay
 * last (media queries add no specificity); and the set of file-number collisions can only
 * shrink — renumbering is a separate job, but nobody adds a fourth `42-`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = new URL('../../src/ui/styles/', import.meta.url);
const index = readFileSync(new URL('index.css', DIR), 'utf8');
const imports = [...index.matchAll(/@import\s+'\.\/([^']+)';/g)].map((m) => m[1]);
const onDisk = readdirSync(DIR).filter((f) => f.endsWith('.css') && f !== 'index.css');

/** Numbers that currently name more than one file. Shrink this when a file is renumbered; never grow it. */
const KNOWN_DUPLICATE_NUMBERS = ['41', '42', '46', '50'];

describe('styles/index.css', () => {
  it('imports every stylesheet exactly once and nothing that does not exist', () => {
    expect([...imports].sort()).toEqual([...onDisk].sort());
    expect(new Set(imports).size).toBe(imports.length);
  });

  it('keeps 37-mobile-overrides.css last', () => {
    expect(imports[imports.length - 1]).toBe('37-mobile-overrides.css');
  });

  it('does not add new file-number collisions', () => {
    const count = new Map<string, number>();
    for (const f of onDisk) { const n = f.slice(0, 2); count.set(n, (count.get(n) ?? 0) + 1); }
    const dupes = [...count].filter(([, c]) => c > 1).map(([n]) => n).sort();
    expect(dupes).toEqual(KNOWN_DUPLICATE_NUMBERS);
  });
});

/**
 * Two panel paradigms, not three (plan B3, 2026-09-08): a `.sheet` standing in the 340px
 * column, and a `.sheet.page` spanning the window — the community board and the export view.
 * The board used to be a third shell (`.community-page`) with its own head and body.
 *
 * No test opens the export view through App (it needs a finished analysis) and jsdom resolves
 * no stylesheets, so the contract is pinned where it is written: the classes App composes, and
 * the one stylesheet that gives a full-page sheet its box.
 */
describe('full-page sheets', () => {
  const app = readFileSync(new URL('../../src/ui/App.tsx', import.meta.url), 'utf8');
  const page = readFileSync(new URL('53-sheet-page.css', DIR), 'utf8');
  const exportCss = readFileSync(new URL('38-export.css', DIR), 'utf8');

  it('App puts both shells on `page`', () => {
    expect(app).toContain("' page export-view'");
    expect(app).toContain('`sheet page community');
    // The third shell is gone from the markup and from every stylesheet.
    expect(app).not.toContain('community-page');
    // Comments may still name it (they explain what it used to be); selectors may not.
    const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '');
    const stray = onDisk.filter((f) => strip(readFileSync(new URL(f, DIR), 'utf8')).includes('.community-page'));
    expect(stray).toEqual([]);
  });

  it('only 53-sheet-page.css gives a full-page sheet its box', () => {
    expect(page).toMatch(/\.sheet\.page:not\(\.fullscreen\)/);
    expect(page).toContain('z-index: var(--z-page)');
    // 38-export.css keeps the --exp-* literals and the phone full-screen page; what it must
    // not do again is inset `.sheet.export-view` itself — that duplicate is what B3 removed.
    expect(exportCss).not.toMatch(/\.sheet\.export-view\s*\{[^}]*left:/);
  });

  it('the board is imported after the sheet it specialises', () => {
    expect(imports.indexOf('53-sheet-page.css')).toBeGreaterThan(imports.indexOf('03-sheet.css'));
    expect(imports.indexOf('53-sheet-page.css')).toBeGreaterThan(imports.indexOf('38-export.css'));
  });
});

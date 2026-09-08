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

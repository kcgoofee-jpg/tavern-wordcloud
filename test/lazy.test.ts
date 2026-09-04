import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

/**
 * The web build (`npm run build`) must keep the legal documents, the QR encoder and the panels
 * off the first screen. Splitting is easy to undo by accident — a single `import X from …`
 * added back to App.tsx silently folds a chunk into the entry — so this walks the *static*
 * import graph from `src/main.tsx` and fails if any of them is reachable without an `import()`.
 *
 * `npm run build:single` deliberately folds every chunk back into one file
 * (build.rollupOptions.output.inlineDynamicImports); that is a bundler setting, not a source
 * one, so it does not affect what this test asserts.
 */

const ROOT = resolve(__dirname, '..');

/**
 * Static `import … from '…'` / `export … from '…'` specifiers that survive to runtime.
 * Type-only imports are dropped (they erase), and so is the worker entry: `?worker` is its own
 * bundle, which is exactly where the analysis pipeline is supposed to live.
 */
function staticSpecifiers(src: string): string[] {
  const out: string[] = [];
  // Strip block and line comments so commented-out imports do not count.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const re = /(?:^|[\n;])\s*(?:import|export)\s+([^'"()]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const clause = (m[1] ?? '').replace(/\sfrom\s*$/, '').trim();
    const spec = m[2];
    if (/\?worker/.test(spec)) continue;
    if (/^type\b/.test(clause)) continue;
    // `import { type A, type B } from …` erases entirely too.
    const braces = clause.match(/^\{([\s\S]*)\}$/);
    if (braces && braces[1].split(',').every((n) => n.trim() === '' || /^type\s/.test(n.trim()))) continue;
    out.push(spec);
  }
  return out;
}

const EXTS = ['', '.ts', '.tsx', '.js', '/index.ts', '/index.tsx'];

function resolveLocal(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  // Vite query suffixes: `?raw`, `?worker&inline`
  const clean = spec.split('?')[0];
  const base = resolve(dirname(from), clean);
  for (const e of EXTS) if (existsSync(base + e) && !existsSync(base + e + '/')) return base + e;
  return null;
}

/** Everything reachable from `src/main.tsx` through static imports only. */
function staticGraph(): Set<string> {
  const seen = new Set<string>();
  const queue = [resolve(ROOT, 'src/main.tsx')];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.(ts|tsx)$/.test(file)) continue;
    for (const spec of staticSpecifiers(readFileSync(file, 'utf8'))) {
      const next = resolveLocal(file, spec);
      if (next) queue.push(next);
    }
  }
  return seen;
}

const rel = (abs: string) => abs.slice(ROOT.length + 1);

describe('first-screen graph', () => {
  const graph = staticGraph();
  const files = [...graph].map(rel).sort();

  it('reaches the app entry at all (guards against a broken resolver)', () => {
    expect(files).toContain('src/ui/App.tsx');
    expect(files).toContain('src/ui/CloudCanvas.tsx');
  });

  it('does not statically reach the legal pages or their markdown', () => {
    expect(files).not.toContain('src/ui/LegalPage.tsx');
    expect(files).not.toContain('src/legal/markdown.tsx');
  });

  it('does not statically reach the QR encoder', () => {
    // `render/qrColor` (pure color math, needed every frame) is fine; `render/qr` pulls `qrcode`.
    expect(files).not.toContain('src/render/qr.ts');
    expect(files).toContain('src/render/qrColor.ts');
  });

  it('does not statically reach the panels', () => {
    const panels = files.filter((f) => f.startsWith('src/ui/panels/'));
    expect(panels).toEqual([]);
  });

  it('does not statically reach the model-endpoint helpers behind the AI panel', () => {
    expect(files).not.toContain('src/core/labelKinds.ts');
    expect(files).not.toContain('src/core/proposeRules.ts');
  });

  it('does not statically reach the analysis pipeline (it runs in the worker)', () => {
    expect(files).not.toContain('src/core/analyze.ts');
    expect(files).not.toContain('src/core/blocklist/index.ts');
    expect(files).not.toContain('src/core/bundle.ts');
  });

  it('loads them through import() instead', () => {
    const app = readFileSync(resolve(ROOT, 'src/ui/App.tsx'), 'utf8');
    expect(app).toMatch(/lazy\(\(\) => import\('\.\/LegalPage'\)\)/);
    expect(app).toMatch(/import\('\.\/panels\/AiPanel'\)/);
    expect(app).toMatch(/import\('\.\.\/core\/proposeRules'\)/);
    const loader = readFileSync(resolve(ROOT, 'src/render/qrLoad.ts'), 'utf8');
    expect(loader).toMatch(/import\('\.\/qr'\)/);
  });
});

describe('built chunks', () => {
  const assets = resolve(ROOT, 'dist/assets');
  const built = existsSync(assets) ? readdirSync(assets).filter((f) => f.endsWith('.js')) : [];
  const entry = built.filter((f) => f.startsWith('index-'));

  it.runIf(entry.length === 1)('keeps the legal text and qrcode out of the entry chunk', () => {
    const js = readFileSync(join(assets, entry[0]), 'utf8');
    // A sentence that only exists in the legal markdown.
    const terms = readFileSync(resolve(ROOT, 'src/legal/terms.zh.md'), 'utf8');
    const probe = terms.split('\n').find((l) => l.length > 24 && !l.startsWith('#'))!.slice(0, 20);
    expect(js).not.toContain(probe);
    // The qrcode package's own alignment table lives in the split-off chunk.
    expect(js).not.toContain('getRowColCoords');
    expect(built.some((f) => f.startsWith('LegalPage-'))).toBe(true);
    expect(built.some((f) => f.startsWith('qr-'))).toBe(true);
  });
});

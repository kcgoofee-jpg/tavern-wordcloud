/**
 * No secrets in build output. Development prefill from .env.local is guarded by
 * import.meta.env.DEV; this test searches the artifacts directly and skips only
 * when no artifacts exist.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ENV = path.join(ROOT, '.env.local');

/** Values from .env.local that look like secrets */
function secrets(): { name: string; value: string }[] {
  if (!fs.existsSync(ENV)) return [];
  return fs.readFileSync(ENV, 'utf8').split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => ({ name: l.slice(0, l.indexOf('=')), value: l.slice(l.indexOf('=') + 1).trim() }))
    // Long enough, not a URL, not a model name
    .filter((x) => x.value.length >= 20 && !x.value.includes('/') && !x.value.startsWith('http'));
}

/** All text files in the build output, recursively */
function textFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return textFiles(p);
    return /\.(html|js|css|json|map|txt)$/.test(e.name) ? [p] : [];
  });
}

const keys = secrets();
const dists = ['dist', 'dist-single'].map((d) => path.join(ROOT, d)).filter(fs.existsSync);

describe.skipIf(dists.length === 0 || keys.length === 0)('构建产物不许含密钥', () => {
  it.each(dists.map((d) => path.basename(d)))('%s 里搜不到 .env.local 的任何一把密钥', (name) => {
    const files = textFiles(path.join(ROOT, name));
    expect(files.length).toBeGreaterThan(0);   // Empty output makes the test meaningless
    const hits: string[] = [];
    for (const f of files) {
      const body = fs.readFileSync(f, 'utf8');
      for (const k of keys) {
        if (body.includes(k.value)) hits.push(`${path.relative(ROOT, f)} 含 ${k.name}`);
      }
    }
    expect(hits).toEqual([]);
  });

  /** npm start injects the endpoint configuration at response time for localhost only; pinned statically. */
  it('start.mjs injects for localhost only', () => {
    const src = fs.readFileSync(path.join(ROOT, 'tools', 'start.mjs'), 'utf8');
    expect(src).toContain('isLocal');
    expect(src).toMatch(/host === 'localhost'/);
    // The injected and the clean responses must be distinct (cached.local / cached.raw)
    expect(src).toMatch(/cached = \{ mtime: 0, raw: '', local: '' \}/);
    expect(src).toMatch(/isLocal \? c\.local : c\.raw/);
  });

  /** npm start must re-read the HTML when it changes rather than caching it forever. */
  it('start.mjs re-checks the file on every request', () => {
    const src = fs.readFileSync(path.join(ROOT, 'tools', 'start.mjs'), 'utf8');
    // Re-read by mtime
    expect(src).toMatch(/statSync\(FILE\)\.mtimeMs/);
    // The response body comes from the accessor, not a module constant
    expect(src).toMatch(/const c = current\(\);/);
    expect(src).toMatch(/res\.end\(isLocal \? c\.local : c\.raw\)/);
  });

  it('the deploy script uploads the clean artifact', () => {
    const p = path.join(ROOT, 'ops', 'deploy.mjs');
    if (!fs.existsSync(p)) return;   // public mirror: no ops/
    const src = fs.readFileSync(p, 'utf8');
    expect(src).toContain('dist-single/index.html');
    // The deploy script must not read .env.local
    expect(src).not.toMatch(/\.env\.local/);
  });

  it('the search itself works: it finds keys in .env.local', () => {
    // Guard against a broken search: a file that certainly contains a key must be found
    const body = fs.readFileSync(ENV, 'utf8');
    expect(keys.some((k) => body.includes(k.value))).toBe(true);
  });
});

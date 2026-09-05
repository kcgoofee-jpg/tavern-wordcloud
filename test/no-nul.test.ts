/**
 * Source files must stay text. A raw NUL byte makes grep (and every check that
 * shells out to it) skip the whole file without printing a hit or a zero —
 * `server/admin.ts` spent a day as `data` for that reason (2026-09-05).
 * Separators in strings belong as `\u0000`, which is the same character at runtime.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TREES = ['src', 'server', 'tools', 'test', '.github'];
const SKIP_DIR = new Set(['node_modules', 'dist', 'dist-single', '.git']);
const TEXT_EXT = new Set(['.ts', '.tsx', '.mjs', '.js', '.css', '.json', '.yml', '.yaml', '.md', '.html']);
/** Files that used to carry a literal NUL. If the walker stops visiting them, this list goes red. */
const MUST_SCAN = ['server/admin.ts', 'tools/eval/import-fixes.mjs', 'src/core/cardRules.ts'];

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIR.has(e.name)) continue;
      walk(path.join(dir, e.name), out);
    } else if (TEXT_EXT.has(path.extname(e.name).toLowerCase())) {
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

describe('源码树不许出现裸 NUL', () => {
  const files = TREES.flatMap((t) => walk(path.join(ROOT, t)));
  const rel = (p: string) => path.relative(ROOT, p);

  it('the walker actually visits the files that used to be binary', () => {
    const set = new Set(files.map(rel));
    for (const p of MUST_SCAN) expect(set.has(p), p).toBe(true);
  });

  it('no scanned file contains a 0x00 byte', () => {
    const hits: string[] = [];
    for (const f of files) {
      const buf = fs.readFileSync(f);
      if (buf.includes(0)) hits.push(rel(f));
    }
    expect(hits).toEqual([]);
  });

  it('the search itself works: a buffer with a NUL is detected', () => {
    expect(Buffer.from('ok\u0000still').includes(0)).toBe(true);
    expect(Buffer.from('ok\\u0000still').includes(0)).toBe(false);
  });
});

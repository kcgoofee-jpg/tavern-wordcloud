#!/usr/bin/env node
/**
 * Pixel regression against notes/optimize/baseline/<set>/*.png using pixelmatch.
 *   node tools/optimize/visual.mjs <shotRoot>            # compare every <shotRoot>/<set>/*.png, print JSON
 *   node tools/optimize/visual.mjs <shotRoot> --update   # copy current shots over the baseline
 * A set is a directory such as 1440x900-zh. Missing baseline images count as "new", not as failures.
 */
import { readdirSync, readFileSync, existsSync, mkdirSync, copyFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const root = process.argv[2];
const update = process.argv.includes('--update');
const BASE = path.join(process.cwd(), 'notes', 'optimize', 'baseline');
if (!root || !existsSync(root)) { console.error('usage: visual.mjs <shotRoot> [--update]'); process.exit(2); }
const sets = readdirSync(root).filter((d) => statSync(path.join(root, d)).isDirectory());
const result = { sets: {}, maxRatio: 0, missingBaseline: 0 };
for (const set of sets) {
  const cur = path.join(root, set), base = path.join(BASE, set);
  if (update) { rmSync(base, { recursive: true, force: true }); mkdirSync(base, { recursive: true }); for (const f of readdirSync(cur)) if (f.endsWith('.png')) copyFileSync(path.join(cur, f), path.join(base, f)); result.sets[set] = 'updated'; continue; }
  const per = {};
  for (const f of readdirSync(cur).filter((x) => x.endsWith('.png'))) {
    const b = path.join(base, f);
    if (!existsSync(b)) { per[f] = 'new'; result.missingBaseline++; continue; }
    const a = PNG.sync.read(readFileSync(path.join(cur, f))), bb = PNG.sync.read(readFileSync(b));
    if (a.width !== bb.width || a.height !== bb.height) { per[f] = 1; result.maxRatio = 1; continue; }
    const diff = pixelmatch(a.data, bb.data, null, a.width, a.height, { threshold: 0.1 });
    const r = +(diff / (a.width * a.height)).toFixed(4);
    per[f] = r; if (r > result.maxRatio) result.maxRatio = r;
  }
  result.sets[set] = per;
}
console.log(JSON.stringify(result));

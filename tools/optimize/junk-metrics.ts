/** Junk-word hits in the TOP 40 on the fixture corpus and on the largest local real logs. Prints one JSON object. */
import fs from 'node:fs';
import path from 'node:path';
import { analyze, DEFAULT_ANALYZE_OPTIONS } from '../../src/core/analyze';
import { junkRate } from '../eval/junk';

const run = (file: string) => {
  const r = analyze([{ name: path.basename(file), content: fs.readFileSync(file, 'utf8') }], { ...DEFAULT_ANALYZE_OPTIONS, roles: ['user', 'char'] });
  return junkRate(r.words).hits;
};
const fixture = path.join(process.cwd(), 'fixtures', 'ceo-zh.jsonl');
const out: Record<string, unknown> = { fixture: fs.existsSync(fixture) ? run(fixture).length : null };
const ROOTS = localCorpusRoots();
const real: number[] = [];
for (const root of ROOTS) {
  const dir = path.join(root, 'default-user/chats');
  if (!fs.existsSync(dir)) continue;
  for (const card of fs.readdirSync(dir)) {
    const cd = path.join(dir, card);
    if (!fs.statSync(cd).isDirectory()) continue;
    for (const f of fs.readdirSync(cd)) if (f.endsWith('.jsonl') && fs.statSync(path.join(cd, f)).size > 200_000) real.push(run(path.join(cd, f)).length);
  }
}
out.realMax = real.length ? Math.max(...real) : null;
out.realFiles = real.length;
console.log(JSON.stringify(out));

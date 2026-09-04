/** Core numbers for the optimisation loop: noise ratio, tokenize time, layout time. Prints one JSON object. */
import fs from 'node:fs';
import path from 'node:path';
import { analyze, DEFAULT_ANALYZE_OPTIONS } from '../../src/core/analyze';
import { layoutCloud } from '../../src/render/layout';

const ROOT = process.cwd();
const fx = (name: string) => path.join(ROOT, 'fixtures', name);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const out: Record<string, unknown> = {};
// Noise ratio and timing on the two hand-made corpora
const noise: Record<string, number> = {};
for (const name of ['ceo-zh.jsonl', 'ceo-en.jsonl']) {
  if (!fs.existsSync(fx(name))) continue;
  const r = analyze([{ name, content: fs.readFileSync(fx(name), 'utf8') }], { ...DEFAULT_ANALYZE_OPTIONS, roles: ['user', 'char'] });
  noise[name] = +(1 - r.cleanChars / r.rawChars).toFixed(4);
}
out.noise = noise;
// Tokenize throughput: the largest generated fixture (1500 turns), median of 3
const big = fs.readdirSync(path.join(ROOT, 'fixtures')).filter((f) => f.endsWith('.jsonl') && !f.startsWith('ceo'))
  .map((f) => ({ f, size: fs.statSync(fx(f)).size })).sort((a, b) => b.size - a.size)[0];
if (big) {
  const content = fs.readFileSync(fx(big.f), 'utf8');
  const ms: number[] = [];
  let msgs = 0;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    const r = analyze([{ name: big.f, content }], { ...DEFAULT_ANALYZE_OPTIONS, roles: ['user', 'char'] });
    ms.push(performance.now() - t0); msgs = r.messageCount;
  }
  out.tokenize = { fixture: big.f, bytes: big.size, messages: msgs, ms: Math.round(median(ms)) };
}
// Layout: 400 candidates on a 1440x900 canvas with a deterministic text measure (same shape as test/layout.test.ts)
{
  const words = Array.from({ length: 400 }, (_, i) => ({ text: '词' + i, count: Math.round(2000 / (i + 1)) + 1 }));
  // Same fake measurer and options as test/layout.test.ts "one layout stays within budget"
  const measure = (text: string, fontSize: number) => ({ w: text.length * fontSize, h: fontSize * 0.92 });
  const opts = { width: 2560, height: 1440, maxFontSize: 262, minFontSize: 26, rotateRatio: 0.2, steps: 6, padding: 9, idleAmplitude: 4.5, seed: 1, fontFamily: 'sans-serif', fontWeight: '600' };
  const ms: number[] = []; let placed = 0;
  for (let i = 0; i < 3; i++) { const t0 = performance.now(); placed = layoutCloud(words, opts, measure).length; ms.push(performance.now() - t0); }
  out.layout = { placed, ms: Math.round(median(ms)) };
}
console.log(JSON.stringify(out));

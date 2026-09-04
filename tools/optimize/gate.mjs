#!/usr/bin/env node
/**
 * Gate for the optimisation loop: judges the newest metrics line against notes/optimize/baseline.json.
 *   node tools/optimize/gate.mjs                 # exit 0 when every rule holds
 *   node tools/optimize/gate.mjs --set-baseline  # copy the newest line into baseline.json
 *   node tools/optimize/gate.mjs --accept-visual # skip the pixel rule this once (intended UI change; run visual.mjs --update after)
 * Rules: tests/typecheck/lint/build must pass; eval ≥ 107; junk fixture = 0 and real ≤ 2; layout audit 0 and no dead
 * clicks; a11y violations ≤ baseline (0 once baseline is 0); pixel diff ≤ 0.5 %; gzip ≤ baseline × 1.02;
 * tokenize/layout ms ≤ baseline × 1.10; noise ratio within ±2 points of baseline.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const OUT = path.join(process.cwd(), 'notes', 'optimize');
const lines = readFileSync(path.join(OUT, 'metrics.jsonl'), 'utf8').trim().split('\n');
const m = JSON.parse(lines[lines.length - 1]);
const basePath = path.join(OUT, 'baseline.json');
if (process.argv.includes('--set-baseline')) { writeFileSync(basePath, JSON.stringify(m, null, 1) + '\n'); console.log('baseline set from', m.commit); process.exit(0); }
const base = existsSync(basePath) ? JSON.parse(readFileSync(basePath, 'utf8')) : null;
const acceptVisual = process.argv.includes('--accept-visual');
const fails = [];
const need = (ok, msg) => { if (!ok) fails.push(msg); };

if (!m.quick) {
  need(m.build === 0, `build exit ${m.build}`);
  need(m.tests?.failed === 0 && m.tests?.exit === 0, `tests failed=${m.tests?.failed} exit=${m.tests?.exit}`);
  need(m.typecheck === 0, `typecheck exit ${m.typecheck}`);
  need(m.lint === 0, `lint exit ${m.lint}`);
}
need((m.eval?.hits ?? 0) >= 107, `eval ${m.eval?.hits}/108 < 107`);
need(m.junk?.fixture === 0, `junk on fixture ${m.junk?.fixture}`);
need(m.junk?.realMax == null || m.junk.realMax <= 2, `junk on real logs ${m.junk?.realMax} > 2`);
if (m.shots) for (const [set, s] of Object.entries(m.shots)) {
  need(s.exit === 0 && s.layout === 0, `${set}: layout audit ${s.layout} issues, exit ${s.exit}`);
  need(s.deadClicks === 0, `${set}: ${s.deadClicks} dead clicks`);
}
if (base) {
  const a11yBase = (base.a11y?.count ?? 0) + Object.values(base.shots ?? {}).reduce((a, s) => a + (s.a11y ?? 0), 0);
  const a11yNow = (m.a11y?.count ?? 0) + Object.values(m.shots ?? {}).reduce((a, s) => a + (s.a11y ?? 0), 0);
  need(a11yNow <= a11yBase, `a11y violations ${a11yNow} > baseline ${a11yBase}`);
  if (m.bundle && base.bundle) need(m.bundle.gzip <= base.bundle.gzip * 1.02, `gzip ${m.bundle.gzip} > ${Math.round(base.bundle.gzip * 1.02)}`);
  if (m.core?.tokenize && base.core?.tokenize) need(m.core.tokenize.ms <= base.core.tokenize.ms * 1.10, `tokenize ${m.core.tokenize.ms}ms > ${Math.round(base.core.tokenize.ms * 1.1)}`);
  if (m.core?.layout && base.core?.layout) need(m.core.layout.ms <= Math.max(base.core.layout.ms * 1.10, base.core.layout.ms + 20), `layout ${m.core.layout.ms}ms > budget`);
  for (const [f, v] of Object.entries(m.core?.noise ?? {})) if (base.core?.noise?.[f] != null) need(Math.abs(v - base.core.noise[f]) <= 0.02, `noise ${f} ${v} vs ${base.core.noise[f]}`);
  if (m.visual && !acceptVisual) need((m.visual.maxRatio ?? 0) <= 0.005, `visual diff ${m.visual.maxRatio} > 0.005`);
}
if (fails.length) { console.error('GATE FAILED\n  ' + fails.join('\n  ')); process.exit(1); }
console.log(`gate ok (${m.commit}): eval ${m.eval?.hits}/108, junk ${m.junk?.fixture}/${m.junk?.realMax}, gzip ${m.bundle?.gzip}, tokenize ${m.core?.tokenize?.ms}ms, layout ${m.core?.layout?.ms}ms, a11y ${m.a11y?.count}, visual ${m.visual?.maxRatio ?? '-'}`);

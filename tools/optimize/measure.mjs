#!/usr/bin/env node
/**
 * One measurement run for the optimisation loop. Appends one JSON line to notes/optimize/metrics.jsonl.
 *   node tools/optimize/measure.mjs            # everything (build, tests, eval, junk, core, shots, visual, a11y)
 *   node tools/optimize/measure.mjs --quick    # skip build/tests/shots (core numbers only)
 * Screenshots land in /tmp/opt/<WxH-lang>/ so visual.mjs can compare them with the baseline.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const ROOT = process.cwd();
const quick = process.argv.includes('--quick');
const OUT = path.join(ROOT, 'notes', 'optimize');
mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
const json = (s) => JSON.parse(s.trim().split('\n').filter(Boolean).pop());
const step = (name, fn) => { const s = Date.now(); process.stderr.write(`▸ ${name}… `); const v = fn(); process.stderr.write(`${((Date.now() - s) / 1000).toFixed(0)}s\n`); return v; };

const m = { ts: new Date().toISOString(), commit: sh('git', ['rev-parse', '--short', 'HEAD']).stdout.trim(), quick };

if (!quick) {
  m.build = step('build:single', () => sh('npm', ['run', 'build:single']).status);
}
const single = path.join(ROOT, 'dist-single', 'index.html');
if (existsSync(single)) {
  const buf = readFileSync(single);
  m.bundle = { bytes: buf.length, gzip: gzipSync(buf, { level: 9 }).length };
}
if (!quick) {
  m.tests = step('vitest', () => {
    const r = sh('npx', ['vitest', 'run', '--reporter=json', '--outputFile=/tmp/opt-vitest.json']);
    try { const j = JSON.parse(readFileSync('/tmp/opt-vitest.json', 'utf8')); return { passed: j.numPassedTests, failed: j.numFailedTests, total: j.numTotalTests, exit: r.status }; }
    catch { return { exit: r.status }; }
  });
  m.typecheck = step('typecheck', () => sh('npm', ['run', 'typecheck']).status);
  m.lint = step('lint', () => sh('npm', ['run', 'lint']).status);
}
m.eval = step('eval', () => {
  const r = sh('npx', ['--yes', 'vite-node', 'tools/eval/cli.ts']);
  const hit = /^B [^\n]*?(\d+)\/(\d+)/m.exec(r.stdout ?? '');
  return hit ? { hits: Number(hit[1]), total: Number(hit[2]) } : { error: (r.stderr || '').slice(0, 200) };
});
m.junk = step('junk', () => json(sh('npx', ['--yes', 'vite-node', 'tools/optimize/junk-metrics.ts']).stdout));
m.core = step('core', () => json(sh('npx', ['--yes', 'vite-node', 'tools/optimize/core-metrics.ts']).stdout));
m.a11y = step('a11y contrast', () => { try { return json(sh('node', ['tools/optimize/a11y.mjs']).stdout); } catch (e) { return { error: String(e).slice(0, 200) }; } });

if (!quick) {
  const shotRoot = '/tmp/opt';
  rmSync(shotRoot, { recursive: true, force: true }); mkdirSync(shotRoot, { recursive: true });
  const shots = {};
  for (const [w, h, lang] of [[1440, 900, 'zh'], [390, 844, 'zh'], [1440, 900, 'en']]) {
    const set = `${w}x${h}-${lang}`;
    shots[set] = step(`shot ${set}`, () => {
      const r = sh('node', ['tools/shot.mjs', String(w), String(h)], { env: { ...process.env, SHOT_NO_BUILD: '1', SHOT_LANG: lang, SHOT_DIR: path.join(shotRoot, set), SHOT_A11Y: '1' } });
      const out = (r.stdout ?? '') + (r.stderr ?? '');
      return {
        exit: r.status,
        layout: (out.match(/^\s*✗ /gm) ?? []).length,
        deadClicks: Number(/点击自检：(\d+)/.exec(out)?.[1] ?? 0),
        a11y: [...out.matchAll(/\[a11y\] [^:]+: (\d+)/g)].reduce((a, x) => a + Number(x[1]), 0),
      };
    });
  }
  m.shots = shots;
  m.visual = step('visual', () => { try { return json(sh('node', ['tools/optimize/visual.mjs', shotRoot]).stdout); } catch (e) { return { error: String(e).slice(0, 200) }; } });
}
m.seconds = Math.round((Date.now() - t0) / 1000);
appendFileSync(path.join(OUT, 'metrics.jsonl'), JSON.stringify(m) + '\n');
console.log(JSON.stringify(m, null, 1));

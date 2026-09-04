#!/usr/bin/env node
/**
 * Big-file memory and progress benchmark for `analyzeAsync`.
 *
 *   npm run bench:big                 # 5 / 10 / 20 MB
 *   npm run bench:big -- --mb 5,40    # custom sizes
 *   npm run bench:big -- --json       # one JSON line instead of the table
 *
 * The payload is the largest generated fixture repeated up to the requested size,
 * so parsing, cleaning, entity detection and tokenization all do real work (the
 * same trick `tools/optimize/load.mjs` uses for the server). Run
 * `node tools/make-fixtures.mjs fixtures` first if `fixtures/` is empty.
 *
 * Why a child process per size: peak RSS is only meaningful on a fresh heap. One
 * process measuring 5, 10 and 20 MB in a row reports the 20 MB peak three times,
 * because V8 does not hand the pages back between runs. The parent below is plain
 * node; each child is `vite-node`, which is what lets a .mjs import `src/core`.
 *
 * What is measured, per size:
 *   峰值 RSS   max process.memoryUsage().rss, sampled every 25 ms plus once after
 *              each progress callback, minus the RSS the process had before the
 *              payload was built (so it is the cost of the analysis, not of node)
 *   耗时       wall time of analyzeAsync alone
 *   进度回调    number of onParse + onTokenize calls, and the gaps between them —
 *              AGENTS.md hard rule 5 wants one progress ring that actually moves,
 *              so the longest gap must stay under PROGRESS_BUDGET_MS
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** A progress callback gap longer than this reads as a frozen ring. */
const PROGRESS_BUDGET_MS = 300;
/**
 * The largest request the server accepts (`server/index.ts`: 10 MB, 5 MB in
 * throttle mode). Sizes above it are measured for the head-room picture but do not
 * decide the exit code — nothing can send them.
 */
const LIMIT_MB = 10;

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const SIZES = String(arg('mb', '5,10,20')).split(',').map(Number).filter((n) => n > 0);
const ROOT = process.cwd();
const SELF = fileURLToPath(import.meta.url);

/* ---------- Payload ---------- */
/** The largest generated fixture, repeated (whole lines only) up to `mb`. */
function payload(mb) {
  const dir = path.join(ROOT, 'fixtures');
  if (!fs.existsSync(dir)) throw new Error('找不到 fixtures/：先跑 node tools/make-fixtures.mjs fixtures');
  const big = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl') && !f.startsWith('ceo'))
    .map((f) => ({ f, size: fs.statSync(path.join(dir, f)).size }))
    .sort((a, b) => b.size - a.size)[0];
  if (!big) throw new Error('fixtures/ 里没有 .jsonl：先跑 node tools/make-fixtures.mjs fixtures');
  // Cycle whole lines rather than whole copies of the file: the largest fixture is
  // already ~10 MB, so copy granularity cannot hit a 5 MB target, and a truncated
  // last line would silently be dropped by the parser instead of counted.
  const lines = fs.readFileSync(path.join(dir, big.f), 'utf8').split('\n').filter((l) => l.trim());
  const target = mb * 1024 * 1024;
  const parts = [];
  let bytes = 0;
  for (let i = 0; bytes < target; i++) {
    const l = lines[i % lines.length];
    parts.push(l);
    bytes += Buffer.byteLength(l) + 1;
  }
  return { name: big.f, content: parts.join('\n') };
}

/* ---------- Child: measure one size ---------- */
if (args.includes('--child')) {
  const mb = Number(arg('size', '5'));
  const { analyzeAsync, DEFAULT_ANALYZE_OPTIONS } = await import('../../src/core/analyze.ts');

  const base = process.memoryUsage().rss;
  const { name, content } = payload(mb);
  let peak = process.memoryUsage().rss;
  const sample = () => { const r = process.memoryUsage().rss; if (r > peak) peak = r; };
  const sampler = setInterval(sample, 25);
  sampler.unref?.();

  /** Callback timestamps, both phases in one list: the user sees one ring. */
  const ticks = [];
  const tick = () => { ticks.push(performance.now()); sample(); };

  const t0 = performance.now();
  const result = await analyzeAsync(
    [{ name, content }],
    { ...DEFAULT_ANALYZE_OPTIONS, roles: ['user', 'char'] },
    undefined,
    tick,
    tick,
  );
  const ms = performance.now() - t0;
  clearInterval(sampler);
  sample();

  // Gaps include the head (start -> first callback, i.e. the whole parse of a single
  // file) and the tail (last callback -> done, i.e. discovery + counting + layout
  // input). The ring is just as frozen there as it is between two callbacks.
  const gaps = [];
  let prev = t0;
  for (const t of ticks) { gaps.push(t - prev); prev = t; }
  gaps.push(t0 + ms - prev);
  gaps.sort((a, b) => a - b);
  const mid = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;

  process.stdout.write('\n__BIGFILE__' + JSON.stringify({
    mb,
    bytes: Buffer.byteLength(content),
    messages: result.messageCount,
    words: result.words.length,
    ms: Math.round(ms),
    rssMb: +((peak - base) / 1048576).toFixed(1),
    peakRssMb: +(peak / 1048576).toFixed(1),
    ticks: ticks.length,
    maxGapMs: Math.round(gaps.length ? gaps[gaps.length - 1] : ms),
    medGapMs: Math.round(mid),
  }) + '\n');
  process.exit(0);
}

/* ---------- Parent: one child per size, then a table ---------- */
const rows = [];
for (const mb of SIZES) {
  process.stderr.write(`▸ ${mb} MB… `);
  const r = spawnSync('npx', ['--yes', 'vite-node', SELF, '--', '--child', '--size', String(mb)], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  const line = (r.stdout ?? '').split('\n').find((l) => l.startsWith('__BIGFILE__'));
  if (!line) {
    process.stderr.write('失败\n');
    console.error((r.stderr ?? '').slice(-2000));
    process.exit(1);
  }
  const row = JSON.parse(line.slice('__BIGFILE__'.length));
  rows.push(row);
  process.stderr.write(`${(row.ms / 1000).toFixed(1)}s\n`);
}

if (args.includes('--json')) {
  console.log(JSON.stringify({ budgetMs: PROGRESS_BUDGET_MS, rows }));
} else {
  const pad = (s, n) => String(s).padStart(n);
  console.log(`\n大文件基准（analyzeAsync，每档一个全新进程；进度回调预算 ${PROGRESS_BUDGET_MS} ms）\n`);
  console.log('语料    消息数     词数   耗时      峰值 RSS   分析占用   进度回调   回调间隔中位/最大');
  console.log('-'.repeat(88));
  for (const r of rows) {
    console.log(
      pad(r.mb + ' MB', 6) + pad(r.messages, 9) + pad(r.words, 8) +
      pad((r.ms / 1000).toFixed(1) + ' s', 9) +
      pad(r.peakRssMb + ' MB', 11) + pad(r.rssMb + ' MB', 11) +
      pad(r.ticks, 10) + pad(`${r.medGapMs} / ${r.maxGapMs} ms`, 19),
    );
  }
  const inLimit = rows.filter((r) => r.mb <= LIMIT_MB);
  const worst = inLimit.reduce((a, r) => Math.max(a, r.maxGapMs), 0);
  const over = rows.filter((r) => r.mb > LIMIT_MB && r.maxGapMs >= PROGRESS_BUDGET_MS);
  console.log(
    worst < PROGRESS_BUDGET_MS
      ? `\n✅ 服务端上限 ${LIMIT_MB} MB 以内，进度回调最长间隔 ${worst} ms < ${PROGRESS_BUDGET_MS} ms，进度环不会看起来卡死。`
      : `\n❌ 服务端上限 ${LIMIT_MB} MB 以内，进度回调最长间隔 ${worst} ms ≥ ${PROGRESS_BUDGET_MS} ms，进度环会看起来卡死（硬规则 5）。`,
  );
  if (over.length) {
    console.log(`ℹ 超过上限的档位（${over.map((r) => r.mb + ' MB').join('、')}）最长间隔 ` +
      `${Math.max(...over.map((r) => r.maxGapMs))} ms，超预算；这些体积服务端不收，只影响单文件版本地跑。`);
  }
  process.exit(worst < PROGRESS_BUDGET_MS ? 0 : 1);
}

/**
 * Load test for the analysis endpoint: fires N requests of a given size at a
 * given concurrency and reports p50 / p95 / failure rate / 503 count.
 *
 * The payload is stitched together from the generated fixtures (`node
 * tools/make-fixtures.mjs` first) until it reaches --size-mb, so the server does
 * real parsing, cleaning and tokenization rather than chewing on filler.
 *
 * Usage:
 *   node tools/optimize/load.mjs [--url http://127.0.0.1:8790] [--concurrency 8]
 *                               [--size-mb 5] [--requests 16]
 *
 * The default target is the local server. Pointing it at production is possible
 * but never the default: pass --url explicitly, and only against staging.
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const PORT = process.env.PORT || 8790;
const URL_ = String(arg('url', `http://127.0.0.1:${PORT}`)).replace(/\/$/, '');
const CONCURRENCY = Math.max(1, Number(arg('concurrency', 8)));
const SIZE_MB = Math.max(0.05, Number(arg('size-mb', 5)));
const REQUESTS = Math.max(1, Number(arg('requests', CONCURRENCY * 2)));

if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[?::1]?)/.test(URL_)) {
  console.log(`⚠ 目标不是本机：${URL_}。只对 staging 打，别打线上。`);
}

/* ---------- Payload: fixture lines repeated up to the requested size ---------- */
const FIX = path.join(process.cwd(), 'fixtures');
if (!fs.existsSync(FIX)) {
  console.error('找不到 fixtures/：先跑 node tools/make-fixtures.mjs');
  process.exit(2);
}
const files = fs.readdirSync(FIX).filter((f) => f.endsWith('.jsonl'));
if (!files.length) {
  console.error('fixtures/ 里没有 .jsonl：先跑 node tools/make-fixtures.mjs');
  process.exit(2);
}
const seed = files.map((f) => fs.readFileSync(path.join(FIX, f), 'utf8').trim()).join('\n');
const target = SIZE_MB * 1024 * 1024;
// Whole lines up to the byte target. `slice(0, target)` used to truncate by *characters*
// while the loop measured bytes, so `--size-mb 5` produced 5.24 M characters = 10.5 MB of
// UTF-8 Chinese — and the oversized request body got blamed on JSON escaping instead
// (notes/docs/31 §10.5; escaping is only ~4%).
let content = '';
const lines = seed.split('\n');
for (let i = 0; Buffer.byteLength(content) < target; i++) content += `${lines[i % lines.length]}\n`;
const body = JSON.stringify({ name: 'load.jsonl', content, options: {} });
const bodyMb = (Buffer.byteLength(body) / 1048576).toFixed(2);

/* ---------- Fire ---------- */
const results = [];
let sent = 0;

async function one() {
  const t0 = Date.now();
  try {
    const r = await fetch(`${URL_}/api/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    });
    const text = await r.text();                          // Drain the SSE stream before timing
    results.push({ ms: Date.now() - t0, status: r.status, ok: r.status === 200 && text.includes('event: done') });
  } catch (e) {
    results.push({ ms: Date.now() - t0, status: 0, ok: false, error: e.message });
  }
}

async function worker() {
  while (sent < REQUESTS) { sent++; await one(); }
}

const pct = (xs, p) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};

const started = Date.now();
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
const wall = Date.now() - started;

const okMs = results.filter((r) => r.ok).map((r) => r.ms);
const fails = results.filter((r) => !r.ok);
const n503 = results.filter((r) => r.status === 503).length;
const n429 = results.filter((r) => r.status === 429).length;
const p50 = pct(okMs, 0.5), p95 = pct(okMs, 0.95);
const failRate = results.length ? fails.length / results.length : 0;

console.log(`
目标        ${URL_}
请求        ${REQUESTS} 个 · 并发 ${CONCURRENCY} · 每个 ${SIZE_MB} MB 语料（请求体 ${bodyMb} MB）
成功        ${okMs.length}/${results.length}
p50 / p95   ${p50} ms / ${p95} ms
失败率      ${(failRate * 100).toFixed(1)}%   （503 ${n503} 个 · 429 ${n429} 个 · 其他 ${fails.length - n503 - n429} 个）
总耗时      ${(wall / 1000).toFixed(1)} s · 吞吐 ${(okMs.length / (wall / 1000)).toFixed(2)} 次/秒`);

const verdict = n503 > 0
  ? `结论：并发 ${CONCURRENCY} 打满了队列，${n503} 个请求被 503 挡回——这正是「限流模式」和后台负载告警要覆盖的场景。`
  : failRate > 0
    ? `结论：并发 ${CONCURRENCY} 没触发 503，但有 ${fails.length} 个请求失败，先查服务端日志。`
    : p95 > 8000
      ? `结论：并发 ${CONCURRENCY} 全部成功但 p95 ${p95} ms 已超过 8 s 的「偏忙」阈值，真实用户会觉得卡。`
      : `结论：并发 ${CONCURRENCY} 全部成功，p95 ${p95} ms 在阈值内，这台机器扛得住。`;
console.log(verdict + '\n');

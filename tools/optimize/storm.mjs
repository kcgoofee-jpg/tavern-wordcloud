#!/usr/bin/env node
/**
 * "Hot post" load test for the analysis server: many *different* visitors, realistic
 * chat-log sizes, gzip uploads like the browser sends, and a probe that keeps loading
 * the landing page and /api/health while the analyses run. `load.mjs` answers "how many
 * requests per second"; this one answers "what does the tenth visitor of a Reddit
 * front-page hour actually see" — a queue wait, a 503, a frozen landing page, or nothing.
 *
 * Scenarios (--scenario):
 *   calibrate  one request per size in --mix, one after another, one IP — service time per MB
 *   burst      --visitors N all click within --spread s (one analysis each)
 *   arrivals   Poisson arrivals at --rate per minute for --duration s (one analysis each)
 *   abuse      one IP fires --requests small analyses at --concurrency c — the per-IP cap
 *
 * Every visitor gets its own address in `cf-connecting-ip` (the server trusts that header
 * unless WC_TRUST_PROXY=none), so the per-IP hourly cap does not bite in burst/arrivals
 * — that is deliberate: a hot post is many people, not one script. `--no-spoof` sends
 * no header (everything counts as one IP, like `load.mjs`).
 *
 * The payload for each size is stitched from `fixtures/*.jsonl` (whole lines, up to the
 * byte target; `node tools/make-fixtures.mjs` first) so the server does real parsing,
 * cleaning and tokenizing. `--mix "0.5:4,1.5:3,3:2,6:1"` is MB:weight — the default
 * leans small, the way real exports do (a month of daily chat is 1–3 MB).
 *
 * Reported per scenario: outcomes (200 with `event: done` / 503 / 429 / other), the
 * wait before the first byte (upload + queue), the server-side analysis time from the
 * `done` event, the end-to-end time, the landing-page probe (p50 / p95 / max while the
 * scenario ran), and every /api/health load state seen. `--json` adds one JSON line.
 *
 * Usage:
 *   node tools/optimize/storm.mjs --scenario burst --visitors 20 [--url http://127.0.0.1:8790]
 *   node tools/optimize/storm.mjs --scenario arrivals --rate 60 --duration 120
 *   node tools/optimize/storm.mjs --scenario abuse --requests 210 --concurrency 4
 *   node tools/optimize/storm.mjs --scenario calibrate --mix 0.5,1,2,5,10
 *
 * Never point it at production: it exists so the production numbers do not have to be
 * learned from real visitors. Run it against a second container of the same image.
 */
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

/* ---------- Args ---------- */
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined && !String(args[i + 1]).startsWith('--') ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const URL_ = String(arg('url', `http://127.0.0.1:${process.env.PORT || 8790}`)).replace(/\/$/, '');
const SCENARIO = String(arg('scenario', 'burst'));
const VISITORS = Math.max(1, Number(arg('visitors', 20)));
const SPREAD_S = Math.max(0, Number(arg('spread', 1)));
const RATE_PER_MIN = Math.max(0.1, Number(arg('rate', 30)));
const DURATION_S = Math.max(1, Number(arg('duration', 60)));
const REQUESTS = Math.max(1, Number(arg('requests', 210)));
const CONCURRENCY = Math.max(1, Number(arg('concurrency', 4)));
const PROBE_MS = Math.max(100, Number(arg('probe-ms', 500)));
const SPOOF = !flag('no-spoof');
const JSON_OUT = flag('json');
const SEED = Number(arg('seed', 7));
const MIX_RAW = String(arg('mix', '0.5:4,1.5:3,3:2,6:1'));
const LABEL = String(arg('label', ''));

// Allowlist, not a production blocklist: on the docker network the live container is one
// hostname away (`http://wordcloud`), and a typo must fail closed.
if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[?::1]?|wc-staging)(:\d+)?$/i.test(URL_)) {
  console.error(`✗ 拒绝：${URL_} 不在允许名单里（127.0.0.1 / localhost / wc-staging）。这个脚本只打本机或 staging 容器，不打线上。`);
  process.exit(2);
}

/* ---------- Deterministic random ---------- */
let seed = SEED >>> 0;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
};

/* ---------- Size mix ---------- */
/** [{ mb, weight }] from "0.5:4,1.5:3" or "0.5,1.5" (equal weights). */
const MIX = MIX_RAW.split(',').map((s) => {
  const [mb, w] = s.split(':');
  return { mb: Number(mb), weight: w === undefined ? 1 : Number(w) };
}).filter((m) => m.mb > 0 && m.weight > 0);
if (!MIX.length) { console.error('--mix 为空'); process.exit(2); }
const pickSize = () => {
  const total = MIX.reduce((a, m) => a + m.weight, 0);
  let r = rnd() * total;
  for (const m of MIX) { r -= m.weight; if (r <= 0) return m.mb; }
  return MIX[MIX.length - 1].mb;
};

/* ---------- Payloads: fixture lines up to the byte target, gzipped once per size ---------- */
const FIX = path.join(process.cwd(), 'fixtures');
if (!fs.existsSync(FIX)) { console.error('找不到 fixtures/：先跑 node tools/make-fixtures.mjs'); process.exit(2); }
const fixtureFiles = fs.readdirSync(FIX).filter((f) => f.endsWith('.jsonl'));
if (!fixtureFiles.length) { console.error('fixtures/ 里没有 .jsonl：先跑 node tools/make-fixtures.mjs'); process.exit(2); }
const seedLines = fixtureFiles.map((f) => fs.readFileSync(path.join(FIX, f), 'utf8').trim()).join('\n').split('\n');
const payloads = new Map();
/** { body: Buffer(gzip), jsonBytes, mb } for one size, built on first use. */
function payload(mb) {
  if (payloads.has(mb)) return payloads.get(mb);
  const target = mb * 1024 * 1024;
  const parts = [];
  let bytes = 0;
  for (let i = 0; bytes < target; i++) { const l = seedLines[i % seedLines.length]; parts.push(l); bytes += Buffer.byteLength(l) + 1; }
  const json = Buffer.from(JSON.stringify({ name: `storm-${mb}mb.jsonl`, content: parts.join('\n'), options: {} }));
  const p = { body: gzipSync(json, { level: 6 }), jsonBytes: json.length, mb };
  payloads.set(mb, p);
  return p;
}

/* ---------- One analysis request ---------- */
let ipCounter = 0;
const nextIp = () => { ipCounter++; return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`; };

/**
 * Fire one /api/analyze and measure it. Returns
 * { mb, status, outcome: 'done'|'503'|'429'|'error'|'other', ttfbMs, totalMs, serverMs, code }.
 * ttfb is upload + queue wait (the body is read before a slot is taken); serverMs is the
 * analysis time the server reports in its `done` event.
 */
async function analyze(mb, ip) {
  const p = payload(mb);
  const headers = { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' };
  if (ip) headers['cf-connecting-ip'] = ip;
  const t0 = performance.now();
  const rec = { mb, jsonBytes: p.jsonBytes, wireBytes: p.body.length, status: 0, outcome: 'error', ttfbMs: 0, totalMs: 0, serverMs: null, code: '' };
  try {
    const r = await fetch(`${URL_}/api/analyze`, { method: 'POST', headers, body: p.body });
    rec.ttfbMs = performance.now() - t0;
    rec.status = r.status;
    const text = await r.text();
    rec.totalMs = performance.now() - t0;
    if (r.status === 200) {
      const m = /event: done\ndata: (.*)\n/.exec(text);
      if (m) {
        rec.outcome = 'done';
        try { rec.serverMs = JSON.parse(m[1]).ms ?? null; } catch { /* keep null */ }
      } else {
        rec.outcome = 'error';
        const e = /event: error\ndata: (.*)\n/.exec(text);
        rec.code = e ? (JSON.parse(e[1]).code || 'sse_error') : 'no_done_event';
      }
    } else {
      rec.outcome = r.status === 503 ? '503' : r.status === 429 ? '429' : 'other';
      try { rec.code = JSON.parse(text).code || ''; } catch { rec.code = text.slice(0, 40); }
    }
  } catch (e) {
    rec.totalMs = performance.now() - t0;
    rec.code = e.cause?.code || e.message;
  }
  return rec;
}

/* ---------- Probe: landing page + health while the scenario runs ---------- */
const probe = { page: [], pageFail: 0, states: {}, maxBytes: new Set(), samples: 0 };
let probing = false;
async function probeOnce() {
  const t0 = performance.now();
  try {
    const r = await fetch(`${URL_}/`, { headers: { Accept: 'text/html' } });
    await r.arrayBuffer();
    if (r.status === 200) probe.page.push(performance.now() - t0); else probe.pageFail++;
  } catch { probe.pageFail++; }
  try {
    const h = await (await fetch(`${URL_}/api/health`)).json();
    probe.states[h.load] = (probe.states[h.load] || 0) + 1;
    probe.maxBytes.add(h.maxBytes);
  } catch { probe.states.unreachable = (probe.states.unreachable || 0) + 1; }
  probe.samples++;
}
async function probeLoop() {
  while (probing) {
    const t0 = performance.now();
    await probeOnce();
    const left = PROBE_MS - (performance.now() - t0);
    if (left > 0) await new Promise((r) => setTimeout(r, left));
  }
}

/* ---------- Scenarios ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

async function runCalibrate() {
  const ip = SPOOF ? nextIp() : undefined;
  for (const m of MIX) {
    const r = await analyze(m.mb, ip);
    results.push(r);
    if (!JSON_OUT) console.log(`  ${String(m.mb).padStart(4)} MB  ${r.outcome.padEnd(5)}${r.outcome === 'done' ? '' : ` [${r.status} ${r.code}]`} 首字节 ${r.ttfbMs.toFixed(0).padStart(6)} ms  服务端 ${String(r.serverMs ?? '-').padStart(6)} ms  总 ${r.totalMs.toFixed(0).padStart(6)} ms  线路 ${(r.wireBytes / 1024).toFixed(0)} KB`);
  }
}

async function runBurst() {
  const jobs = [];
  for (let i = 0; i < VISITORS; i++) {
    const delay = SPREAD_S * 1000 * rnd();
    const mb = pickSize();
    const ip = SPOOF ? nextIp() : undefined;
    jobs.push(sleep(delay).then(() => analyze(mb, ip)).then((r) => { r.startOffsetMs = delay; results.push(r); }));
  }
  await Promise.all(jobs);
}

async function runArrivals() {
  const jobs = [];
  const meanGapMs = 60_000 / RATE_PER_MIN;
  const end = performance.now() + DURATION_S * 1000;
  let t = performance.now();
  while (true) {
    // Exponential inter-arrival: Poisson process at RATE_PER_MIN
    t += -Math.log(1 - rnd()) * meanGapMs;
    if (t > end) break;
    const at = t;
    const mb = pickSize();
    const ip = SPOOF ? nextIp() : undefined;
    jobs.push(sleep(Math.max(0, at - performance.now())).then(() => analyze(mb, ip)).then((r) => { r.startOffsetMs = at; results.push(r); }));
  }
  await Promise.all(jobs);
}

async function runAbuse() {
  const ip = SPOOF ? nextIp() : undefined;
  const mb = MIX[0].mb;
  let sent = 0;
  async function worker() {
    while (sent < REQUESTS) { sent++; const r = await analyze(mb, ip); r.seq = sent; results.push(r); }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

/* ---------- Report ---------- */
const pct = (xs, p) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const stat = (xs) => ({ n: xs.length, p50: Math.round(pct(xs, 0.5)), p95: Math.round(pct(xs, 0.95)), max: Math.round(xs.length ? Math.max(...xs) : 0) });
const fmtStat = (s) => s.n ? `p50 ${s.p50} · p95 ${s.p95} · max ${s.max} ms` : '—';

/* ---------- Main ---------- */
// Warm the payloads before the clock starts: gzipping 6 MB of JSON takes a while and
// must not be counted as "wait" for the first visitor.
for (const m of MIX) payload(m.mb);
// One request before the scenario so the server's own warm-up is not part of the test
// (the first analysis after a start loads the blocklist and JIT-compiles the tokenizer).
if (SCENARIO !== 'calibrate') await analyze(MIX[0].mb, SPOOF ? nextIp() : undefined);

if (!JSON_OUT) {
  const mixText = MIX.map((m) => `${m.mb} MB×${m.weight}`).join(' / ');
  const what = SCENARIO === 'burst' ? `${VISITORS} 人在 ${SPREAD_S} s 内同时点`
    : SCENARIO === 'arrivals' ? `每分钟 ${RATE_PER_MIN} 人到达，持续 ${DURATION_S} s`
      : SCENARIO === 'abuse' ? `单 IP 连发 ${REQUESTS} 次、并发 ${CONCURRENCY}`
        : '逐档串行';
  console.log(`\n▶ ${LABEL || SCENARIO}  ${what}  语料 ${mixText}  ${SPOOF ? '每人独立 IP' : '同一 IP'}  → ${URL_}`);
}

probing = SCENARIO !== 'calibrate';
const probeTask = probing ? probeLoop() : Promise.resolve();
const started = performance.now();
if (SCENARIO === 'calibrate') await runCalibrate();
else if (SCENARIO === 'burst') await runBurst();
else if (SCENARIO === 'arrivals') await runArrivals();
else if (SCENARIO === 'abuse') await runAbuse();
else { console.error(`未知场景 ${SCENARIO}`); process.exit(2); }
const wallMs = performance.now() - started;
probing = false;
await probeTask;

// The automatic "the local edition is instant" notice appears while the load is `full`.
let noticeAfter = null;
if (SCENARIO !== 'calibrate') { try { noticeAfter = await (await fetch(`${URL_}/api/notice`)).json(); } catch { /* unreachable */ } }

const done = results.filter((r) => r.outcome === 'done');
const n503 = results.filter((r) => r.outcome === '503').length;
const n429 = results.filter((r) => r.outcome === '429').length;
const nOther = results.length - done.length - n503 - n429;
const wait = stat(done.map((r) => r.ttfbMs));
const server = stat(done.map((r) => r.serverMs).filter((x) => x != null));
const total = stat(done.map((r) => r.totalMs));
const page = stat(probe.page);
const first429 = results.find((r) => r.outcome === '429');
const perMb = {};
for (const r of done) { (perMb[r.mb] ||= []).push(r.serverMs ?? r.totalMs - r.ttfbMs); }
const perMbText = Object.keys(perMb).sort((a, b) => a - b).map((k) => `${k} MB→${Math.round(pct(perMb[k], 0.5))} ms`).join(' · ');

const summary = {
  label: LABEL || SCENARIO, scenario: SCENARIO, url: URL_, visitors: SCENARIO === 'burst' ? VISITORS : undefined,
  rate: SCENARIO === 'arrivals' ? RATE_PER_MIN : undefined, duration: SCENARIO === 'arrivals' ? DURATION_S : undefined,
  requests: results.length, ok: done.length, n503, n429, other: nOther,
  waitMs: wait, serverMs: server, totalMs: total, perMbServerMs: Object.fromEntries(Object.entries(perMb).map(([k, v]) => [k, Math.round(pct(v, 0.5))])),
  page: { ...page, fail: probe.pageFail, samples: probe.samples }, states: probe.states, maxBytes: [...probe.maxBytes],
  notice: noticeAfter?.id ? { auto: !!noticeAfter.auto, level: noticeAfter.level } : null,
  first429At: first429 ? first429.seq : null, wallS: Math.round(wallMs / 100) / 10,
  throughputPerMin: Math.round((done.length / (wallMs / 60_000)) * 10) / 10,
};

if (flag('dump') && !JSON_OUT) {
  // One line per request in first-byte order: shows whether the queue really filled
  // (a staircase of waits) or the generator throttled itself (waits all alike).
  console.log('  #   到达   首字节    服务端     总计   体积  结果');
  [...results].sort((a, b) => (a.startOffsetMs ?? 0) + a.ttfbMs - ((b.startOffsetMs ?? 0) + b.ttfbMs)).forEach((r, i) =>
    console.log(`  ${String(i + 1).padStart(2)} ${String(Math.round(r.startOffsetMs ?? 0)).padStart(6)} ${String(Math.round(r.ttfbMs)).padStart(8)} ${String(r.serverMs ?? '-').padStart(9)} ${String(Math.round(r.totalMs)).padStart(8)}  ${String(r.mb).padStart(4)}  ${r.outcome}${r.code ? ` ${r.code}` : ''}`));
}
if (JSON_OUT) console.log(JSON.stringify(summary));
else {
  console.log(`
结果        ${results.length} 次：成功 ${done.length} · 503 ${n503} · 429 ${n429} · 其他 ${nOther}${first429 ? `（第 ${first429.seq} 次开始 429）` : ''}
等待        ${fmtStat(wait)}   （上传 + 排队，到首字节）
服务端      ${fmtStat(server)}   （分析本身；${perMbText || '—'}）
端到端      ${fmtStat(total)}
首页探测    ${fmtStat(page)}   （${probe.samples} 次，失败 ${probe.pageFail}）
health      ${Object.entries(probe.states).map(([k, v]) => `${k}×${v}`).join(' · ') || '—'}   maxBytes ${[...probe.maxBytes].map((b) => `${(b / 1048576).toFixed(0)} MB`).join('/') || '—'}
总耗时      ${summary.wallS} s · 吞吐 ${summary.throughputPerMin} 次/分钟
公告        ${noticeAfter?.id ? `${noticeAfter.auto ? '自动' : '站长'}公告已挂出（${noticeAfter.level}）` : '无'}`);
  const verdict = n429 > 0
    ? `结论：${n429} 次被 429 挡回（每 IP 每小时上限${first429 ? `，第 ${first429.seq} 次开始` : ''}）；503 ${n503} 个。`
    : n503 > 0
    ? `结论：${n503} 人被 503 挡回（同时在飞 > 并发 + 队列）；其余人的最长等待 ${wait.max} ms。`
    : nOther > 0
      ? `结论：有 ${nOther} 个非预期失败，先看服务端日志。`
      : wait.p95 > 8000
        ? `结论：没人被拒，但 p95 等待 ${wait.p95} ms 已超过 8 s——第十个人会以为卡住了。`
        : `结论：全部成功，p95 等待 ${wait.p95} ms，首页探测 p95 ${page.p95} ms。`;
  console.log(verdict + '\n');
}

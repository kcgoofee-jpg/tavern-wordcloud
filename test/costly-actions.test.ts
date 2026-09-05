/**
 * Rules for long-running / paid / irreversible actions:
 *   1. paid actions are triggered explicitly, never as a side effect of a switch
 *   2. a running action can be stopped
 *   3. changes that do not affect the result never re-spend (the cache must work)
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
// The job runtime, not the thread wiring: `analyze.worker.ts` and `sameThread.ts` both
// just hand this handler somewhere to post to.
const worker = read('src/worker/handler.ts');
const app = read('src/ui/App.tsx');
const progress = read('src/ui/Progress.tsx');

describe('paid actions are explicit', () => {
  it('automatic recomputes never pass runAi', () => {
    // The analyze call inside the effect must not pass runAi
    const auto = /void send\(\{ kind: 'analyze', options(?:, relay: [^}]*)? \}\)/.test(app);
    expect(auto).toBe(true);
    // The explicit call must pass runAi: true
    expect(app).toMatch(/kind: 'analyze', options: o, runAi: true/);
  });

  it('without runAi the worker uses the cache only', () => {
    // The request branch requires both aiReady and req.runAi
    expect(worker).toMatch(/else if \(aiReady && req\.runAi\)/);
  });

  it('the cache fingerprint covers only what changes segmentation', () => {
    const sig = worker.slice(worker.indexOf('function signature'), worker.indexOf('function signature') + 500);
    // Must be in the fingerprint: text shape, chunk size, model, endpoint
    for (const k of ['chunkChars', 'model', 'endpoint']) expect(sig).toContain(k);
    // Must not be in the fingerprint: display options
    for (const k of ['maxWords', 'minCount', 'kinds', 'rotateRatio']) expect(sig).not.toContain(k);
  });
});

describe('running actions can be stopped', () => {
  /** Pins behaviour (an abort controller exists, cancel calls it, the signal is passed down), not variable names. */
  it('the worker handles cancel and aborts', () => {
    expect(worker).toMatch(/kind: 'cancel'/);
    // cancel calls abort()
    expect(worker).toMatch(/\.abort\(\)/);
    expect(worker).toMatch(/new AbortController\(\)/);
  });

  it('the abort signal reaches every long call', () => {
    // The signal must be passed down on both paths: tokenization and curation
    const signals = worker.match(/\.signal/g) ?? [];
    expect(signals.length).toBeGreaterThanOrEqual(2);
    expect(worker).toMatch(/segmentWithAi\([\s\S]*?\.signal/);
    expect(worker).toMatch(/curateWords\([\s\S]*?\.signal/);
  });

  it('a stop button is shown during long jobs', () => {
    expect(progress).toMatch(/onCancel/);
    expect(app).toMatch(/onCancel=\{progress\?\.phase === 'ai'/);
  });
});

describe('long jobs show activity', () => {
  it('the ai phase is reported at start', () => {
    // The stop button and log are shown for phase === 'ai'; the phase must be reported when the run starts
    const i = worker.indexOf('for (let i = 0; i < texts.length; i++)');
    const before = worker.slice(Math.max(0, i - 900), i);
    expect(before).toMatch(/phase: 'ai', done: 0, total: totalChunks/);
    // The first log entry is written at start
    expect(before).toMatch(/key: zh\('开始：/);
  });

  it('LLM tokenization reports per chunk', () => {
    // 按消息报的话，一条长消息切成上百块时圈一动不动
    expect(worker).toMatch(/大模型分词 \{done\}\/\{total\} 块/);
  });

  it('reports speed and estimated remaining time', () => {
    expect(worker).toMatch(/块\/秒/);
    expect(worker).toMatch(/约剩/);
  });

  it('fallback chunks are reported', () => {
    // 不报的话结果里混着本地分词，而用户以为整份都是模型切的
    expect(worker).toMatch(/退回本地/);
  });
});

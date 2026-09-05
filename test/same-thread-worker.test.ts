/**
 * The single-file build runs the analyze handler on the UI thread instead of shipping a
 * second copy of core inside an inlined worker blob (see `vite.config.ts`). These tests pin
 * the parts that make that swap safe: the message contract, the one-`job` progress stream,
 * and that a run can still be stopped.
 */
import { describe, expect, it } from 'vitest';
import SameThreadWorker from '../src/worker/sameThread';
import type { WorkerRequestBody, WorkerResponse, WorkerResult } from '../src/worker/handler';
import { DEFAULT_ANALYZE_OPTIONS } from '../src/core/analyzeOptions';

const CHAT = [
  JSON.stringify({ user_name: '我', character_name: '沈砚秋', chat_metadata: {} }),
  // Each line differs: identical lines are stripped as template scaffolding, which would
  // leave nothing to count.
  ...Array.from({ length: 40 }, (_, i) => JSON.stringify({
    name: i % 2 ? '沈砚秋' : '我',
    is_user: i % 2 === 0,
    mes: `沈砚秋把补充条款递过去，第${i}条写着否决权，举牌线已经到了位置。`,
  })),
].join('\n');

const FILES = [{ name: '沈砚秋 - 2026-01-01.jsonl', content: CHAT }];

/** Drives one worker and records every message it posts, replies and progress alike. */
function open() {
  const w = new SameThreadWorker();
  const seen: WorkerResponse[] = [];
  const waiting = new Map<number, (r: WorkerResult) => void>();
  w.onmessage = (e) => {
    seen.push(e.data);
    if (!('progress' in e.data && e.data.progress)) {
      waiting.get(e.data.id)?.(e.data as WorkerResult);
      waiting.delete(e.data.id);
    }
  };
  let id = 0;
  const send = (req: WorkerRequestBody) => new Promise<WorkerResult>((resolve) => {
    const n = ++id;
    waiting.set(n, resolve);
    w.postMessage({ ...req, id: n });
  });
  return { w, seen, send };
}

const progress = (seen: WorkerResponse[]) =>
  seen.filter((m): m is Extract<WorkerResponse, { progress: true }> => 'progress' in m && !!m.progress);

describe('same-thread analyze handler (single-file build)', () => {
  it('answers load and analyze with the same shapes a worker does', async () => {
    const { seen, send } = open();

    const loaded = await send({ kind: 'load', files: FILES });
    expect(loaded.ok && loaded.kind === 'load' && loaded.fileCount).toBe(1);

    const res = await send({ kind: 'analyze', options: DEFAULT_ANALYZE_OPTIONS });
    expect(res.ok).toBe(true);
    if (!res.ok || res.kind !== 'analyze') throw new Error('expected an analysis');
    expect(res.result.messageCount).toBeGreaterThan(0);
    expect(res.result.allWords.length).toBeGreaterThan(0);

    // One progress stream with the worker's phases, ending on a completed tokenize tick.
    const p = progress(seen);
    expect(p.length).toBeGreaterThan(0);
    expect(new Set(p.map((x) => x.phase))).toContain('parse');
    expect(p.every((x) => x.id === 2)).toBe(true);
    expect(p[p.length - 1]).toMatchObject({ phase: 'tokenize', done: 1, total: 1 });
  });

  it('never delivers a reply synchronously from postMessage', () => {
    const { w, seen } = open();
    w.postMessage({ kind: 'load', files: FILES, id: 1 });
    expect(seen).toHaveLength(0);
  });

  it('yields to the event loop, so a queued message is handled mid-run', async () => {
    const { send } = open();
    await send({ kind: 'load', files: FILES });

    let ticked = false;
    const timer = setInterval(() => { ticked = true; }, 0);
    await send({ kind: 'analyze', options: DEFAULT_ANALYZE_OPTIONS });
    clearInterval(timer);
    // A timer that fired during the analysis is what keeps the stop button clickable.
    expect(ticked).toBe(true);
  });

  it('terminate stops delivery', async () => {
    const { w, seen, send } = open();
    await send({ kind: 'load', files: FILES });
    const before = seen.length;
    w.terminate();
    w.postMessage({ kind: 'analyze', options: DEFAULT_ANALYZE_OPTIONS, id: 99 });
    await new Promise((r) => { setTimeout(r, 30); });
    expect(seen.length).toBe(before);
  });
});

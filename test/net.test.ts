/**
 * Upload progress on the server route. A 5 MB file used to show 0% for the whole
 * upload because `fetch` reports nothing while a body is being sent; both paths
 * here must produce a rising `upload` sequence and hand over to `parse`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeOnServer, makeSSEParser, type ServerProgress } from '../src/net/server';
import { toZh } from '../src/core/zh';

const RESULT = { words: [], messageCount: 1 };
const SSE = [
  'event: progress',
  `data: ${JSON.stringify({ phase: 'tokenize', done: 1, total: 2, label: 'x' })}`,
  '',
  'event: done',
  `data: ${JSON.stringify({ result: RESULT })}`,
  '',
  '',
].join('\n');

const bigFile = { name: 'a.jsonl', content: 'x'.repeat(400_000) };
const opts = {} as never;

afterEach(() => { vi.unstubAllGlobals(); });

const phases = (seen: ServerProgress[]) => seen.map((p) => p.phase);

describe('makeSSEParser', () => {
  it('reassembles a data: line split across pushes', () => {
    const got: Array<[string, unknown]> = [];
    const push = makeSSEParser((e, d) => got.push([e, d]));
    push('event: progress\nda');
    push('ta: {"done":1');
    push(',"total":2}\n');
    expect(got).toEqual([['progress', { done: 1, total: 2 }]]);
  });
});

describe('analyzeOnServer — streamed request body (Chromium)', () => {
  it('reports rising upload bytes, then parse, then the server phases', async () => {
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      // Drain the streamed request body: this is what drives the upload callbacks
      const reader = (init.body as ReadableStream<Uint8Array>).getReader();
      for (;;) { const { done } = await reader.read(); if (done) break; }
      return new Response(SSE, { status: 200 });
    });
    const seen: ServerProgress[] = [];
    const out = await analyzeOnServer(bigFile, opts, (p) => seen.push(p), undefined, true);
    expect(out).toEqual(RESULT);

    const ups = seen.filter((p) => p.phase === 'upload');
    expect(ups.length).toBeGreaterThan(1);
    for (let i = 1; i < ups.length; i++) {
      expect(ups[i].done!).toBeGreaterThan(ups[i - 1].done!);
      expect(ups[i].total).toBe(ups[0].total);
    }
    expect(toZh(ups[0].label!)).toMatch(/正在上传 .* MB/);
    // Upload finished → "the server has it" before the first server event
    expect(phases(seen)).toContain('parse');
    expect(phases(seen).at(-1)).toBe('tokenize');
  });

  it('propagates a coded error response', async () => {
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
      const reader = (init.body as ReadableStream<Uint8Array>).getReader();
      for (;;) { const { done } = await reader.read(); if (done) break; }
      return new Response(JSON.stringify({ error: 'nope', code: 'TOO_BIG' }), { status: 413 });
    });
    await expect(analyzeOnServer(bigFile, opts, () => {}, undefined, true))
      .rejects.toMatchObject({ code: 'TOO_BIG' });
  });
});

/** Minimal XMLHttpRequest that replays an upload and then an SSE body in two chunks. */
class FakeXHR {
  static last: FakeXHR | null = null;
  upload = { onprogress: null as ((e: ProgressEvent) => void) | null, onload: null as (() => void) | null };
  onprogress: (() => void) | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 200;
  responseText = '';
  aborted = false;
  body = SSE;
  open() { /* noop */ }
  setRequestHeader() { /* noop */ }
  abort() { this.aborted = true; this.onabort?.(); }
  send(bytes: Uint8Array) {
    FakeXHR.last = this;
    const total = bytes.byteLength;
    queueMicrotask(() => {
      if (this.aborted) return;
      for (const f of [0.25, 0.5, 0.75, 1]) {
        this.upload.onprogress?.({ loaded: Math.round(total * f), total } as ProgressEvent);
      }
      this.upload.onload?.();
      // Response arrives in two slices, so the parser has to buffer
      const cut = Math.floor(this.body.length / 2);
      this.responseText = this.body.slice(0, cut);
      this.onprogress?.();
      this.responseText = this.body;
      this.onload?.();
    });
  }
}

describe('analyzeOnServer — XMLHttpRequest fallback (Safari, Firefox)', () => {
  it('reports upload progress from upload.onprogress and parses the response text', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    const seen: ServerProgress[] = [];
    const out = await analyzeOnServer(bigFile, opts, (p) => seen.push(p), undefined, false);
    expect(out).toEqual(RESULT);
    const ups = seen.filter((p) => p.phase === 'upload');
    expect(ups.length).toBe(3);            // the fourth report is loaded === total → parse
    expect(ups.map((p) => p.done)).toEqual([...ups.map((p) => p.done)].sort((a, b) => a! - b!));
    expect(phases(seen)).toContain('parse');
    expect(phases(seen).at(-1)).toBe('tokenize');
  });

  it('an AbortSignal aborts the request', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    const ac = new AbortController();
    const p = analyzeOnServer(bigFile, opts, () => { ac.abort(); }, ac.signal, false);
    await expect(p).rejects.toThrow();
    expect(FakeXHR.last?.aborted).toBe(true);
  });
});

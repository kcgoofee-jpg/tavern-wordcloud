/**
 * Upload progress on the server route. A 5 MB file used to show 0% for the whole
 * upload because `fetch` reports nothing while a body is being sent; both paths
 * here must produce a rising `upload` sequence and hand over to `parse`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeOnServer, makeSSEParser, optionsForServer, serverTakesOneFile, shouldAnalyzeOnServer, type ServerProgress } from '../src/net/server';
import { DEFAULT_ANALYZE_OPTIONS } from '../src/core/analyze';
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

// Random (not repeated or cyclic) so gzip cannot shrink it below one upload
// chunk — the streamed-body test below needs several progress reports.
const bigFile = {
  name: 'a.jsonl',
  content: require('node:crypto').randomBytes(300_000).toString('base64'),
};
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
  sentBytes: number | null = null;
  open() { /* noop */ }
  setRequestHeader() { /* noop */ }
  abort() { this.aborted = true; this.onabort?.(); }
  send(bytes: Uint8Array) {
    FakeXHR.last = this;
    this.sentBytes = bytes.byteLength;
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

describe('gzip request compression', () => {
  // Very compressible on purpose: the point of these tests is to see the body shrink.
  const compressible = { name: 'a.jsonl', content: '{"mes":"甲乙丙"}\n'.repeat(20_000) };
  const plainBytes = () => new TextEncoder().encode(JSON.stringify({
    ...compressible,
    options: optionsForServer(opts as unknown as typeof DEFAULT_ANALYZE_OPTIONS),
  })).byteLength;

  it('streamed path: sends Content-Encoding: gzip and a smaller body when CompressionStream exists', async () => {
    let seenHeaders: Headers | undefined;
    let sentBytes = 0;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      seenHeaders = new Headers(init.headers);
      const reader = (init.body as ReadableStream<Uint8Array>).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        sentBytes += value!.byteLength;
      }
      return new Response(SSE, { status: 200 });
    });
    await analyzeOnServer(compressible, opts, () => {}, undefined, true);
    expect(seenHeaders?.get('Content-Encoding')).toBe('gzip');
    expect(sentBytes).toBeLessThan(plainBytes());
  });

  it('XHR path: sets Content-Encoding: gzip and sends a smaller body when CompressionStream exists', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    let encodingHeader: string | undefined;
    const orig = FakeXHR.prototype.setRequestHeader;
    FakeXHR.prototype.setRequestHeader = function (name: string, value: string) {
      if (name === 'Content-Encoding') encodingHeader = value;
      return orig.call(this, name, value);
    };
    try {
      await analyzeOnServer(compressible, opts, () => {}, undefined, false);
    } finally {
      FakeXHR.prototype.setRequestHeader = orig;
    }
    expect(encodingHeader).toBe('gzip');
    expect(FakeXHR.last!.sentBytes!).toBeLessThan(plainBytes());
  });

  it('falls back to a plain body with no Content-Encoding when CompressionStream is unavailable', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    let seenHeaders: Headers | undefined;
    let sentBytes = 0;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      seenHeaders = new Headers(init.headers);
      const reader = (init.body as ReadableStream<Uint8Array>).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        sentBytes += value!.byteLength;
      }
      return new Response(SSE, { status: 200 });
    });
    await analyzeOnServer(compressible, opts, () => {}, undefined, true);
    expect(seenHeaders?.has('Content-Encoding')).toBe(false);
    expect(sentBytes).toBe(plainBytes());
  });
});

describe('serverTakesOneFile', () => {
  it('the current /api/analyze body is one chat; several files stay local', () => {
    expect(serverTakesOneFile(0)).toBe(false);
    expect(serverTakesOneFile(1)).toBe(true);
    expect(serverTakesOneFile(2)).toBe(false);
  });
});

describe('shouldAnalyzeOnServer', () => {
  it('refuses a zip, extra files, and regex scripts — those stay in the worker', () => {
    expect(shouldAnalyzeOnServer({ fileCount: 1 })).toBe(true);
    expect(shouldAnalyzeOnServer({ fileCount: 2 })).toBe(false);
    expect(shouldAnalyzeOnServer({ fileCount: 1, fromZip: true })).toBe(false);
    expect(shouldAnalyzeOnServer({ fileCount: 1, hasCustomRules: true })).toBe(false);
  });
});

describe('optionsForServer', () => {
  it('strips the LLM key and regex scripts so they never leave the browser', () => {
    const sent = optionsForServer({
      ...DEFAULT_ANALYZE_OPTIONS,
      ai: { ...DEFAULT_ANALYZE_OPTIONS.ai, enabled: true, apiKey: 'sk-secret', endpoint: 'https://x/v1', model: 'm' },
      clean: { ...DEFAULT_ANALYZE_OPTIONS.clean, customRules: [{ find: '(a+)+$', flags: 'g', replace: '' }] },
    });
    expect(sent.ai.apiKey).toBe('');
    expect(sent.ai.enabled).toBe(false);
    expect(sent.clean.customRules).toBeUndefined();
    const json = JSON.stringify(sent);
    expect(json).not.toContain('sk-secret');
    expect(json).not.toContain('(a+)+$');
  });
});

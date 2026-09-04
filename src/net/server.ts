/**
 * Server-side processing. Produces the same progress / log / stream shapes as
 * analyze.worker.ts so the UI has a single long-task component. The only
 * difference is that text leaves the machine.
 */
import type { AnalyzeOptions } from '../core/analyze';
import { DEFAULT_AI_CONFIG } from '../core/aiTokenizer';
import type { AnalysisResult } from '../core/types';
import type { UserText } from '../core/zh';
import { zh } from '../core/zh';

export interface ServerProgress {
  phase: 'upload' | 'parse' | 'tokenize' | 'curate';
  done?: number;
  total?: number;
  label?: UserText;
  detail?: UserText;
  stream?: string;
  note?: UserText;
  /** Model reasoning, separate from stream (see core/curate.ts) */
  thinking?: string;
}

/**
 * Error from a coded server response. `code` maps to a translated message in
 * core/errors.ts (SERVER_CODES); the Chinese message is the fallback.
 */
export class ServerError extends Error {
  readonly code?: string;
  readonly params?: Record<string, string | number>;
  constructor(message: string, code?: string, params?: Record<string, string | number>) {
    super(message);
    this.code = code;
    this.params = params;
  }
}

/** Error body of a failed response: { error, code?, params? }. */
interface ErrBody { error?: string; code?: string; params?: Record<string, string | number> }

const errFrom = async (res: Response): Promise<ServerError> => {
  const b = (await res.json().catch(() => null)) as ErrBody | null;
  return new ServerError(b?.error ?? `${zh('服务器返回')} ${res.status}`, b?.code, b?.params);
};

export interface ServerHealth {
  ok: boolean;
  /** Whether the server offers the CORS relay for the visitor's own endpoint */
  relay: boolean;
  /** Current server load. Older servers do not send it; treat a missing value as `ok`. */
  load?: 'ok' | 'busy' | 'full';
  /** Build identifier that changes on deploy. Older servers do not send it. */
  version?: string;
}

/** Whether a server exists behind this page. Static hosting has none. */
export async function probeServer(signal?: AbortSignal): Promise<ServerHealth | null> {
  try {
    const r = await fetch('/api/health', { signal });
    if (!r.ok) return null;
    return (await r.json()) as ServerHealth;
  } catch {
    return null;   // Static hosting, offline or blocked all count as no server
  }
}

/** A site notice published from the admin page. Plain text; the server strips HTML before storing it. */
export interface SiteNotice {
  id: string;
  text: string;
  level: 'info' | 'warn';
  /** Publication time, epoch ms. */
  updatedAt: number;
}

/**
 * The current site notice, or null when there is none. The single-file build has no
 * server behind it, so the request fails and the bell never appears.
 */
export async function fetchNotice(signal?: AbortSignal): Promise<SiteNotice | null> {
  try {
    const r = await fetch('/api/notice', { signal });
    if (!r.ok) return null;
    const b = (await r.json()) as Partial<SiteNotice> | null;
    if (!b?.id || !b.text) return null;
    return { id: String(b.id), text: String(b.text), level: b.level === 'warn' ? 'warn' : 'info', updatedAt: Number(b.updatedAt) || 0 };
  } catch {
    return null;   // Static hosting, offline or blocked all count as no notice
  }
}

/**
 * Incremental SSE parser. A buffer is kept because a `data:` line may be split
 * across chunks; `push` may be called with any slicing of the stream.
 */
export function makeSSEParser(on: (event: string, data: unknown) => void): (text: string) => void {
  let buf = '';
  let event = 'message';
  return (text: string) => {
    buf += text;
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('event:')) { event = line.slice(6).trim(); continue; }
      if (!line.startsWith('data:')) continue;
      try { on(event, JSON.parse(line.slice(5))); } catch { /* partial; completed on the next chunk */ }
    }
  };
}

/** Read an SSE stream off a fetch Response. */
async function readSSE(
  res: Response,
  on: (event: string, data: unknown) => void,
): Promise<void> {
  if (!res.body) throw new ServerError(zh('服务器没有返回流'));
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const push = makeSSEParser(on);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    push(dec.decode(value, { stream: true }));
  }
}

/** Bytes pushed per chunk when streaming the request body. 64 KB keeps a 5 MB
 * upload at ~80 progress reports without adding meaningful overhead. */
const UPLOAD_CHUNK = 64 * 1024;

export type UploadProgress = (loaded: number, total: number) => void;

/**
 * Whether this browser can send a `ReadableStream` request body. Chrome and Edge
 * can (they require `duplex: 'half'`, and reading that getter is the detection);
 * Safari and Firefox cannot, and fall back to XMLHttpRequest.
 */
export function supportsRequestStreams(): boolean {
  if (typeof Request === 'undefined' || typeof ReadableStream === 'undefined') return false;
  let sawDuplex = false;
  try {
    const body = new ReadableStream();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const r = new Request('https://x.invalid/', {
      method: 'POST',
      body,
      // The getter only runs if the implementation looks for `duplex`.
      get duplex() { sawDuplex = true; return 'half'; },
    } as RequestInit);
    void r;
  } catch { return false; }
  return sawDuplex;
}

/**
 * POST a JSON body, reporting upload progress, and parse the SSE response.
 *
 * Two paths, because one request cannot be half fetch and half XHR:
 *   - fetch + streamed request body (Chromium): the body is pushed in chunks and
 *     the response is read as a real stream, so server events arrive live.
 *   - XMLHttpRequest (Safari, Firefox): `upload.onprogress` gives real upload
 *     bytes, and `onprogress` re-reads `responseText`, feeding only the newly
 *     appended text to the same SSE parser.
 */
async function postSSE(
  path: string,
  body: unknown,
  onUpload: UploadProgress,
  onEvent: (event: string, data: unknown) => void,
  signal?: AbortSignal,
  useStream = supportsRequestStreams(),
): Promise<void> {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(body));
  const gzipped = await maybeGzip(jsonBytes);
  // Progress is reported against what actually goes over the wire, so the bar
  // doesn't jump when compression finishes ahead of the upload.
  const bytes = gzipped ?? jsonBytes;
  const total = bytes.byteLength;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (gzipped) headers['Content-Encoding'] = 'gzip';

  if (useStream) {
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent >= total) { onUpload(total, total); c.close(); return; }
        const end = Math.min(total, sent + UPLOAD_CHUNK);
        c.enqueue(bytes.subarray(sent, end));
        sent = end;
        onUpload(sent, total);
      },
    });
    const res = await fetch(path, {
      method: 'POST', signal,
      headers,
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    if (!res.ok) throw await errFrom(res);
    await readSSE(res, onEvent);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const push = makeSSEParser(onEvent);
    let read = 0;
    let failed: unknown = null;
    const drain = () => {
      const txt = xhr.responseText ?? '';
      if (txt.length <= read) return;
      const next = txt.slice(read);
      read = txt.length;
      try { push(next); } catch (e) { failed = e; xhr.abort(); }
    };
    const onAbort = () => xhr.abort();
    xhr.open('POST', path);
    xhr.setRequestHeader('Content-Type', 'application/json');
    if (gzipped) xhr.setRequestHeader('Content-Encoding', 'gzip');
    xhr.upload.onprogress = (e: ProgressEvent) => onUpload(e.loaded, e.total || total);
    xhr.upload.onload = () => onUpload(total, total);
    xhr.onprogress = drain;
    xhr.onerror = () => reject(new ServerError(zh('服务器没有返回流')));
    xhr.onabort = () => reject(failed ?? new DOMException('Aborted', 'AbortError'));
    xhr.onload = () => {
      signal?.removeEventListener('abort', onAbort);
      if (xhr.status < 200 || xhr.status >= 300) {
        let b: ErrBody | null = null;
        try { b = JSON.parse(xhr.responseText) as ErrBody; } catch { /* not JSON */ }
        reject(new ServerError(b?.error ?? `${zh('服务器返回')} ${xhr.status}`, b?.code, b?.params));
        return;
      }
      drain();
      if (failed) reject(failed); else resolve();
    };
    if (signal) {
      if (signal.aborted) { xhr.abort(); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    xhr.send(bytes as unknown as ArrayBuffer);
  });
}

/**
 * Whether this browser can gzip a request body before sending it. Chrome,
 * Safari and Firefox all have `CompressionStream`; when it is missing the
 * request goes out uncompressed instead of failing.
 */
export function supportsGzipUpload(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof Blob !== 'undefined' && typeof Response !== 'undefined';
}

/** Gzip `bytes` with `CompressionStream`, or return null if unsupported/failed (caller sends plain). */
async function maybeGzip(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (!supportsGzipUpload()) return null;
  try {
    const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

/** Bytes as MB with one decimal, for the upload label. */
const mb = (n: number): string => (n / (1024 * 1024)).toFixed(1);

/**
 * `/api/analyze` currently accepts one `{ name, content }` and cannot apply
 * browser-only extras (regex scripts, zip world-info keys). Those stay in the
 * worker so the result matches what the local path produces.
 */
export const serverTakesOneFile = (n: number): boolean => n === 1;

export function shouldAnalyzeOnServer(p: {
  fileCount: number;
  hasCustomRules?: boolean;
  fromZip?: boolean;
}): boolean {
  return p.fileCount === 1 && !p.hasCustomRules && !p.fromZip;
}

/**
 * Drop the visitor's LLM key and regex scripts before the body leaves the
 * browser. The server disables AI anyway; regex is applied only in the worker
 * (a hostile `find` would otherwise run in the Node process).
 */
export function optionsForServer(o: AnalyzeOptions): AnalyzeOptions {
  return {
    ...o,
    ai: { ...DEFAULT_AI_CONFIG, enabled: false },
    clean: { ...o.clean, customRules: undefined },
  };
}

/** Word counts computed on the server; same result shape as local */
export async function analyzeOnServer(
  file: { name: string; content: string },
  options: AnalyzeOptions,
  onProgress: (p: ServerProgress) => void,
  signal?: AbortSignal,
  useStream?: boolean,
): Promise<AnalysisResult> {
  let out: AnalysisResult | null = null;
  let sawServerEvent = false;
  const t0 = Date.now();

  const onUpload: UploadProgress = (loaded, total) => {
    if (sawServerEvent) return;
    if (loaded >= total) {
      // Upload finished but the server has not spoken yet: say what is happening
      // instead of parking the ring at the top of the upload band.
      onProgress({ phase: 'parse', done: 0, total: 1, label: zh('服务器收到了，正在解析') });
      return;
    }
    const secs = (Date.now() - t0) / 1000;
    const left = secs > 0.4 && loaded > 0
      ? Math.max(1, Math.round(((total - loaded) / (loaded / secs)))) : 0;
    onProgress({
      phase: 'upload', done: loaded, total,
      label: { key: zh('正在上传 {a}/{b} MB'), params: { a: mb(loaded), b: mb(total) } },
      detail: left
        ? { key: zh('{a}/{b} MB · 约 {s} 秒'), params: { a: mb(loaded), b: mb(total), s: left } }
        : undefined,
    });
  };

  await postSSE('/api/analyze', { ...file, options: optionsForServer(options) }, onUpload, (ev, d) => {
    if (ev === 'progress') {
      sawServerEvent = true;
      // The server sends the real phase; 'parse' is only the fallback when it omits one
      const x = d as Partial<ServerProgress>;
      onProgress({ ...x, phase: x.phase ?? 'parse' } as ServerProgress);
    } else if (ev === 'done') { sawServerEvent = true; out = (d as { result: AnalysisResult }).result; }
    else if (ev === 'failed') { const x = d as ErrBody & { error: string }; throw new ServerError(x.error, x.code, x.params); }
  }, signal, useStream);

  if (!out) throw new ServerError(zh('服务器没有返回结果'));
  return out;
}

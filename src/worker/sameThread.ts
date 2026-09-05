/**
 * Same-thread stand-in for the analyze worker, used by the single-file build only
 * (`vite.config.ts` resolves `analyze.worker?worker&inline` here when `mode === 'single'`).
 *
 * Why: `?worker&inline` embeds a separately minified copy of core as a string literal —
 * 105 KB of escaped source, ~54 KB gzip, most of which the page already knows how to say.
 * Running the identical handler here keeps one copy.
 *
 * What must not change, and does not: the handler is the same code, so there is still exactly
 * one `job` with one `AbortController`, one progress stream and one log. Cancellation still
 * works because every long stage awaits `yieldFn`, which is a macrotask — a `cancel` posted
 * meanwhile is delivered between two batches, and the same yields keep the UI painting.
 */
import { createHandler, type WorkerRequest, type WorkerResponse } from './handler';

/** The slice of `Worker` that `useAnalyzeWorker` actually uses. */
export interface WorkerLike {
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  postMessage(msg: unknown): void;
  terminate(): void;
}

/** A macrotask, so a queued `postMessage` (notably `cancel`) runs between two batches. */
const tick = () => new Promise<void>((r) => { setTimeout(r, 0); });

export default class SameThreadWorker implements WorkerLike {
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((e: { message?: string }) => void) | null = null;

  /** After `terminate()` nothing more is delivered, matching a real worker. */
  private dead = false;
  private readonly handle = createHandler((msg) => {
    if (this.dead) return;
    this.onmessage?.({ data: msg } as MessageEvent<WorkerResponse>);
  }, tick);

  postMessage(msg: unknown): void {
    if (this.dead) return;
    // Asynchronous like a real worker: callers must not see a reply before `send` resolves.
    setTimeout(() => { if (!this.dead) void this.handle(msg as WorkerRequest); }, 0);
  }

  terminate(): void {
    // A real worker takes its running job down with it. `dead` first, so the acknowledgement
    // `cancel` posts is swallowed like a terminated worker's would be; the abort itself runs
    // synchronously, before the handler's first await.
    if (this.dead) return;
    this.dead = true;
    void this.handle({ kind: 'cancel', id: -1 });
  }
}

/**
 * Worker channel and progress state. Worker and server progress are normalized
 * into one shape (`progress` / `progressLog`) so the UI has a single <Progress>.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
// `?worker&inline` bundles the worker as an inline blob for the web build. The single-file
// build resolves this specifier to `worker/sameThread.ts` instead (see vite.config.ts):
// same handler, UI thread, one copy of core.
import AnalyzeWorker from '../../worker/analyze.worker?worker&inline';
import type { WorkerLike } from '../../worker/sameThread';
import type { WorkerProgress, WorkerRequestBody, WorkerResponse, WorkerResult } from '../../worker/analyze.worker';
import type { UserText } from '../../core/zh';
import { getCurrentLang, txv } from '../i18n';
import { phaseFraction } from './progressModel';

export interface ProgressState {
  done: number; total: number; label: string;
  /** 'upload' only exists on the server route; every other phase comes from the worker. */
  phase?: WorkerProgress['phase'] | 'upload'; detail?: string; stream?: string; thinking?: string;
}

export interface NetProgress {
  phase: 'upload' | 'parse' | 'tokenize' | 'curate'; done?: number; total?: number;
  label?: UserText; detail?: UserText; stream?: string; thinking?: string; note?: UserText;
}

const LOG_KEEP = 8;

export function useAnalyzeWorker(onError: (e: Error) => void, workerDownMessage: () => string) {
  // `WorkerLike`, not `Worker`: the single-file build swaps in a same-thread stand-in.
  const workerRef = useRef<WorkerLike | null>(null);
  const reqId = useRef(0);
  const pending = useRef(new Map<number, (r: WorkerResult) => void>());
  const onErrorRef = useRef(onError);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  const [progress, setProgress] = useState<ProgressState | null>(null);
  /** Progress log: up to 8 entries, deduplicated. */
  const [progressLog, setProgressLog] = useState<string[]>([]);
  const note = useCallback((n: string | undefined) => {
    if (!n) return;
    setProgressLog((l) => (l[l.length - 1] === n ? l : [...l, n].slice(-LOG_KEEP)));
  }, []);

  useEffect(() => {
    const w = new AnalyzeWorker();
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if ('progress' in msg && msg.progress) {
        const p = msg as WorkerProgress;
        // The phase travels with the message; the UI generates translated text from it.
        // Worker text (label/detail/note) is UserText: resolved here, at the boundary.
        setProgress((prev) => ({
          done: p.done, total: p.total, label: txv(p.label), phase: p.phase,
          detail: p.detail && txv(p.detail),
          stream: p.stream ?? prev?.stream,   // Keep the previous stream text when a message carries none
        }));
        note(p.note && txv(p.note));
        return;
      }
      const cb = pending.current.get(msg.id);
      if (cb) { pending.current.delete(msg.id); cb(msg as WorkerResult); }
    };
    w.onerror = (e) => onErrorRef.current(new Error(e.message || 'worker error'));
    workerRef.current = w;
    return () => { w.terminate(); workerRef.current = null; };
  }, [note]);

  const send = useCallback((req: WorkerRequestBody): Promise<WorkerResult> => {
    const w = workerRef.current;
    if (!w) return Promise.reject(new Error(workerDownMessage()));
    const id = ++reqId.current;
    return new Promise((resolve) => {
      pending.current.set(id, resolve);
      w.postMessage({ ...req, id, lang: getCurrentLang() });
    });
  }, [workerDownMessage]);

  /** Normalize server progress into the worker shape. Missing fields keep their previous values. */
  const applyNetProgress = useCallback((p: NetProgress) => {
    setProgress((prev) => {
      const same = prev?.phase === p.phase;
      return {
        phase: p.phase,
        done: p.done ?? (same ? prev?.done ?? 0 : 0),
        total: p.total ?? (same ? prev?.total ?? 0 : 0),
        label: p.label != null ? txv(p.label) : (same ? prev?.label ?? '' : ''),
        detail: p.detail != null ? txv(p.detail) : (same ? prev?.detail : undefined),
        stream: p.stream ?? prev?.stream,
        thinking: p.thinking ?? prev?.thinking,
      };
    });
    note(p.note != null ? txv(p.note) : undefined);
  }, [note]);

  /**
   * One monotonic 0…1 number for the ring. Phases map onto a continuous scale
   * (progressModel.ts), so it never jumps at a handover; `max` keeps it from
   * walking backwards when a stage re-reports a smaller denominator. Clearing
   * `progress` (end of a job) resets it, so the next task starts at 0%.
   */
  const shown = useRef(0);
  const phaseStart = useRef<{ phase?: string; at: number }>({ at: 0 });
  const [pct, setPct] = useState(0);
  useEffect(() => {
    if (!progress) {
      shown.current = 0; phaseStart.current = { at: 0 }; setPct(0);
      return;
    }
    if (phaseStart.current.phase !== progress.phase) {
      phaseStart.current = { phase: progress.phase, at: Date.now() };
    }
    const bump = () => {
      const f = phaseFraction(progress.phase, progress.done, progress.total, Date.now() - phaseStart.current.at);
      if (f > shown.current) { shown.current = f; setPct(f); }
    };
    bump();
    // Indeterminate phase: creep forward on a timer instead of sitting still.
    if (progress.total > 0) return;
    const id = window.setInterval(bump, 200);
    return () => window.clearInterval(id);
  }, [progress]);

  return { send, progress, pct, setProgress, progressLog, setProgressLog, note, applyNetProgress };
}

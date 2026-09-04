import { useEffect, useState } from 'react';
import { useT } from './i18n';
import { phaseFraction } from './hooks/progressModel';

/** Stage groups shown as a three-step strip under the ring. `aicache` reuses tokens, so it counts as tokenizing. */
const STEP_OF: Record<string, number> = { unzip: 0, scan: 0, read: 0, upload: 0, parse: 0, tokenize: 1, ai: 1, aicache: 1, curate: 2 };

/** A job still under this fraction after this long is a big file, not a broken page. */
const SLOW_AFTER_MS = 3000;
const SLOW_BELOW = 0.05;

/**
 * Determinate progress ring: the arc is the share done, the number in the middle
 * is the same share as an integer percent. Nothing rotates — a spinner says
 * "busy", and what the user asked for is "how far along".
 */
export default function Progress({
  phase, done, total, pct, label, detail, stream, thinking, log, onCancel, cancelLabel, inline = false,
}: {
  /** Stage id; used for the step strip and, without `pct`, to place the arc on the global scale. */
  phase?: string;
  /** Monotonic overall fraction 0…1 from useAnalyzeWorker; preferred over done/total. */
  pct?: number;
  done?: number; total?: number; label?: string;
  /** Subtitle: elapsed / speed / estimated remaining */
  detail?: string;
  /** Events logged during the run (failed chunks, fallbacks). */
  /** Streamed model output, so the user can see the model is producing. */
  stream?: string;
  /** Model reasoning, shown separately from `stream`. */
  thinking?: string;
  log?: readonly string[];
  /** Stop button when the job can be aborted. */
  onCancel?: () => void;
  cancelLabel?: string;
  inline?: boolean;
}) {
  const t = useT();
  const step = phase ? STEP_OF[phase] : undefined;
  const steps = phase === 'curate' ? [t('本地统计'), t('挑词')] : [t('读取'), t('分词'), t('排版')];
  const stepIndex = phase === 'curate' ? 1 : step;
  const p = Math.max(0, Math.min(1, pct ?? phaseFraction(phase, done, total)));
  // Users read a ring parked at 0% as "the page is broken". After three seconds
  // there with nothing to show, say out loud that it is still working.
  const nearZero = p < SLOW_BELOW;
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!nearZero) return;
    const id = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => window.clearTimeout(id);
  }, [nearZero]);
  /** Ring size; this is the only feedback during long jobs. */
  const SIZE = 96;
  const R = SIZE / 2 - 8;
  const C = 2 * Math.PI * R;
  const mid = SIZE / 2;

  return (
    <div className={`progress${inline ? ' inline' : ''}`} role="status" aria-live="polite">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        <circle cx={mid} cy={mid} r={R} fill="none" strokeWidth="5"
          stroke="color-mix(in srgb, currentColor 16%, transparent)" />
        {/* Fixed dasharray + shrinking dashoffset: the arc grows clockwise from 12 o'clock. */}
        <circle
          className="progress-arc"
          data-testid="progress-arc"
          cx={mid} cy={mid} r={R} fill="none" strokeWidth="5"
          stroke="currentColor" strokeLinecap="round"
          transform={`rotate(-90 ${mid} ${mid})`}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - p)}
        />
      </svg>
      <span className="progress-text">{`${Math.round(p * 100)}%`}</span>
      {label && <span className="progress-label">{label}</span>}
      {!inline && stepIndex !== undefined && (
        <ol className="progress-steps" aria-label={t('阶段')}>
          {steps.map((name, i) => (
            <li key={name} className={i < stepIndex ? 'done' : i === stepIndex ? 'now' : ''}>{name}</li>
          ))}
        </ol>
      )}
      {detail && <span className="progress-detail">{detail}</span>}
      {slow && nearZero && (
        <span className="progress-hint" data-testid="progress-hint">
          {t('大文件要多等一会儿，进度会一直走')}
        </span>
      )}
      {!inline && thinking && !stream && (
        <pre className="progress-stream thinking">{thinking}</pre>
      )}
      {!inline && stream && (
        <pre className="progress-stream">{stream}</pre>
      )}
      {!inline && onCancel && (
        <button type="button" className="progress-cancel" onClick={onCancel}>{cancelLabel ?? 'Stop'}</button>
      )}
      {!inline && log && log.length > 0 && (
        <ul className="progress-log">
          {log.map((line, i) => <li key={`${i}-${line}`}>{line}</li>)}
        </ul>
      )}
    </div>
  );
}

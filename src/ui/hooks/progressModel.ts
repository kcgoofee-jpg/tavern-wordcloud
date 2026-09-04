/**
 * One continuous 0…1 scale for every long job, so the ring fills like a progress
 * bar instead of jumping when a stage hands over to the next one.
 *
 * Each phase owns a slice of [0,1]; inside a phase we interpolate on `done/total`.
 * Widths are rough shares of the wall-clock time measured on a 200-message export
 * (tokenizing dominates; unzip/scan/read are near-instant for plain files):
 *
 *   unzip 5% · scan 2% · read 3% · upload 10% · parse 6% · tokenize 39% · ai 20% · curate 15%
 *
 * `upload` only happens on the server route (the browser streams the text up and
 * counts bytes); a local run goes straight from `read` to `parse`, which simply
 * means the ring jumps that band's width once — still forward, never back.
 *
 * `ai` / `aicache` occupy the same slot (the cache path skips straight to its end),
 * and `curate` (model reads the whole log) is the tail of the LLM route. A local
 * run simply ends at the top of `tokenize`, which is why finishing reports
 * `tokenize done=total` — the ring lands on 100% there.
 */
export const PHASE_BANDS = {
  unzip: [0, 0.05],
  scan: [0.05, 0.07],
  read: [0.07, 0.1],
  upload: [0.1, 0.2],
  parse: [0.2, 0.26],
  tokenize: [0.26, 0.65],
  ai: [0.65, 0.85],
  aicache: [0.65, 0.85],
  curate: [0.85, 1],
} as const satisfies Record<string, readonly [number, number]>;

export type ProgressPhase = keyof typeof PHASE_BANDS;

/** Phases with no denominator creep toward 90% of their band over this long. */
const INDETERMINATE_FULL_MS = 12_000;

export function isPhase(p: string | undefined): p is ProgressPhase {
  return !!p && p in PHASE_BANDS;
}

/**
 * Absolute fraction for one progress event.
 * `elapsedMs` is the time since this phase started; it only matters when the
 * phase reports no usable total, where we advance linearly to 90% of the band.
 */
export function phaseFraction(
  phase: string | undefined,
  done: number | undefined,
  total: number | undefined,
  elapsedMs = 0,
): number {
  if (!isPhase(phase)) {
    // Unknown phase: fall back to the raw ratio so the ring still means something.
    return total && total > 0 ? clamp01((done ?? 0) / total) : 0;
  }
  const [lo, hi] = PHASE_BANDS[phase];
  const known = typeof done === 'number' && typeof total === 'number' && total > 0;
  const within = known
    ? clamp01(done / total)
    : 0.9 * clamp01(elapsedMs / INDETERMINATE_FULL_MS);
  return lo + (hi - lo) * within;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

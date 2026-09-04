/**
 * On-demand loader for the QR encoder. `qrcode` plus its Dijkstra dependency is ~25 kB of the
 * bundle and is only reached by the share view and the export stamp, so `render/qr` must never
 * be imported statically from the first-screen graph — this module is the only door to it.
 *
 * `analyzeQr` itself stays synchronous (the canvas paint path cannot await), so callers first
 * `await loadQr()` and then read the module through `qrSync()`.
 */
type QrModule = typeof import('./qr');

let loaded: QrModule | null = null;
let pending: Promise<QrModule> | null = null;

/** Load (once) and resolve with the module. Safe to call repeatedly. */
export function loadQr(): Promise<QrModule> {
  if (loaded) return Promise.resolve(loaded);
  pending ??= import('./qr').then((m) => (loaded = m));
  return pending;
}

/** The module if it is already in memory, else null. Never triggers a load. */
export function qrSync(): QrModule | null {
  return loaded;
}

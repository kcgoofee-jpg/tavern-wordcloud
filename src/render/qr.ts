import { create as createQr } from 'qrcode';
// The qrcode package has no types for its internal modules; see src/types/qrcode-internal.d.ts
import { getRowColCoords } from 'qrcode/lib/core/alignment-pattern.js';

/**
 * Mark function-pattern modules (finder patterns and separators, timing, alignment,
 * format and version information). Only data modules may be rendered by particles;
 * the package does not expose this mask, so it is rebuilt per the spec.
 */
function buildReservedMask(size: number, version: number): Uint8Array {
  const mask = new Uint8Array(size * size);
  const set = (r: number, c: number) => {
    if (r >= 0 && r < size && c >= 0 && c < size) mask[r * size + c] = 1;
  };
  const rect = (r0: number, c0: number, rows: number, cols: number) => {
    for (let r = r0; r < r0 + rows; r++) for (let c = c0; c < c0 + cols; c++) set(r, c);
  };

  // Finder patterns + separators + format information
  rect(0, 0, 9, 9);
  rect(0, size - 8, 9, 8);
  rect(size - 8, 0, 8, 9);

  // Timing patterns
  for (let i = 0; i < size; i++) { set(6, i); set(i, 6); }

  // Alignment patterns (skipping the three overlapping the finders)
  const coords: number[] = getRowColCoords(version);
  const last = coords.length - 1;
  for (let i = 0; i < coords.length; i++) {
    for (let j = 0; j < coords.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      rect(coords[i] - 2, coords[j] - 2, 5, 5);
    }
  }

  // Version information
  if (version >= 7) {
    rect(0, size - 11, 6, 3);
    rect(size - 11, 0, 3, 6);
  }
  return mask;
}

export interface QrAnalysis {
  size: number;
  version: number;
  /** Whether each module is dark */
  bits: Uint8Array;
  /** Function-pattern mask, 1 = fixed */
  reserved: Uint8Array;
  /** Dark modules that particles may occupy */
  data: { row: number; col: number }[];
  /** Dark modules that must be drawn as-is (function patterns) */
  fixed: { row: number; col: number }[];
}

/** Error correction is fixed at H to absorb visual noise during the morph. */
export function analyzeQr(value: string, errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H' = 'H'): QrAnalysis {
  const qr = createQr(value || ' ', { errorCorrectionLevel });
  const size = qr.modules.size;
  const bits = qr.modules.data as unknown as Uint8Array;
  const reserved = buildReservedMask(size, qr.version);

  const data: { row: number; col: number }[] = [];
  const fixed: { row: number; col: number }[] = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const idx = row * size + col;
      if (!bits[idx]) continue;
      (reserved[idx] ? fixed : data).push({ row, col });
    }
  }
  return { size, version: qr.version, bits, reserved, data, fixed };
}

/* ---------- Color: scannability over aesthetics ---------- */

// Re-exported for callers that already have the encoder loaded; the renderer imports it
// straight from ./qrColor so the encoder stays a lazy chunk.
export { toScannerDark } from './qrColor';

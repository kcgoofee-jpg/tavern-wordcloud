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

const s2lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lin2s = (c: number) => {
  const x = Math.max(0, Math.min(1, c));
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
};

function hexToLinRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [s2lin(((n >> 16) & 255) / 255), s2lin(((n >> 8) & 255) / 255), s2lin((n & 255) / 255)];
}

function linRgbToOklab([r, g, b]: [number, number, number]): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

function oklabToHex([L, a, b]: [number, number, number]): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const rgb = [
     4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
  return '#' + rgb.map((v) => Math.round(lin2s(v) * 255).toString(16).padStart(2, '0')).join('');
}

/** Clamp any color to a fixed dark lightness, keeping hue and chroma, so colored modules keep ~12:1 contrast on white. */
export function toScannerDark(hex: string, targetL = 0.32): string {
  const [L, a, b] = linRgbToOklab(hexToLinRgb(hex));
  if (L <= 1e-6) return hex;
  // Lower lightness and scale chroma proportionally to stay in gamut.
  const k = Math.min(1, targetL / L);
  let out = oklabToHex([targetL, a * k, b * k]);
  // Fallback: desaturate stepwise if still out of gamut.
  for (let i = 0; i < 12; i++) {
    const back = linRgbToOklab(hexToLinRgb(out));
    if (Math.abs(back[0] - targetL) < 0.02) break;
    out = oklabToHex([targetL, a * k * (1 - (i + 1) * 0.12), b * k * (1 - (i + 1) * 0.12)]);
  }
  return out;
}

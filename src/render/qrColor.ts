/**
 * Color math for the QR stamp, kept out of `qr.ts` on purpose: the renderer needs
 * `toScannerDark` on every frame, while the encoder itself (the `qrcode` package) is a lazy
 * chunk. Importing it from here keeps `render/qr` off the first-screen graph.
 */
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

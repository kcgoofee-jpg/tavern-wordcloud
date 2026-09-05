/**
 * Vector export. The PNG path paints `placements` with `frozen: true` (base pose, no
 * float, no hover); this writes the very same poses as `<text>` elements, so hard rule 4
 * holds across both formats: same layout, same coordinates, same colour step.
 *
 * Fonts are NOT embedded. A subsetted WOFF of a CJK face is megabytes, and the whole
 * point of the vector file is that it stays small and editable. The file therefore
 * renders with whatever the opening machine has; the export panel says so and points at
 * PNG for pixel-identical output.
 *
 * Vertical words come in two shapes, exactly as on the canvas: an all-CJK word is a column
 * of upright glyphs (one `<text>` per character, offsets from `stackedLines`), anything with
 * Latin letters or digits keeps the whole-word `rotate(-90 …)`.
 */

import type { Placement } from './layout';
import { stackedLines } from './layout';

/** What goes underneath the words; `null` leaves the canvas transparent (no `<rect>`). */
export type SvgBackground = string | null;

export interface SvgOptions {
  /** Layout canvas size in device pixels: the coordinate system `placements` live in. */
  width: number;
  height: number;
  /** Output size in pixels. Defaults to the layout size; the cloud is contained, never stretched. */
  outWidth?: number;
  outHeight?: number;
  /** Frequency ramp, low -> high. `placement.step` indexes it. */
  ramp: string[];
  /** CSS font-family string; a generic family is appended as a fallback. */
  fontFamily: string;
  fontWeight: string;
  /** Letter spacing in em, matching the canvas measurement. */
  tracking?: number;
  /** Solid background colour, or null for transparent. */
  background?: SvgBackground;
  /** Corner radius in output pixels; becomes `rx` on the background and the clip. */
  radius?: number;
  /** Visible watermark line, or null. */
  watermark?: string | null;
  watermarkPos?: 'tl' | 'tr' | 'bl' | 'br';
  watermarkOpacity?: number;
  /** Watermark ink; defaults to the top ramp colour. */
  watermarkColor?: string;
  /**
   * Hidden watermark. SVG has no pixels to hide bits in, so it can only go into
   * `<metadata>` and an XML comment — visible to anyone who opens the file in an editor.
   */
  hiddenText?: string | null;
}

/** XML text escaping. Quotes are escaped too so the same helper works inside attributes. */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** `--` terminates an XML comment early, so it is broken up rather than dropped. */
const commentSafe = (s: string): string => s.replace(/--+/g, (m) => m.split('').join(' ')).replace(/>/g, '›');

/** Trim to 3 decimals and drop the trailing zeros; SVG files are mostly numbers. */
const num = (n: number): string => {
  const v = Math.round(n * 1000) / 1000;
  return Object.is(v, -0) ? '0' : String(v);
};

/** Generic fallback so a missing family still renders something sane. */
const withFallback = (family: string): string =>
  /\b(sans-serif|serif|monospace|cursive|fantasy|system-ui)\b/.test(family) ? family : `${family}, sans-serif`;

/**
 * One `<svg>` string for a laid-out cloud.
 *
 * Coordinates are written unchanged: `<text x>` / `<text y>` are exactly `placement.x` /
 * `placement.y`. Any other output size is applied as one uniform `translate(...) scale(...)`
 * on the wrapping group, the same contain-and-centre the canvas export does.
 */
export function cloudToSvg(placements: Placement[], opts: SvgOptions): string {
  const w = Math.max(1, Math.round(opts.width));
  const h = Math.max(1, Math.round(opts.height));
  const outW = Math.max(1, Math.round(opts.outWidth ?? w));
  const outH = Math.max(1, Math.round(opts.outHeight ?? h));
  const k = Math.min(outW / w, outH / h);
  const ox = (outW - w * k) / 2;
  const oy = (outH - h * k) / 2;
  const radius = Math.max(0, Math.min(opts.radius ?? 0, Math.min(outW, outH) / 2));
  const family = escapeXml(withFallback(opts.fontFamily));
  const ramp = opts.ramp.length > 0 ? opts.ramp : ['#888888'];

  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="0 0 ${outW} ${outH}">`);

  if (opts.hiddenText) {
    // Only place a hidden watermark can live in a vector file; there are no low bits here.
    out.push(`<!-- ${commentSafe(opts.hiddenText)} -->`);
    out.push(`<metadata>${escapeXml(opts.hiddenText)}</metadata>`);
  }

  if (radius > 0) {
    out.push(
      `<clipPath id="wc-clip"><rect x="0" y="0" width="${outW}" height="${outH}" rx="${num(radius)}" ry="${num(radius)}"/></clipPath>`,
    );
  }
  const open = radius > 0 ? '<g clip-path="url(#wc-clip)">' : '<g>';
  out.push(open);

  // Transparent means no rectangle at all, so the file drops onto any background.
  if (opts.background) {
    out.push(
      `<rect x="0" y="0" width="${outW}" height="${outH}"${radius > 0 ? ` rx="${num(radius)}" ry="${num(radius)}"` : ''} fill="${escapeXml(opts.background)}"/>`,
    );
  }

  const tracking = opts.tracking ?? 0;
  const groupAttrs = [
    k !== 1 || ox !== 0 || oy !== 0 ? ` transform="translate(${num(ox)} ${num(oy)}) scale(${num(k)})"` : '',
    ` font-family="${family}"`,
    ` font-weight="${escapeXml(opts.fontWeight)}"`,
    ' text-anchor="middle"',
    ' dominant-baseline="central"',
    tracking ? ` letter-spacing="${num(tracking)}em"` : '',
  ].join('');
  out.push(`<g${groupAttrs}>`);

  for (const p of placements) {
    const fill = escapeXml(ramp[Math.max(0, Math.min(ramp.length - 1, p.step))]);
    const fs = num(p.fontSize);
    if (p.stacked) {
      // Real vertical CJK: one upright glyph per line. `writing-mode` is not used because
      // renderers disagree about where it puts the glyph centres, and hard rule 4 needs the
      // glyph positions to be the canvas's — so the offsets come from the same
      // `stackedLines` the renderer draws from. `letter-spacing` is horizontal tracking and would shift a
      // single centred glyph, so it is zeroed exactly as the canvas does.
      const ls = tracking ? ' letter-spacing="0"' : '';
      for (const line of stackedLines(p.display ?? p.text, p.fontSize)) {
        out.push(
          `<text x="${num(p.x)}" y="${num(p.y + line.dy)}" font-size="${fs}" fill="${fill}"${ls}>${escapeXml(line.ch)}</text>`,
        );
      }
      continue;
    }
    // -90°, the same direction the canvas renderer rotates a vertical word.
    const rot = p.rotated ? ` transform="rotate(-90 ${num(p.x)} ${num(p.y)})"` : '';
    out.push(
      `<text x="${num(p.x)}" y="${num(p.y)}" font-size="${fs}" fill="${fill}"${rot}>${escapeXml(p.display ?? p.text)}</text>`,
    );
  }
  out.push('</g>');

  if (opts.watermark) {
    const pad = Math.max(8, Math.round(Math.min(outW, outH) * 0.035));
    const fs = Math.max(10, Math.round(Math.min(outW, outH) * 0.024));
    const pos = opts.watermarkPos ?? 'bl';
    const right = pos === 'tr' || pos === 'br';
    const top = pos === 'tl' || pos === 'tr';
    const alpha = Math.max(0.05, Math.min(1, opts.watermarkOpacity ?? 0.55));
    const ink = opts.watermarkColor ?? ramp[ramp.length - 1];
    out.push(
      `<text x="${right ? outW - pad : pad}" y="${top ? pad : outH - pad}" font-family="${family}" font-size="${fs}"` +
        ` fill="${escapeXml(ink)}" fill-opacity="${num(alpha)}" text-anchor="${right ? 'end' : 'start'}"` +
        ` dominant-baseline="${top ? 'hanging' : 'auto'}">${escapeXml(opts.watermark)}</text>`,
    );
  }

  out.push('</g>');
  out.push('</svg>');
  return out.join('\n');
}

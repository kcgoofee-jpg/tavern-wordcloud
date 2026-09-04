/**
 * Watermarks, visible and invisible.
 *
 * Two invisible carriers, both holding the same line (`text · ISO timestamp`):
 *   1. a PNG `tEXt` chunk under the `tavern-wordcloud:watermark` keyword — survives
 *      re-saving as PNG, dies the moment anyone re-encodes to JPG/WebP;
 *   2. LSB steganography in the RGB channels — survives a re-encode to PNG and any
 *      lossless crop-free copy, dies under JPG/WebP quantisation.
 * So lossy formats get the chunk only, and the panel says so.
 *
 * Bit layout for the LSB carrier: 32 bits of byte length (big endian), then the
 * UTF-8 bytes, one bit per channel across R, G and B in raster order. Fully
 * transparent pixels are skipped in both directions: a PNG encoder is free to
 * rewrite the colour of an alpha-0 pixel, so a bit hidden there is not there
 * after a round trip.
 */

/** PNG tEXt keyword for the hidden line. Distinct from `PNG_KEYWORD`, which carries the word table. */
export const WATERMARK_KEYWORD = 'tavern-wordcloud:watermark';

/** Default visible line; also the default hidden payload. */
export const DEFAULT_WATERMARK_TEXT = '酒馆词云 · wordcloud.davidzhao.top'; // i18n-exempt: the product's own name and domain

/** Refuse anything longer than this many UTF-8 bytes: a watermark is a line, not a document. */
export const MAX_WATERMARK_BYTES = 1024;

/** Where the visible stamp sits. */
export type WatermarkPos = 'tl' | 'tr' | 'bl' | 'br';

/** The line both carriers hold: the user's text plus when it was made. */
export function watermarkPayload(text: string, now: Date = new Date()): string {
  const stamp = now.toISOString();
  const body = text.trim();
  return body ? `${body} · ${stamp}` : stamp;
}

/** How many bytes of payload this pixel buffer can hold. */
export function lsbCapacity(data: Uint8ClampedArray | Uint8Array): number {
  let usable = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] !== 0) usable += 3;
  return Math.max(0, Math.floor((usable - 32) / 8));
}

/**
 * Write `text` into the low bit of every RGB channel, in place.
 * Throws when the text is longer than `MAX_WATERMARK_BYTES` or than the image can hold.
 */
export function embedLsb(data: Uint8ClampedArray | Uint8Array, text: string): void {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > MAX_WATERMARK_BYTES) throw new Error('水印文字太长'); // i18n-exempt: internal, the panel never shows it
  if (bytes.length > lsbCapacity(data)) throw new Error('图片太小，放不下这段水印'); // i18n-exempt: internal, the panel never shows it

  const bits: number[] = [];
  for (let b = 31; b >= 0; b--) bits.push((bytes.length >>> b) & 1);
  for (const byte of bytes) for (let b = 7; b >= 0; b--) bits.push((byte >> b) & 1);

  let n = 0;
  for (let i = 0; i < data.length && n < bits.length; i += 4) {
    if (data[i + 3] === 0) continue;
    for (let c = 0; c < 3 && n < bits.length; c++, n++) {
      data[i + c] = (data[i + c] & 0xfe) | bits[n];
    }
  }
}

/** Read back what `embedLsb` wrote, or null when the low bits are not a valid payload. */
export function extractLsb(data: Uint8ClampedArray | Uint8Array): string | null {
  const bits: number[] = [];
  // Cursor into the buffer, so a second `take` resumes instead of re-reading the head.
  let px = 0;
  let chan = 0;
  const take = (want: number): boolean => {
    while (bits.length < want && px < data.length) {
      if (data[px + 3] === 0) { px += 4; chan = 0; continue; }
      bits.push(data[px + chan] & 1);
      chan++;
      if (chan === 3) { chan = 0; px += 4; }
    }
    return bits.length >= want;
  };
  if (!take(32)) return null;
  let len = 0;
  for (let i = 0; i < 32; i++) len = (len << 1) | bits[i];
  len >>>= 0;
  if (len === 0 || len > MAX_WATERMARK_BYTES) return null;
  if (!take(32 + len * 8)) return null;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[32 + i * 8 + b];
    out[i] = byte;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(out);
  } catch { return null; }
}

/**
 * tEXt is Latin-1 and `embedText` refuses anything outside printable ASCII, so the
 * chunk carries base64 of the UTF-8 line rather than the line itself.
 */
export function encodeChunkText(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Inverse of `encodeChunkText`; null when the chunk is not ours. */
export function decodeChunkText(raw: string): string | null {
  try {
    const bin = atob(raw);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { return null; }
}

/**
 * Read whichever hidden watermark an exported image still carries: the PNG chunk
 * first (cheap, exact), the pixels second. Returns null when neither is present.
 * Used by the panel's verify button, so it takes whatever the file picker hands over.
 */
export async function readHiddenWatermark(blob: Blob): Promise<string | null> {
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const { readText } = await import('../share/png');
    const chunk = readText(bytes, WATERMARK_KEYWORD);
    if (chunk) return decodeChunkText(chunk) ?? chunk;
  } catch { /* not a PNG, or no chunk: fall through to the pixels */ }
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    return extractLsb(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
  } catch { return null; }
}

/** Hidden watermarks: the LSB carrier round-trips, skips transparent pixels and refuses novels. */
import { describe, expect, it } from 'vitest';
import {
  MAX_WATERMARK_BYTES, decodeChunkText, embedLsb, encodeChunkText, extractLsb, lsbCapacity, watermarkPayload,
} from '../src/ui/watermark';

/** An opaque RGBA buffer of `n` pixels, filled with a non-uniform pattern. */
const opaque = (n: number): Uint8ClampedArray => {
  const d = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    d[i * 4] = (i * 7) & 0xff;
    d[i * 4 + 1] = (i * 13) & 0xff;
    d[i * 4 + 2] = (i * 31) & 0xff;
    d[i * 4 + 3] = 255;
  }
  return d;
};

describe('LSB watermark', () => {
  it('writes and reads back the same line, including CJK', () => {
    const d = opaque(4000);
    const text = watermarkPayload('酒馆词云 · wordcloud.davidzhao.top', new Date('2026-09-04T00:00:00.000Z'));
    embedLsb(d, text);
    expect(extractLsb(d)).toBe(text);
    expect(text).toContain('2026-09-04T00:00:00.000Z');
  });

  it('touches nothing but the low bit', () => {
    const before = opaque(2000);
    const after = opaque(2000);
    embedLsb(after, 'hello');
    for (let i = 0; i < before.length; i++) {
      expect(after[i] & 0xfe).toBe(before[i] & 0xfe);
    }
  });

  it('reads nothing out of an untouched image', () => {
    // A run of identical pixels has all-zero low bits, which decodes as a zero length.
    const d = new Uint8ClampedArray(4000 * 4).fill(255);
    expect(extractLsb(d)).toBeNull();
  });

  it('skips fully transparent pixels, so a transparent background cannot hold bits', () => {
    const d = opaque(4000);
    // Blank out the first half: alpha 0 pixels must be stepped over in both directions
    for (let i = 0; i < 2000; i++) d[i * 4 + 3] = 0;
    const text = 'transparent background';
    embedLsb(d, text);
    for (let i = 0; i < 2000; i++) {
      expect(d[i * 4]).toBe((i * 7) & 0xff);
      expect(d[i * 4 + 1]).toBe((i * 13) & 0xff);
      expect(d[i * 4 + 2]).toBe((i * 31) & 0xff);
    }
    expect(extractLsb(d)).toBe(text);
  });

  it('capacity accounts for the 32-bit header and the transparent pixels', () => {
    const d = opaque(100);
    expect(lsbCapacity(d)).toBe(Math.floor((300 - 32) / 8));
    for (let i = 0; i < 50; i++) d[i * 4 + 3] = 0;
    expect(lsbCapacity(d)).toBe(Math.floor((150 - 32) / 8));
  });

  it('refuses text past the hard cap, and text the image cannot hold', () => {
    expect(() => embedLsb(opaque(40_000), 'x'.repeat(MAX_WATERMARK_BYTES + 1))).toThrow();
    // 100 opaque pixels hold 33 bytes; 200 characters do not fit.
    expect(() => embedLsb(opaque(100), 'y'.repeat(200))).toThrow();
  });
});

describe('PNG chunk carrier', () => {
  it('base64 round-trips CJK, which tEXt itself cannot hold', () => {
    const text = watermarkPayload('酒馆词云');
    const raw = encodeChunkText(text);
    expect(raw).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(decodeChunkText(raw)).toBe(text);
  });

  it('rejects a chunk that is not ours', () => {
    expect(decodeChunkText('not base64 !!')).toBeNull();
  });
});

describe('watermarkPayload', () => {
  it('falls back to the timestamp alone when the text is blank', () => {
    const now = new Date('2026-09-04T12:00:00.000Z');
    expect(watermarkPayload('   ', now)).toBe('2026-09-04T12:00:00.000Z');
  });
});

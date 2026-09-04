/** PNG embedding: write, read back, and the image remains a valid PNG (checked with pngjs). */
import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { embedText, readText, PNG_KEYWORD } from '../src/share/png';
import { encodeSharePayload, decodeSharePayload } from '../src/share/share';

function tinyPng(): Uint8Array {
  const png = new PNG({ width: 2, height: 2 });
  png.data.fill(200);
  return new Uint8Array(PNG.sync.write(png));
}

describe('PNG embedding', () => {
  it('written data reads back and the image still decodes', () => {
    const out = embedText(tinyPng(), PNG_KEYWORD, 'abc-XYZ_123');
    expect(readText(out, PNG_KEYWORD)).toBe('abc-XYZ_123');
    const decoded = PNG.sync.read(Buffer.from(out));
    expect(decoded.width).toBe(2);
    expect(decoded.data[0]).toBe(200);
  });

  it('rewriting keeps one chunk; images without data read null', () => {
    const a = embedText(tinyPng(), PNG_KEYWORD, 'first');
    const b = embedText(a, PNG_KEYWORD, 'second');
    expect(readText(b, PNG_KEYWORD)).toBe('second');
    expect(b.length).toBe(a.length + 1);
    expect(readText(tinyPng(), PNG_KEYWORD)).toBeNull();
  });

  it('round trip: words + palette -> PNG -> words + palette', async () => {
    const payload = { theme: 'sunset', words: [{ text: '沈砚秋', count: 768 }, { text: '办公室', count: 180 }], themeConf: { themeId: 'sunset', mode: 'light' as const } };
    const png = embedText(tinyPng(), PNG_KEYWORD, await encodeSharePayload(payload));
    const back = await decodeSharePayload(readText(png, PNG_KEYWORD)!);
    expect(back?.words).toEqual(payload.words);
    expect(back?.themeConf?.themeId).toBe('sunset');
  });

  it('non-ASCII payloads and non-PNG files are rejected', () => {
    expect(() => embedText(tinyPng(), PNG_KEYWORD, '中文')).toThrow();
    expect(() => embedText(new Uint8Array([1, 2, 3]), PNG_KEYWORD, 'x')).toThrow();
  });
});

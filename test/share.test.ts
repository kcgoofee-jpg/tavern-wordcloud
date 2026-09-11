/** Share-link/PNG payload round-trip and the decompression/word-count caps that guard against a crafted `#c=…` link freezing the tab (2026-09-11). */
import { describe, expect, it } from 'vitest';
import { decodeSharePayload, encodeSharePayload } from '../src/share/share';

describe('share payload round-trip', () => {
  it('encodes and decodes a normal payload unchanged', async () => {
    const payload = { theme: 'claude', words: [{ text: '词云', count: 12 }, { text: 'hello', count: 3 }] };
    const encoded = await encodeSharePayload(payload);
    const decoded = await decodeSharePayload(encoded);
    expect(decoded?.theme).toBe('claude');
    expect(decoded?.words).toEqual(payload.words);
  });

  it('rejects garbage input instead of throwing', async () => {
    await expect(decodeSharePayload('not-valid-base64-or-deflate')).resolves.toBeNull();
  });
});

describe('share payload caps (DoS guard)', () => {
  it('refuses a payload that would decompress past the byte cap', async () => {
    // A few thousand repeats of the same line compress to a tiny payload but decompress to
    // several MB — the shape of a compression bomb, not a real word list.
    const bomb = { theme: 'claude', words: Array.from({ length: 200_000 }, () => ({ text: 'x'.repeat(50), count: 1 })) };
    const encoded = await encodeSharePayload(bomb);
    // ~10.6 MB of raw text (200,000 × ~53 bytes) compresses to well under a tenth of that —
    // the amplification is the point; without it this would just be an ordinary large payload.
    expect(encoded.length).toBeLessThan(1_000_000);
    await expect(decodeSharePayload(encoded)).resolves.toBeNull();
  });

  it('caps the number of words parsed out of an oversized-but-under-the-byte-cap payload', async () => {
    // Short, varied lines keep the decompressed size well under MAX_INFLATED_BYTES while still
    // carrying far more than MAX_SHARE_WORDS entries, isolating the word-count cap from the
    // byte cap above.
    const many = { theme: 'claude', words: Array.from({ length: 3000 }, (_, i) => ({ text: 'w' + i, count: 1 })) };
    const encoded = await encodeSharePayload(many);
    const decoded = await decodeSharePayload(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.words.length).toBeLessThanOrEqual(2000);
    expect(decoded!.words.length).toBeGreaterThan(0);
  });
});

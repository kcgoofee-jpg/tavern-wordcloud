/**
 * Embed data in a PNG tEXt chunk, as SillyTavern does for character cards. The
 * exported cloud carries its word list and palette (same encoding as share links),
 * so dragging the image back reproduces the cloud.
 *
 * PNG: 8-byte signature, then chunks [length][type][data][crc]. tEXt data is
 * `keyword\0text` in Latin-1, so the payload is base64url. Inserted before IEND.
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const PNG_KEYWORD = 'tavern-wordcloud';

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const isPng = (b: Uint8Array) => b.length > 8 && SIGNATURE.every((v, i) => b[i] === v);
const u32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

/** Insert a tEXt chunk before IEND, replacing any existing chunk with the same keyword. */
export function embedText(png: Uint8Array, keyword: string, text: string): Uint8Array {
  if (!isPng(png)) throw new Error('不是 PNG');
  if (!/^[\x20-\x7e]*$/.test(text)) throw new Error('tEXt 只能放 ASCII');
  const stripped = stripText(png, keyword);
  const payload = new TextEncoder().encode(`${keyword}\0${text}`);
  const chunk = new Uint8Array(12 + payload.length);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, payload.length);
  chunk.set([0x74, 0x45, 0x58, 0x74], 4);   // 'tEXt'
  chunk.set(payload, 8);
  dv.setUint32(8 + payload.length, crc32(chunk.subarray(4, 8 + payload.length)));
  const iend = findIend(stripped);
  const out = new Uint8Array(stripped.length + chunk.length);
  out.set(stripped.subarray(0, iend), 0);
  out.set(chunk, iend);
  out.set(stripped.subarray(iend), iend + chunk.length);
  return out;
}

/** Read the tEXt chunk with the given keyword, or null. */
export function readText(png: Uint8Array, keyword: string): string | null {
  if (!isPng(png)) return null;
  let i = 8;
  while (i + 12 <= png.length) {
    const len = u32(png, i);
    const type = String.fromCharCode(png[i + 4], png[i + 5], png[i + 6], png[i + 7]);
    if (type === 'tEXt') {
      const data = png.subarray(i + 8, i + 8 + len);
      const nul = data.indexOf(0);
      if (nul > 0 && new TextDecoder('latin1').decode(data.subarray(0, nul)) === keyword) {
        return new TextDecoder('latin1').decode(data.subarray(nul + 1));
      }
    }
    if (type === 'IEND') break;
    i += 12 + len;
  }
  return null;
}

function stripText(png: Uint8Array, keyword: string): Uint8Array {
  const parts: Uint8Array[] = [png.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= png.length) {
    const len = u32(png, i);
    const type = String.fromCharCode(png[i + 4], png[i + 5], png[i + 6], png[i + 7]);
    const whole = png.subarray(i, i + 12 + len);
    const data = png.subarray(i + 8, i + 8 + len);
    const nul = data.indexOf(0);
    const mine = type === 'tEXt' && nul > 0 && new TextDecoder('latin1').decode(data.subarray(0, nul)) === keyword;
    if (!mine) parts.push(whole);
    i += 12 + len;
    if (type === 'IEND') break;
  }
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function findIend(png: Uint8Array): number {
  let i = 8;
  while (i + 12 <= png.length) {
    const len = u32(png, i);
    const type = String.fromCharCode(png[i + 4], png[i + 5], png[i + 6], png[i + 7]);
    if (type === 'IEND') return i;
    i += 12 + len;
  }
  throw new Error('PNG 没有 IEND');
}

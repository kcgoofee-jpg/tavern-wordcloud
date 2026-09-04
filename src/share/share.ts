import type { WordCount } from '../core/types';

/**
 * Encode a cloud into a URL for QR sharing. The word count is reduced until the
 * payload fits the maximum QR version.
 */

/** The palette is part of the share so the recipient sees the same colors and font. */
export interface ShareThemeConf {
  themeId: string;
  mode: 'auto' | 'light' | 'dark';
  custom?: { hue: number; chroma: number; spread: number };
  font?: { cloud: string; weight: string; tracking: number };
}

export interface SharePayload {
  theme: string;
  words: WordCount[];
  themeConf?: ShareThemeConf;
}

const PREFIX = '#c=';

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const hasCompression = () => typeof CompressionStream !== 'undefined';

async function deflate(text: string): Promise<Uint8Array> {
  const raw = new TextEncoder().encode(text);
  if (!hasCompression()) return raw;
  const cs = new CompressionStream('deflate-raw');
  const stream = new Blob([raw as BlobPart]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflate(bytes: Uint8Array): Promise<string> {
  if (!hasCompression()) return new TextDecoder().decode(bytes);
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(ds);
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

/** Compact text format: first line palette JSON, then one `word count` per line. */
function serialize(p: SharePayload): string {
  const head = JSON.stringify(p.themeConf ? { t: p.theme, c: p.themeConf } : { t: p.theme });
  return [head, ...p.words.map((w) => `${w.text} ${w.count}`)].join('\n');
}

function deserialize(text: string): SharePayload | null {
  const lines = text.split('\n');
  if (lines.length < 1) return null;
  let theme = lines[0];
  let themeConf: ShareThemeConf | undefined;
  try {
    const head = JSON.parse(lines[0]) as { t?: string; c?: ShareThemeConf };
    if (head && typeof head === 'object') { theme = head.t ?? ''; themeConf = head.c; }
  } catch { /* legacy: first line is a theme id */ }
  const words: WordCount[] = [];
  for (const line of lines.slice(1)) {
    const i = line.lastIndexOf(' ');
    if (i <= 0) continue;
    const count = Number(line.slice(i + 1));
    if (!Number.isFinite(count)) continue;
    words.push({ text: line.slice(0, i), count });
  }
  return { theme, words, themeConf };
}

export interface BuiltShare {
  url: string;
  /** Number of words actually encoded */
  wordCount: number;
  /** True when words were dropped to fit */
  truncated: boolean;
}

/** Version 12 = 65x65 modules; higher versions are hard to scan. */
const MAX_QR_VERSION = 12;
/** Binary capacity of version 12 with EC level H, minus 8 bytes for mode switches. */
const CAPACITY_V12_H = 287 - 8;

const CANDIDATE_COUNTS = [60, 44, 32, 24, 18, 14, 10, 8, 6];

export async function buildShareUrl(payload: SharePayload, baseUrl: string): Promise<BuiltShare> {
  const total = payload.words.length;
  for (const n of CANDIDATE_COUNTS) {
    if (n > total && n !== CANDIDATE_COUNTS[CANDIDATE_COUNTS.length - 1]) continue;
    const words = payload.words.slice(0, Math.min(n, total));
    const encoded = toBase64Url(await deflate(serialize({ ...payload, words })));
    const url = baseUrl + PREFIX + encoded;
    if (url.length <= CAPACITY_V12_H) {
      return { url, wordCount: words.length, truncated: words.length < total };
    }
  }
  // If not even 6 words fit, encode only the URL.
  return { url: baseUrl, wordCount: 0, truncated: total > 0 };
}

export async function readShareFromLocation(hash: string): Promise<SharePayload | null> {
  // `#/…` hashes are UI routes (legal pages), never share data
  if (hash.startsWith('#/')) return null;
  if (!hash.startsWith(PREFIX)) return null;
  try {
    return deserialize(await inflate(fromBase64Url(hash.slice(PREFIX.length))));
  } catch {
    return null;
  }
}

/** Full encoding without the QR limit, for PNG embedding. Same format as the link. */
export async function encodeSharePayload(payload: SharePayload): Promise<string> {
  return toBase64Url(await deflate(serialize(payload)));
}
export async function decodeSharePayload(encoded: string): Promise<SharePayload | null> {
  try { return deserialize(await inflate(fromBase64Url(encoded))); } catch { return null; }
}

export { MAX_QR_VERSION };

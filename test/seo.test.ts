/**
 * The head of index.html is what a search engine and a link unfurler see, and nothing
 * else in the suite looks at it. These are the claims that are cheap to make wrong and
 * expensive to notice: a preview image that does not exist, dimensions that disagree with
 * the file, a `summary` card that renders a shared link as a 60px icon, and a title only
 * half the audience can read.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SITE = 'https://wordcloud.davidzhao.top';

/** Value of a `<meta property|name="…" content="…">`, in either attribute order. */
function meta(key: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)="${key}"[^>]*content="([^"]*)"`, 'i');
  const alt = new RegExp(`<meta[^>]+content="([^"]*)"[^>]*(?:property|name)="${key}"`, 'i');
  return (re.exec(html)?.[1] ?? alt.exec(html)?.[1]) ?? null;
}

const hasCjk = (s: string) => /[一-鿿]/.test(s);
const hasLatinWord = (s: string) => /[A-Za-z]{3,}/.test(s);

describe('index.html head', () => {
  it('declares a large summary card, not a favicon-sized one', () => {
    // `summary` is what made a link posted on X render as a tiny icon.
    expect(meta('twitter:card')).toBe('summary_large_image');
    expect(meta('twitter:image')).toBe(`${SITE}/og.png`);
  });

  it('points og:image at a PNG that exists, at the size it declares', () => {
    const src = meta('og:image');
    expect(src).toBe(`${SITE}/og.png`);
    expect(meta('og:image:type')).toBe('image/png');

    const png = readFileSync(path.join(ROOT, 'public', 'og.png'));
    expect(png.subarray(0, 8).toString('latin1')).toBe('\x89PNG\r\n\x1a\n');
    // IHDR width/height sit right after the 8-byte signature, the 4-byte length and the
    // 4-byte chunk type.
    expect(String(png.readUInt32BE(16))).toBe(meta('og:image:width'));
    expect(String(png.readUInt32BE(20))).toBe(meta('og:image:height'));
    // 1.91:1 is what X and Facebook crop a large card to; anything else gets cut.
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
    expect(meta('og:image:alt')).toBeTruthy();
  });

  it('is readable in both languages: title, description and og/twitter text', () => {
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
    for (const [what, text] of [
      ['title', title],
      ['description', meta('description') ?? ''],
      ['og:title', meta('og:title') ?? ''],
      ['og:description', meta('og:description') ?? ''],
      ['twitter:title', meta('twitter:title') ?? ''],
      ['twitter:description', meta('twitter:description') ?? ''],
    ] as const) {
      expect(hasCjk(text), `${what} has no Chinese`).toBe(true);
      expect(hasLatinWord(text), `${what} has no English`).toBe(true);
    }
  });

  it('keeps one canonical URL and does not claim per-language alternates it does not have', () => {
    expect(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/.exec(html)?.[1]).toBe(`${SITE}/`);
    // The interface language follows the browser on a single URL, so hreflang has nothing
    // to point at. If per-language URLs ever exist, this expectation is the thing to change.
    expect(html).not.toMatch(/hreflang=/);
  });
});

describe('public/robots.txt and public/sitemap.xml', () => {
  const robots = readFileSync(path.join(ROOT, 'public', 'robots.txt'), 'utf8');
  const sitemap = readFileSync(path.join(ROOT, 'public', 'sitemap.xml'), 'utf8');

  it('robots.txt names the sitemap that this repository actually publishes', () => {
    expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);
    expect(robots).toMatch(/^User-agent: \*/m);
    expect(robots).toContain('Disallow: /admin');
  });

  it('every sitemap URL is on this site and the home page is listed', () => {
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toContain(`${SITE}/`);
    for (const loc of locs) expect(loc.startsWith(`${SITE}/`)).toBe(true);
  });
});

/** A Worker has no document base, so the relay URL must be absolute (14 real errors, 2026-09-04). */
import { describe, expect, it, vi, afterEach } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('relayFetch URL', () => {
  it('prefixes the worker origin', async () => {
    vi.stubGlobal('self', { location: { origin: 'https://example.test' } });
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn((u: unknown) => { seen.push(String(u)); return Promise.resolve(new Response('{}')); }));
    const { relayFetch } = await import('../src/net/relay');
    await relayFetch('https://api.example.com/v1/models', { method: 'GET' });
    expect(seen[0]).toBe('https://example.test/api/relay');
  });

  it('falls back to a relative path when there is no origin', async () => {
    vi.stubGlobal('self', undefined);
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn((u: unknown) => { seen.push(String(u)); return Promise.resolve(new Response('{}')); }));
    const { relayFetch } = await import('../src/net/relay');
    await relayFetch('https://api.example.com/v1/models', { method: 'GET' });
    expect(seen[0]).toBe('/api/relay');
  });
});

// @vitest-environment happy-dom
/**
 * The top-right buttons are one cluster (plan A3, 2026-09-08): DOM order scheme → language →
 * community → notice → version, every child a `.quick` button, and an absent bell (no server)
 * or update dot leaves no gap — the old per-button `right:` offsets left a hole in the middle
 * of the single-file build.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

class StubWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage() {}
  terminate() {}
  addEventListener() {}
  removeEventListener() {}
}
vi.mock('../../src/worker/analyze.worker?worker&inline', () => ({ default: StubWorker }));
Object.defineProperty(navigator, 'language', { value: 'zh-CN', configurable: true });
if (!('ResizeObserver' in globalThis)) {
  class RO { observe() {} unobserve() {} disconnect() {} }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO;
}

/** Offline by default; with `notice` the server answers /api/health and /api/notice. */
function serve(notice: { id: string; title: string; text: string; level: 'info' | 'warn'; updatedAt: number } | null) {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (!notice) return Promise.reject(new TypeError('offline'));
    if (String(url).includes('/api/health')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, relay: true, version: 'v1' }) } as Response);
    if (String(url).includes('/api/notice')) return Promise.resolve({ ok: true, json: () => Promise.resolve(notice) } as Response);
    return Promise.reject(new TypeError('offline'));
  }));
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

const kids = (c: HTMLElement) => [...c.querySelector('.quick-cluster')!.children] as HTMLElement[];

describe('top-right quick cluster', () => {
  it('offline: scheme, language, community — three buttons, in that order, no holes', async () => {
    serve(null);
    const { default: App } = await import('../../src/ui/App');
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector('.quick-cluster')).toBeTruthy());
    const k = kids(container);
    expect(k.map((el) => el.tagName)).toEqual(['BUTTON', 'BUTTON', 'BUTTON']);
    expect(k.every((el) => el.classList.contains('quick'))).toBe(true);
    expect(k.map((el) => el.className.split(' ')[1])).toEqual(['mode-quick', 'lang-quick', 'community-quick']);
    expect(container.querySelector('.notice-quick')).toBeNull();
    expect(container.querySelector('.version-quick')).toBeNull();
  });

  it('with a served notice the bell is the fourth child, still inside the cluster', async () => {
    serve({ id: 'n1', title: '维护', text: '今晚', level: 'info', updatedAt: Date.now() });
    const { default: App } = await import('../../src/ui/App');
    const { container } = render(<App />);
    await waitFor(() => expect(screen.queryByRole('button', { name: '站内通知' })).toBeTruthy());
    const k = kids(container);
    expect(k.length).toBe(4);
    expect(k[3].classList.contains('notice-quick')).toBe(true);
    expect(k[3].classList.contains('quick')).toBe(true);
  });
});

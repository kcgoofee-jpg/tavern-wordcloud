// @vitest-environment happy-dom
/**
 * Deploy-update watch: `useNotice` remembers the first `/api/health` version it sees and,
 * once a later poll reports a different one, flags `updateAvailable` (held back while busy).
 * The App-level test covers the dot + card + reload button that hang off it.
 */
import { act, cleanup, renderHook, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNotice } from '../../src/ui/hooks/useNotice';

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

/** `/api/health` answers with `version`; everything else offline. `getVersion` is read fresh on every call. */
function serveHealth(getVersion: () => string) {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (String(url).includes('/api/health')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, relay: true, version: getVersion() }) } as Response);
    }
    if (String(url).includes('/api/notice')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: null }) } as Response);
    return Promise.reject(new TypeError('offline'));
  }));
}

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('useNotice: deploy-update watch', () => {
  it('flags an update once the polled version differs from the first one seen', async () => {
    vi.useFakeTimers();
    let version = 'v1';
    serveHealth(() => version);

    const { result } = renderHook(({ open, busy }: { open: boolean; busy: boolean }) => useNotice(open, busy), {
      initialProps: { open: false, busy: false },
    });

    // First poll only records the baseline version; no update yet.
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.updateAvailable).toBe(false);

    // A deploy happens under the visitor's feet; the next 10-minute poll sees it.
    version = 'v2';
    await act(async () => { await vi.advanceTimersByTimeAsync(600_000); });
    expect(result.current.updateAvailable).toBe(true);
  });

  it('does not surface the update while busy', async () => {
    vi.useFakeTimers();
    let version = 'v1';
    serveHealth(() => version);

    const { result, rerender } = renderHook(({ open, busy }: { open: boolean; busy: boolean }) => useNotice(open, busy), {
      initialProps: { open: false, busy: true },
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    version = 'v2';
    await act(async () => { await vi.advanceTimersByTimeAsync(600_000); });
    // Detected, but held back by busy
    expect(result.current.updateAvailable).toBe(false);

    rerender({ open: false, busy: false });
    expect(result.current.updateAvailable).toBe(true);
  });
});

describe('App: deploy-update dot', () => {
  const dot = () => screen.queryByRole('button', { name: '网站更新了' });

  beforeEach(() => localStorage.clear());
  afterEach(() => { localStorage.clear(); });

  it('shows the dot after a version change, and reload calls location.reload', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let version = 'v1';
    serveHealth(() => version);
    const reload = vi.fn();
    vi.spyOn(window.location, 'reload').mockImplementation(reload);

    const { default: App } = await import('../../src/ui/App');
    const { container } = render(<App />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(dot()).toBeNull();

    version = 'v2';
    await act(async () => { await vi.advanceTimersByTimeAsync(600_000); });
    await waitFor(() => expect(dot()).not.toBeNull());
    expect(container.querySelector('.version-quick .dot')).not.toBeNull();

    await user.click(dot()!);
    const reloadBtn = screen.getByRole('button', { name: '刷新' });
    await user.click(reloadBtn);
    expect(reload).toHaveBeenCalled();
  });
});

// @vitest-environment happy-dom
/** Site notice: the bell only exists behind a server, carries a dot until the card is closed. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

class StubWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage() {}
  terminate() {}
  addEventListener() {}
  removeEventListener() {}
}
vi.mock('../../src/worker/analyze.worker?worker&inline', () => ({ default: StubWorker }));

// happy-dom reports en-US; pin Chinese so the assertions match
Object.defineProperty(navigator, 'language', { value: 'zh-CN', configurable: true });

const NOTICE = { id: 'abc123', text: '今晚 22:00 维护 20 分钟。', level: 'info', updatedAt: 1_756_900_000_000 };

/** Everything is offline except the routes named here. */
function serve(routes: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const hit = Object.entries(routes).find(([p]) => String(url).includes(p));
    if (!hit) return Promise.reject(new TypeError('offline'));
    return Promise.resolve({ ok: true, json: () => Promise.resolve(hit[1]) } as Response);
  }));
}

if (!('ResizeObserver' in globalThis)) {
  class RO { observe() {} unobserve() {} disconnect() {} }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO;
}

const { default: App } = await import('../../src/ui/App');

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });

const bell = () => screen.queryByRole('button', { name: '站内通知' });

describe('site notice', () => {
  it('shows the bell with an unread dot, and drops the dot once the card is closed', async () => {
    const user = userEvent.setup();
    serve({ '/api/notice': NOTICE });
    const { container } = render(<App />);

    await waitFor(() => expect(bell()).not.toBeNull());
    expect(container.querySelector('.notice-quick .dot')).not.toBeNull();

    // Opening shows the text; closing marks it seen and the dot goes
    await user.click(bell()!);
    expect(screen.getByText(NOTICE.text)).not.toBeNull();
    await user.click(bell()!);
    await waitFor(() => expect(container.querySelector('.notice-quick .dot')).toBeNull());
    expect(localStorage.getItem('noticeSeen')).toBe(NOTICE.id);
    // The bell itself stays, so the notice can be read again
    expect(bell()).not.toBeNull();
  });

  it('a notice already seen carries no dot', async () => {
    localStorage.setItem('noticeSeen', NOTICE.id);
    serve({ '/api/notice': NOTICE });
    const { container } = render(<App />);
    await waitFor(() => expect(bell()).not.toBeNull());
    expect(container.querySelector('.notice-quick .dot')).toBeNull();
  });

  it('no server, no bell (the single-file build)', async () => {
    serve({});
    render(<App />);
    // Give the probe a few turns to settle before asserting the absence
    await waitFor(() => expect(screen.queryByRole('button', { name: /切换到中文|Switch to English/ })).not.toBeNull());
    expect(bell()).toBeNull();
  });
});

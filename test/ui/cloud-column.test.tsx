// @vitest-environment happy-dom
/**
 * Plan B1 (2026-09-08): on desktop the cloud steps aside for an open side panel. The pixel
 * values come from CSS tokens the real browser resolves (the layout audit checks that the
 * sheet and the words never intersect); here the state machine is pinned: which layout key
 * the canvas is told, for which panel.
 */
import { createRef } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))));

afterEach(() => { cleanup(); localStorage.clear(); });

const layout = (c: HTMLElement) => c.querySelector('.cloud-wrap')?.getAttribute('data-cloud-layout');

describe('CloudCanvas layoutKey', () => {
  it('publishes the key on .cloud-wrap and defaults to free', async () => {
    const { default: CloudCanvas } = await import('../../src/ui/CloudCanvas');
    const { THEMES } = await import('../../src/theme/themes');
    const theme = THEMES[0];
    const ref = createRef<never>();
    const props = { ref, words: [], theme, rotateRatio: 0, shareUrl: null, highlight: null, onWordClick: () => {} };
    const { container, rerender } = render(<CloudCanvas {...props} />);
    expect(layout(container)).toBe('free');
    rerender(<CloudCanvas {...props} layoutKey="column-wide" />);
    expect(layout(container)).toBe('column-wide');
  });
});

describe('App tells the canvas which column it is in', () => {
  // The first screen is the sample cloud, which has no rail since 2026-09-08: its resting key is
  // `sample` (the words run out to the edge), not `free`.
  it('theme panel → column; closed → back to the sample key', async () => {
    const user = userEvent.setup();
    const { default: App } = await import('../../src/ui/App');
    const { container } = render(<App />);
    await waitFor(() => expect(layout(container)).toBe('sample'));
    await user.click(screen.getByRole('button', { name: '风格与配色' }));
    await waitFor(() => expect(layout(container)).toBe('column'));
    await user.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(layout(container)).toBe('sample'));
  });
});

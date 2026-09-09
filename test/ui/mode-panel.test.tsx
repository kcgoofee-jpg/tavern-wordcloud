// @vitest-environment happy-dom
/**
 * Two changes the operator asked for on 2026-09-08:
 *
 *  1. The first screen (the sample cloud) drops the left rail. Only the bottom-left dock and the
 *     top-right cluster stay, and the canvas is told `sample` so the words fill the width the
 *     rail used to take.
 *  2. The cloud-mode switch is no longer a bar pinned to the top centre of the canvas
 *     (`.cloudmode`, deleted). It is a rail panel like 「大模型接口 · 密钥」, and the rail button
 *     carries the current mode in its icon, its tooltip and `data-mode`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

class StubWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage(msg: { id: number; kind: string }) {
    // Only `load` is answered: the mode entry depends on files being in, not on a finished analysis.
    if (msg.kind === 'load') {
      queueMicrotask(() => this.onmessage?.({
        data: { id: msg.id, ok: true, kind: 'load', fileCount: 1, chars: 14, characters: [] },
      } as MessageEvent));
    }
  }
  terminate() {}
  addEventListener() {}
  removeEventListener() {}
}
vi.mock('../../src/worker/analyze.worker?worker&inline', () => ({ default: StubWorker }));

Object.defineProperty(navigator, 'language', { value: 'zh-CN', configurable: true });
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))));
if (!('ResizeObserver' in globalThis)) {
  class RO { observe() {} unobserve() {} disconnect() {} }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO;
}

const { default: App } = await import('../../src/ui/App');

afterEach(() => { cleanup(); localStorage.clear(); });

/** `.env.local` prefills the dev endpoint; pin the saved settings so readiness is the test's choice. */
const saveAi = (ready: boolean) => localStorage.setItem('tw-settings', JSON.stringify({
  options: {
    ai: ready
      ? { enabled: false, endpoint: 'https://api.example.com/v1/chat/completions', model: 'gpt-x', apiKey: 'k', chunkChars: 1200, concurrency: 2 }
      : { enabled: false, endpoint: '', model: '', apiKey: '', chunkChars: 1200, concurrency: 2 },
  },
}));

/** Load one chat log so the rail (and with it the mode entry) is on screen. */
async function withFiles() {
  render(<App />);
  const input = document.querySelector('input[type=file]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['{"messages":[]}'], 'a.jsonl')] } });
  return vi.waitFor(() => {
    const el = document.querySelector('.rail .tool[aria-pressed]') as HTMLButtonElement | null;
    expect(el, 'the rail carries a panel button').toBeTruthy();
    return el!;
  });
}

/** The panel is a lazy chunk: wait for its content, not for the Suspense placeholder. */
const openSheet = () => vi.waitFor(() => {
  const el = document.querySelector('.sheet') as HTMLElement | null;
  expect(el, 'the sheet is open').toBeTruthy();
  expect(el!.querySelector('.seg'), 'the panel body has rendered').toBeTruthy();
  return el!;
});

describe('the sample screen has no rail', () => {
  it('shows the dock and the round buttons but no rail, and the canvas fills the width', async () => {
    const { container } = render(<App />);
    await vi.waitFor(() => expect(container.querySelector('.quick-cluster')).toBeTruthy());
    expect(container.querySelector('.rail')).toBeNull();
    expect(container.querySelector('.dock')).toBeTruthy();
    expect(container.querySelector('.cloud-wrap')?.getAttribute('data-cloud-layout')).toBe('sample');
    // …and with no rail there is no mode entry to find either
    expect(screen.queryByTitle('词云模式：词频')).toBeNull();
  });

  it('a click anywhere on the sample leads to the import page', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const catcher = await vi.waitFor(() => {
      const el = container.querySelector('.demo-catch') as HTMLButtonElement | null;
      expect(el).toBeTruthy();
      return el!;
    });
    await user.click(catcher);
    // The import page carries its own upload entry, so it has no rail either
    await vi.waitFor(() => expect(container.querySelector('.landing')).toBeTruthy());
    expect(container.querySelector('.rail')).toBeNull();
  });
});

describe('cloud mode is a rail panel', () => {
  it('the first rail panel is the mode one, and it opens a sheet with the two modes', async () => {
    const user = userEvent.setup();
    saveAi(false);
    const first = await withFiles();
    expect(first.getAttribute('title')).toContain('词云模式');
    expect(first.getAttribute('data-mode')).toBe('freq');

    await user.click(first);
    const sheet = await openSheet();
    expect(document.querySelector('.sheet-title')?.textContent).toBe('词云模式');
    expect(within(sheet).getByRole('button', { name: /词频/ })).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: /关键词/ })).toBeTruthy();
  });

  it('picking 关键词 with no endpoint opens the endpoint panel instead of switching', async () => {
    const user = userEvent.setup();
    saveAi(false);
    const first = await withFiles();
    await user.click(first);
    const sheet = await openSheet();
    await user.click(within(sheet).getByRole('button', { name: /关键词/ }));

    await vi.waitFor(() => expect(document.querySelector('.sheet-title')?.textContent).toBe('大模型接口'));
    // Still in frequency mode: the switch did not take
    expect(document.querySelector('.rail .tool[data-mode]')?.getAttribute('data-mode')).toBe('freq');
  });

  it('with an endpoint configured the switch takes, and the rail button follows the mode', async () => {
    const user = userEvent.setup();
    saveAi(true);
    const first = await withFiles();
    await user.click(first);
    const sheet = await openSheet();
    await user.click(within(sheet).getByRole('button', { name: /关键词/ }));

    const railMode = await vi.waitFor(() => {
      const el = document.querySelector('.rail .tool[data-mode]') as HTMLButtonElement;
      expect(el.getAttribute('data-mode')).toBe('keyword');
      return el;
    });
    expect(railMode.getAttribute('title')).toBe('词云模式：关键词');
    // The panel stays open on the mode it just moved to, and offers the run action
    expect(document.querySelector('.sheet-title')?.textContent).toBe('词云模式');
    expect(within(document.querySelector('.sheet') as HTMLElement).getByRole('button', { name: /读完整份聊天挑词/ })).toBeTruthy();

    // …and back
    await user.click(within(document.querySelector('.sheet') as HTMLElement).getByRole('button', { name: /词频/ }));
    await vi.waitFor(() => expect(document.querySelector('.rail .tool[data-mode]')?.getAttribute('data-mode')).toBe('freq'));
    expect(document.querySelector('.rail .tool[data-mode]')?.getAttribute('title')).toBe('词云模式：词频');
  });

  it('the old top-centre switch is gone from the document', async () => {
    saveAi(false);
    await withFiles();
    expect(document.querySelector('.cloudmode')).toBeNull();
    expect(document.querySelector('.cloudmode-run')).toBeNull();
  });
});

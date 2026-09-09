// @vitest-environment happy-dom
/**
 * 词表 is the `<Activity>` pilot (notes/docs/41 §2). Closing the panel used to unmount
 * `WordsPanel` and reset everything the visitor had set up inside it — the search box and the
 * `limit` (60 rows, +100 a click: expand to 460, close the panel, come back to 60). Hidden
 * Activity keeps the subtree mounted, so that state survives a close.
 *
 * The second half of the file pins the invariant that makes this safe for `npm run audit` and
 * for the stylesheet: while the panel is closed its shell must carry neither `.sheet` nor
 * `.sheet-body` nor a `.sheet-close`, because `.app:has(.sheet)` dims the canvas below 1024px
 * and the audit driver takes the *first* `querySelector('.sheet-body' | '.sheet-close')` match.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnalysisResult } from '../../src/core/types';

class StubWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage(msg: { id: number; kind: string }) {
    if (msg.kind === 'load') {
      queueMicrotask(() => this.onmessage?.({ data: { id: msg.id, ok: true, kind: 'load', fileCount: 1, chars: 14, characters: [] } } as MessageEvent));
    }
  }
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

/** 90 words: more than the panel's initial `limit` of 60, so 「还有 N 个」 is on screen. */
const WORDS = [
  { text: '沈砚秋', count: 500 },
  { text: '合同', count: 400 },
  ...Array.from({ length: 88 }, (_, i) => ({ text: `词${i}`, count: 300 - i })),
];
const RESULT = {
  words: WORDS, allWords: WORDS,
  totalTokens: 9000, countedTokens: 9000, uniqueTokens: WORDS.length,
  messageCount: 10, totalMessages: 10, rawChars: 100, cleanChars: 90,
  warnings: [], groups: [], meta: null,
  // The filter panel reads these when it opens (the "another panel" case); CI rendered it before the stub had them.
  entities: { persons: [], byKind: [{ kind: 'person', words: 1 }, { kind: 'generic', words: 1 }] },
  blocked: { total: 0 },
} as unknown as AnalysisResult;

vi.stubGlobal('fetch', vi.fn((input: unknown) => {
  const url = String(input);
  if (url === '/api/health') return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, relay: true }) } as Response);
  if (url === '/api/analyze') {
    const sse = `event: done\ndata: ${JSON.stringify({ result: RESULT })}\n\n`;
    return Promise.resolve({
      ok: true, status: 200,
      body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }),
    } as unknown as Response);
  }
  return Promise.reject(new TypeError('offline'));
}));

/** The server route uploads with XHR wherever streamed request bodies are missing — happy-dom included. */
class TestXHR {
  upload = { onprogress: null as ((e: ProgressEvent) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  onprogress: (() => void) | null = null;
  status = 200;
  responseText = `event: done\ndata: ${JSON.stringify({ result: RESULT })}\n\n`;
  open() {}
  setRequestHeader() {}
  abort() { this.onabort?.(); }
  send(bytes: Uint8Array) {
    queueMicrotask(() => {
      this.upload.onprogress?.({ loaded: bytes.byteLength, total: bytes.byteLength } as ProgressEvent);
      this.onload?.();
    });
  }
}
vi.stubGlobal('XMLHttpRequest', TestXHR);

const { default: App } = await import('../../src/ui/App');

afterEach(() => { cleanup(); localStorage.clear(); });

/** Import one chat and wait until the rail's 词表 button comes alive. */
async function loaded() {
  render(<App />);
  const input = document.querySelector('input[type=file]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['{"messages":[]}'], 'a.jsonl')] } });
  await vi.waitFor(() => expect((screen.getByTitle('词表') as HTMLButtonElement).disabled).toBe(false));
}

const searchBox = () => screen.getByLabelText('搜索') as HTMLInputElement;
const rows = () => document.querySelectorAll('.sheet-body ol li').length;

describe('词表 stays alive while it is closed', () => {
  it('the search term survives a close and reopen', async () => {
    const user = userEvent.setup();
    await loaded();
    await user.click(screen.getByTitle('词表'));
    // The panel is a lazy chunk; wait for the real content, not the Suspense placeholder.
    await screen.findByLabelText('搜索');
    await user.type(searchBox(), '沈');
    expect(searchBox().value).toBe('沈');

    await user.click(screen.getByTitle('关闭'));
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByTitle('词表'));
    expect(searchBox().value).toBe('沈');
  });

  it('「还有 N 个」 keeps the rows it added instead of snapping back to 60', async () => {
    const user = userEvent.setup();
    await loaded();
    await user.click(screen.getByTitle('词表'));
    await screen.findByLabelText('搜索');
    expect(rows()).toBe(60);

    await user.click(screen.getByRole('button', { name: '还有 30 个' }));
    expect(rows()).toBe(90);

    await user.click(screen.getByTitle('关闭'));
    await user.click(screen.getByTitle('词表'));
    expect(rows()).toBe(90);
  });

  it('another panel opening does not reset it either', async () => {
    const user = userEvent.setup();
    await loaded();
    await user.click(screen.getByTitle('词表'));
    await screen.findByLabelText('搜索');
    await user.type(searchBox(), '合');

    await user.click(screen.getByTitle('筛选与分词'));
    // Exactly one open sheet: the words shell drops its `.sheet` identity while it is hidden,
    // so the focus handling and the outside-click rules in useOverlay still see one panel.
    expect(document.querySelectorAll('.sheet').length).toBe(1);
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('筛选与分词');

    await user.click(screen.getByTitle('词表'));
    expect(searchBox().value).toBe('合');
  });
});

describe('nothing is kept alive before the panel has ever been opened', () => {
  it('the word table is not in the DOM on the first screen, only after the first open', async () => {
    const user = userEvent.setup();
    await loaded();
    // Never opened: no shell, no hidden rows. Keeping it mounted from the first paint took the
    // sample screen from 151 DOM nodes to 1525 (headless Chrome, 2026-09-09).
    expect(document.querySelector('[data-panel="words"]')).toBeNull();

    await user.click(screen.getByTitle('词表'));
    await screen.findByLabelText('搜索');
    await user.click(screen.getByTitle('关闭'));
    // Opened once: now it stays, hidden.
    expect(document.querySelector('[data-panel="words"] .search')).toBeTruthy();
  });
});

describe('the hidden shell leaves no trace for the stylesheet or the layout audit', () => {
  it('no .sheet / .sheet-body / .sheet-close while the panel is closed', async () => {
    const user = userEvent.setup();
    await loaded();
    // Open once so WordsPanel is definitely mounted, then close it again.
    await user.click(screen.getByTitle('词表'));
    await screen.findByLabelText('搜索');
    await user.click(screen.getByTitle('关闭'));

    expect(document.querySelectorAll('.sheet').length).toBe(0);
    expect(document.querySelectorAll('.sheet-body').length).toBe(0);
    expect(document.querySelectorAll('.sheet-close').length).toBe(0);
    // Still mounted, though — that is the whole point.
    expect(document.querySelector('[data-panel="words"] .search')).toBeTruthy();
    // And out of the accessibility tree, so getByRole('dialog') cannot reach it.
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

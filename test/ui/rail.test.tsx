// @vitest-environment happy-dom
/**
 * The rail is five buttons (operator, 2026-09-09: "词云模式的切换按钮收到大模型接口里面去,
 * 边栏的按钮太多了, 能合并的合并"). It used to be nine.
 *
 *   添加文件 · 词表 · 筛选与分词 · 大模型接口 · 导出
 *
 * What moved where:
 *   - 词云模式 → the first group of the 大模型接口 panel; the rail button says which mode you
 *     are in (`data-mode`) and wears a `.dot` in keyword mode.
 *   - 高级设置 → a collapsed `<details class="adv">` at the bottom of 筛选与分词.
 *   - 检查分类 → the second tab of 词表.
 *   - 清空全部数据 → the card popover, under the file list it clears.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

class StubWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage(msg: { id: number; kind: string }) {
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
if (!('ResizeObserver' in globalThis)) {
  class RO { observe() {} unobserve() {} disconnect() {} }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO;
}

/** The analysis comes back over the server route; happy-dom has no streamed request bodies, so it uploads with XHR. */
let sseBody = '';
class TestXHR {
  upload = { onprogress: null as ((e: ProgressEvent) => void) | null, onload: null as (() => void) | null };
  onprogress: (() => void) | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 200;
  responseText = '';
  open() {}
  setRequestHeader() {}
  abort() { this.onabort?.(); }
  send(bytes: Uint8Array) {
    queueMicrotask(() => {
      this.upload.onprogress?.({ loaded: bytes.byteLength, total: bytes.byteLength } as ProgressEvent);
      this.responseText = sseBody;
      this.onload?.();
    });
  }
}
const RESULT = {
  words: [{ text: '沈砚秋', count: 12, kind: 'person' }, { text: '咖啡馆', count: 5, kind: 'place' }],
  allWords: [{ text: '沈砚秋', count: 12, kind: 'person', kinds: [{ kind: 'person', conf: 0.9 }] },
    { text: '咖啡馆', count: 5, kind: 'place', kinds: [{ kind: 'place', conf: 0.8 }] }],
  totalTokens: 20, countedTokens: 20, uniqueTokens: 2,
  messageCount: 10, totalMessages: 10, rawChars: 100, cleanChars: 90,
  warnings: [], groups: [], perSource: [],
  entities: { persons: [], byKind: [{ kind: 'person', words: 1 }, { kind: 'place', words: 1 }] },
  blocked: { total: 0, byReason: { manual: 0, auto: 0, template: 0 }, samples: [] },
  nsfwByKind: [], sensitive: 0, cot: { available: 0, models: [], boilerplateSentences: [] }, speakers: [],
  meta: {
    character: '排练厅的下午', startedAt: null, endedAt: null, worldInfo: null, authorNote: null,
    models: [], apis: [], messages: 10, userMessages: 5, charMessages: 5,
    swipeRate: 0, avgGenSeconds: null, rawChars: 100, cleanChars: 90, lastInContextMessageId: null,
  },
} as unknown as import('../../src/core/types').AnalysisResult;

/** A server behind the page: health says yes, /api/analyze answers with the canned result. */
function serve() {
  sseBody = `event: done\ndata: ${JSON.stringify({ result: RESULT })}\n\n`;
  // Stubbed per test, not once at module scope: afterEach's unstubAllGlobals would drop it.
  vi.stubGlobal('XMLHttpRequest', TestXHR);
  vi.stubGlobal('fetch', vi.fn((input: unknown) => {
    const url = String(input);
    if (url === '/api/health') return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, relay: true }) } as Response);
    if (url === '/api/analyze') {
      return Promise.resolve({
        ok: true, status: 200,
        body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sseBody)); c.close(); } }),
      } as unknown as Response);
    }
    return Promise.reject(new TypeError('offline'));
  }));
  return vi.mocked(fetch);
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

/** Endpoint settings are prefilled from `.env.local` in dev; pin them so readiness is the test's choice. */
const saveAi = (ready: boolean) => localStorage.setItem('tw-settings', JSON.stringify({
  options: {
    ai: ready
      ? { enabled: false, endpoint: 'https://api.example.com/v1', model: 'gpt-x', apiKey: 'k', chunkChars: 1200, concurrency: 2 }
      : { enabled: false, endpoint: '', model: '', apiKey: '', chunkChars: 1200, concurrency: 2 },
  },
}));

/** Import one log and wait for the analysis to land, so every rail button is enabled. */
async function analyzed() {
  const { default: App } = await import('../../src/ui/App');
  render(<App />);
  const input = document.querySelector('input[type=file]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['{"messages":[]}'], 'a.jsonl')] } });
  await waitFor(() => expect((screen.getByTitle('词表') as HTMLButtonElement).disabled).toBe(false));
}

/** Panels arrive through React.lazy; wait for the body, not for the Suspense placeholder. */
const sheetBody = () => waitFor(() => {
  const el = document.querySelector('.sheet-body') as HTMLElement | null;
  expect(el, 'the sheet is open').toBeTruthy();
  expect(el!.querySelector('.note'), 'still the loading placeholder').toBeNull();
  return el!;
});

const railTitles = () => [...document.querySelectorAll('.rail .tool')].map((b) => b.getAttribute('title'));

describe('the rail is five buttons', () => {
  it('添加 · 词表 · 筛选与分词 · 大模型接口 · 导出, four of which toggle a panel', async () => {
    serve();
    saveAi(false);
    await analyzed();
    expect(railTitles()).toEqual([
      '添加聊天记录', '词表', '筛选与分词', '大模型接口 · 词频模式', '导出',
    ]);
    // 添加 opens the file picker and has no panel; the other four do.
    expect(document.querySelectorAll('.rail .tool[aria-pressed]').length).toBe(4);
    // The four entries the rail no longer carries. 清空全部数据 still exists — in the card
    // popover — so it is checked against the rail, not against the document.
    for (const gone of ['词云模式：词频', '词云模式：关键词', '高级设置', '检查分类']) {
      expect(screen.queryByTitle(gone), gone).toBeNull();
    }
    expect(railTitles()).not.toContain('清空全部数据');
  });
});

describe('cloud mode lives in the endpoint panel', () => {
  it('the panel opens on the two modes, and the rail follows the one you pick', async () => {
    const user = userEvent.setup();
    serve();
    saveAi(true);
    await analyzed();
    await user.click(screen.getByTitle('大模型接口 · 词频模式'));
    const body = await sheetBody();
    expect(document.querySelector('.sheet-title')?.textContent).toBe('大模型接口');
    const mode = body.querySelector('.seg[aria-label="词云模式"]') as HTMLElement;
    expect(mode, 'the 词云模式 group is the first thing in the panel').toBeTruthy();
    expect(within(mode).getByRole('button', { name: /词频/ })).toBeTruthy();

    await user.click(within(mode).getByRole('button', { name: /关键词/ }));
    const rail = await waitFor(() => {
      const el = document.querySelector('.rail .tool[data-mode]') as HTMLButtonElement;
      expect(el.getAttribute('data-mode')).toBe('keyword');
      return el;
    });
    expect(rail.getAttribute('title')).toBe('大模型接口 · 关键词模式');
    // Keyword mode is the state a visitor must not lose track of: the button wears a dot
    expect(rail.querySelector('.dot')).toBeTruthy();
    // …and the panel it is in is still the one on screen, now offering the run action
    expect(within(document.querySelector('.sheet-body') as HTMLElement)
      .getByRole('button', { name: /读完整份聊天挑词/ })).toBeTruthy();
  });

  it('with nothing configured, picking 关键词 sends no request — it moves the cursor', async () => {
    const user = userEvent.setup();
    const fetchMock = serve();
    saveAi(false);
    await analyzed();
    await user.click(screen.getByTitle('大模型接口 · 词频模式'));
    const body = await sheetBody();
    const before = fetchMock.mock.calls.length;

    await user.click(within(body).getByRole('button', { name: /关键词/ }));
    // Still frequency mode, no dot, and not one call went out
    expect(document.querySelector('.rail .tool[data-mode]')?.getAttribute('data-mode')).toBe('freq');
    expect(document.querySelector('.rail .tool[data-mode] .dot')).toBeNull();
    expect(fetchMock.mock.calls.length).toBe(before);
    // The panel stays put and puts the cursor on the field that is missing
    expect(document.querySelector('.sheet-title')?.textContent).toBe('大模型接口');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('地址')));
  });
});

describe('advanced settings are a section of the filter panel', () => {
  it('the panel ends in a collapsed 高级设置, and opening it reveals the advanced controls', async () => {
    const user = userEvent.setup();
    serve();
    await analyzed();
    await user.click(screen.getByTitle('筛选与分词'));
    const body = await sheetBody();
    const adv = body.querySelector('details.adv') as HTMLDetailsElement;
    expect(adv, 'the collapsed advanced section').toBeTruthy();
    expect(adv.open, 'collapsed by default').toBe(false);
    expect(adv).toBe(body.lastElementChild);

    await user.click(within(adv).getByText('高级设置'));
    expect(adv.open).toBe(true);
    // A control from the old advanced panel, and the priority-words box that lived above it
    expect(within(adv).getByLabelText(/不显示这些词/)).toBeTruthy();
    expect(within(adv).getByLabelText('优先词')).toBeTruthy();
  });
});

describe('the word panel has two tabs', () => {
  it('词频表 by default; 检查分类 shows the review list, and the tab survives closing the panel', async () => {
    const user = userEvent.setup();
    serve();
    await analyzed();
    await user.click(screen.getByTitle('词表'));
    const body = await sheetBody();
    expect(document.querySelector('.sheet-title')?.textContent).toBe('词表');
    const tabs = body.querySelector('.seg[aria-label="词表"]') as HTMLElement;
    expect(tabs).toBeTruthy();
    expect([...tabs.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['词频表', '检查分类']);
    expect(body.querySelector('.review-list')).toBeNull();

    await user.click(within(tabs).getByRole('button', { name: '检查分类' }));
    await waitFor(() => expect(document.querySelector('.review-list')).toBeTruthy());
    // Still the wide column: one panel, one width
    expect(document.querySelector('.sheet')?.classList.contains('wide')).toBe(true);
    expect(document.querySelector('.cloud-wrap')?.getAttribute('data-cloud-layout')).toBe('column-wide');

    // Reopening comes back to the tab you were on: a correction pass is not restarted by every detour
    await user.click(screen.getByTitle('关闭'));
    await user.click(screen.getByTitle('词表'));
    await waitFor(() => expect(document.querySelector('.review-list')).toBeTruthy());
  });
});

describe('清空全部数据 sits in the card popover', () => {
  it('not on the rail; it is under the file list, and it empties the app', async () => {
    const user = userEvent.setup();
    serve();
    await analyzed();
    expect(railTitles()).not.toContain('清空全部数据');
    // Closed popover: the button is in the DOM but the card is hidden
    const card = document.querySelector('.cardinfo-body') as HTMLElement;
    expect(card.hasAttribute('hidden')).toBe(true);
    await user.click(screen.getByTitle(/看详情/));
    expect(card.hasAttribute('hidden')).toBe(false);

    const clear = within(card).getByTitle('清空全部数据');
    await user.click(clear);
    // Nothing loaded any more: the rail goes with the files and the import page is back
    await waitFor(() => expect(document.querySelector('.landing')).toBeTruthy());
    expect(document.querySelector('.rail')).toBeNull();
  });
});

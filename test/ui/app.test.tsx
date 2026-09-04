// @vitest-environment happy-dom
/** UI safety net: the app renders in the DOM; toolbar buttons and their enabled state are asserted. The worker is stubbed. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

class StubWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage(msg: { id: number; kind: string }) {
    // Answers only what the tests ask for; everything else stays pending
    if (msg.kind === 'load') {
      queueMicrotask(() => this.onmessage?.({ data: { id: msg.id, ok: true, kind: 'load', fileCount: 1, chars: 14, characters: [] } } as MessageEvent));
    }
    if (msg.kind === 'context') {
      queueMicrotask(() => this.onmessage?.({ data: { id: msg.id, ok: true, kind: 'context', snippets: ['他看着她，说：这词不对劲。', '又是一段上下文。'] } } as MessageEvent));
    }
  }
  terminate() {}
  addEventListener() {}
  removeEventListener() {}
}
vi.mock('../../src/worker/analyze.worker?worker&inline', () => ({ default: StubWorker }));

// happy-dom reports en-US; pin Chinese so the assertions match
Object.defineProperty(navigator, 'language', { value: 'zh-CN', configurable: true });
// The app probes /api/health on mount; make it fail like offline
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))));

/**
 * The server route uploads with XMLHttpRequest wherever streamed request bodies
 * are unavailable — happy-dom included — so /api/analyze is answered here rather
 * than by the fetch mock. Tests set `sseBody` to the event stream they want back.
 */
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
vi.stubGlobal('XMLHttpRequest', TestXHR);

if (!('ResizeObserver' in globalThis)) {
  class RO { observe() {} unobserve() {} disconnect() {} }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO;
}

const { default: App } = await import('../../src/ui/App');

afterEach(() => { cleanup(); localStorage.clear(); });

describe('App empty state', () => {
  it('opens on the sample cloud; a click leads to the landing; the rail appears after an import', async () => {
    const user = userEvent.setup();
    render(<App />);
    // Sample cloud first; the landing (import page) is one click away
    expect(screen.queryByRole('button', { name: /把聊天记录拖进来/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: '示例词云 · 点任意位置开始导入' }));
    // Landing: upload card, top bar controls, footer links
    expect(screen.getByRole('button', { name: /把聊天记录拖进来/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: '社区排行榜' })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: '服务条款' })[0].getAttribute('href')).toBe('#/terms');
    expect(document.querySelector('.rail')).toBeNull();
    expect(screen.queryByTitle('导出 · 分享')).toBeNull();
    // Import one file: the landing goes away, the rail takes over
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['{"messages":[]}'], 'a.jsonl')] } });
    await vi.waitFor(() => expect(document.querySelector('.rail')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /把聊天记录拖进来/ })).toBeNull();
    expect(document.querySelector('.rail')).toBeTruthy();
    expect((screen.getByTitle('导出') as HTMLButtonElement).disabled).toBe(true);
  });

  it('the sample button opens the sample cloud; clicking it returns to the landing', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: '示例词云 · 点任意位置开始导入' }));
    await user.click(screen.getByRole('button', { name: '先看示例' }));
    expect(screen.queryByRole('button', { name: /把聊天记录拖进来/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: '示例词云 · 点任意位置开始导入' }));
    expect(screen.getByRole('button', { name: /把聊天记录拖进来/ })).toBeTruthy();
  });

  it('the theme panel opens from the sample view (no data needed)', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByTitle('风格与配色'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    await user.click(screen.getByTitle('关闭'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('switching to English translates the landing', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: '示例词云 · 点任意位置开始导入' }));
    await user.click(screen.getByTitle('Switch to English'));
    expect(screen.getByRole('heading', { name: 'Turn your tavern chat logs into a word cloud' })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Terms of Service' })[0]).toBeTruthy();
  });
});

describe('legal routes', () => {
  it('#/privacy opens the privacy page over the landing; the back link returns', async () => {
    window.location.hash = '#/privacy';
    const user = userEvent.setup();
    render(<App />);
    // The legal page is a lazy chunk (see test/lazy.test.ts), so it lands one tick late.
    expect(await screen.findByRole('document', { name: '隐私政策' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: '隐私政策' })).toBeTruthy();
    await user.click(screen.getAllByRole('link', { name: '← 返回词云' })[0]);
    await vi.waitFor(() => expect(screen.queryByRole('document')).toBeNull());
    // Back on the sample cloud (the first view)
    expect(screen.getByRole('button', { name: '示例词云 · 点任意位置开始导入' })).toBeTruthy();
    window.location.hash = '';
  });
});

describe('feedback confirmation', () => {
  it('opens an in-app dialog with the full snippets; cancel sends nothing, confirm posts', async () => {
    const snippets = ['他看着她，说：这词不对劲。', '又是一段上下文。'];
    const result = {
      words: [{ text: '沈砚秋', count: 5 }, { text: '合同', count: 3 }],
      allWords: [{ text: '沈砚秋', count: 5 }, { text: '合同', count: 3 }],
      totalTokens: 8, countedTokens: 8, uniqueTokens: 2,
      messageCount: 10, totalMessages: 10, rawChars: 100, cleanChars: 90,
      warnings: [], groups: [], meta: null,
    } as unknown as import('../../src/core/types').AnalysisResult;
    sseBody = `event: done\ndata: ${JSON.stringify({ result })}\n\n`;
    const fetchMock = vi.mocked(fetch);
    // A server behind the page: health + SSE analyze + feedback endpoint
    fetchMock.mockImplementation((input: unknown) => {
      const url = String(input);
      if (url === '/api/health') return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, relay: true }) } as Response);
      if (url === '/api/analyze') {
        const sse = `event: done\ndata: ${JSON.stringify({ result })}\n\n`;
        return Promise.resolve({
          ok: true, status: 200,
          body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }),
        } as unknown as Response);
      }
      if (url === '/api/feedback') return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
      return Promise.reject(new TypeError('offline'));
    });
    try {
      const user = userEvent.setup();
      render(<App />);
      // Load one chat file; the server path analyzes it
      const input = document.querySelector('input[type=file]') as HTMLInputElement;
      fireEvent.change(input, { target: { files: [new File(['{"messages":[]}'], 'a.jsonl')] } });
      await vi.waitFor(() => expect((screen.getByTitle('词频表') as HTMLButtonElement).disabled).toBe(false));
      await user.click(screen.getByTitle('词频表'));

      const reportTitle = '认为『沈砚秋』不该出现？提交反馈——会先给你看要发送的片段，确认后才上传';
      // The words panel is a lazy chunk; wait for it instead of the Suspense placeholder.
      await user.click(await screen.findByTitle(reportTitle));
      // The dialog shows the full snippets and the payload size
      const dialog = screen.getByRole('dialog', { name: '提交反馈' });
      expect(within(dialog).getByText(/他看着她，说：这词不对劲。/)).toBeTruthy();
      expect(within(dialog).getByText(/又是一段上下文。/)).toBeTruthy();
      const n = '沈砚秋'.length + snippets.join('').length;
      expect(within(dialog).getByText(`将发送 ${n} 字`)).toBeTruthy();

      // Cancel closes without sending (the icon-only header button and the text button share the name)
      const cancel = within(dialog).getAllByRole('button', { name: '取消' }).find((b) => b.textContent === '取消')!;
      await user.click(cancel);
      expect(screen.queryByRole('dialog', { name: '提交反馈' })).toBeNull();
      expect(fetchMock.mock.calls.filter(([u]) => String(u) === '/api/feedback')).toEqual([]);

      // Confirm posts the feedback
      await user.click(screen.getByTitle(reportTitle));
      await user.click(within(screen.getByRole('dialog', { name: '提交反馈' })).getByRole('button', { name: '发送' }));
      await vi.waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u) === '/api/feedback')).toBe(true));
      expect(screen.queryByRole('dialog', { name: '提交反馈' })).toBeNull();
    } finally {
      fetchMock.mockImplementation(() => Promise.reject(new TypeError('offline')));
    }
  });
});

describe('keyword mode without a key', () => {
  it('a server with relay:true and no configured key still asks for the endpoint', async () => {
    sseBody = '';
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((input: unknown) => {
      const url = String(input);
      if (url === '/api/health') return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, relay: true }) } as Response);
      return Promise.reject(new TypeError('offline'));
    });
    try {
      // .env.local's VITE_DEV_AI_* dev-prefill would otherwise make localAiReady true in this environment; force it empty.
      localStorage.setItem('tw-settings', JSON.stringify({ options: { ai: { enabled: false, endpoint: '', model: '', apiKey: '' } } }));
      render(<App />);
      const input = document.querySelector('input[type=file]') as HTMLInputElement;
      fireEvent.change(input, { target: { files: [new File(['{"messages":[]}'], 'a.jsonl')] } });
      await vi.waitFor(() => expect(document.querySelector('.cloudmode')).toBeTruthy());
      const keywordBtn = within(document.querySelector('.cloudmode') as HTMLElement).getByText('关键词').closest('button')!;
      // Nothing configured at all: the label names the first missing field
      // The missing field is named in the tooltip now, not printed beside the label.
      expect(keywordBtn.getAttribute('title')).toContain('还没填接口地址');
    } finally {
      fetchMock.mockImplementation(() => Promise.reject(new TypeError('offline')));
    }
  });
});

describe('rail icons carry no captions', () => {
  it('每个按钮只有图标，说明只在 title / aria-label 里', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: '示例词云 · 点任意位置开始导入' }));
    await user.click(screen.getByRole('button', { name: '先看示例' }));
    const rail = document.querySelector('.rail') as HTMLElement;
    expect(rail.classList.contains('caps')).toBe(false);
    expect(rail.querySelector('.cap')).toBeNull();
    expect(rail.textContent?.trim()).toBe('');
    // The name still exists for screen readers and tooltips
    expect(within(rail).getByRole('button', { name: '筛选与分词' })).toBeTruthy();
    const dock = document.querySelector('.dock') as HTMLElement;
    expect(dock.querySelector('.cap')).toBeNull();
  });
});

describe('keyword switch: which endpoint field is missing', () => {
  it('with only an endpoint saved the tooltip names the model, and opening the panel focuses the test button', async () => {
    localStorage.setItem('tw-settings', JSON.stringify({
      options: {
        ai: {
          enabled: false, endpoint: 'https://api.example.com/v1/chat/completions',
          apiKey: '', model: '', chunkChars: 1200, concurrency: 2,
        },
      },
    }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: '示例词云 · 点任意位置开始导入' }));
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['{"messages":[]}'], 'a.jsonl')] } });
    await vi.waitFor(() => expect(document.querySelector('.cloudmode')).toBeTruthy());

    const keyword = within(document.querySelector('.cloudmode') as HTMLElement)
      .getByRole('button', { name: /关键词/ });
    expect(keyword.getAttribute('title')).toContain('还没选模型');
    expect(keyword.textContent).not.toContain('缺');

    // Clicking opens the endpoint panel. There is no model box before the list is fetched
    // (the box is a disabled select), so the cursor lands on the test-connection button.
    await user.click(keyword);
    const test = await vi.waitFor(() => {
      const el = screen.getByRole('button', { name: '测试连接' });
      expect(el).toBeTruthy();
      return el as HTMLButtonElement;
    });
    expect(document.activeElement).toBe(test);
    expect((document.querySelector('select.ai-model') as HTMLSelectElement).disabled).toBe(true);
  });
});

describe('figures in the dock', () => {
  it('are a status readout inside the card popover, not a dock chip', async () => {
    const result = {
      words: [{ text: '沈砚秋', count: 5 }],
      allWords: [{ text: '沈砚秋', count: 5 }],
      totalTokens: 8, countedTokens: 8, uniqueTokens: 2,
      messageCount: 10, totalMessages: 10, rawChars: 100, cleanChars: 90,
      warnings: [], groups: [], meta: null,
    } as unknown as import('../../src/core/types').AnalysisResult;
    sseBody = `event: done\ndata: ${JSON.stringify({ result })}\n\n`;
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((input: unknown) => {
      const url = String(input);
      if (url === '/api/health') return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, relay: true }) } as Response);
      if (url === '/api/analyze') {
        const sse = `event: done\ndata: ${JSON.stringify({ result })}\n\n`;
        return Promise.resolve({
          ok: true, status: 200,
          body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }),
        } as unknown as Response);
      }
      return Promise.reject(new TypeError('offline'));
    });
    try {
      render(<App />);
      const input = document.querySelector('input[type=file]') as HTMLInputElement;
      fireEvent.change(input, { target: { files: [new File(['{"messages":[]}'], 'a.jsonl')] } });
      // The figures live inside the character-card popover (user decision 2026-09-04); this
      // result has no card metadata, so they fall back to the dock row.
      await vi.waitFor(() => expect(document.querySelector('.dock-stats')).toBeTruthy());
      const stats = document.querySelector('.dock-stats') as HTMLElement;
      expect(stats.closest('.dock')).toBeTruthy();
      expect(stats.getAttribute('role')).toBe('status');
      expect(stats.querySelector('button')).toBeNull();
      // Three figures, each carrying its unit
      expect(stats.children.length).toBe(3);
      expect(stats.textContent).toContain('条');
      expect(stats.textContent).toContain('清洗');
      expect(stats.textContent).toContain('词');
      // The old corner chip is gone
      expect(document.querySelector('.hud')).toBeNull();
    } finally {
      fetchMock.mockImplementation(() => Promise.reject(new TypeError('offline')));
    }
  });
});

/** A second import while files are loaded asks first; nothing stacks silently (user decision 2026-09-04). */
describe('import guard', () => {
  it('asks before replacing an existing import, and cancel keeps the old one', async () => {
    render(<App />);
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['{"messages":[]}'], 'a.jsonl')] } });
    await vi.waitFor(() => expect(document.querySelector('.rail')).toBeTruthy());
    fireEvent.change(input, { target: { files: [new File(['{"messages":[]}'], 'b.jsonl')] } });
    await vi.waitFor(() => expect(screen.getByRole('dialog', { name: '已有一份分析' })).toBeTruthy());
    fireEvent.click(screen.getByText('取消'));
    expect(screen.queryByRole('dialog', { name: '已有一份分析' })).toBeNull();
    expect(document.querySelector('.rail')).toBeTruthy();
  });
});


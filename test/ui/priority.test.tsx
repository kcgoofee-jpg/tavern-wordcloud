// @vitest-environment happy-dom
/** Priority words: the panel writes the setting, the counter caps at 50, the sample cloud is exempt, CSV keeps a source column. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PriorityPanel } from '../../src/ui/panels';
import { wordsToCsv } from '../../src/ui/export';
import type { WordCount } from '../../src/core/types';

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

// Spy on the priority pass so "the sample cloud does not apply it" can be asserted directly.
const applyPrioritySpy = vi.fn();
vi.mock('../../src/core/overrides', async (orig) => {
  const real = await orig<typeof import('../../src/core/overrides')>();
  return {
    ...real,
    applyPriority: (...args: Parameters<typeof real.applyPriority>) => {
      applyPrioritySpy(...args);
      return real.applyPriority(...args);
    },
  };
});

Object.defineProperty(navigator, 'language', { value: 'zh-CN', configurable: true });
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))));
if (!('ResizeObserver' in globalThis)) {
  class RO { observe() {} unobserve() {} disconnect() {} }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO;
}

const { default: App } = await import('../../src/ui/App');

afterEach(() => { cleanup(); localStorage.clear(); applyPrioritySpy.mockClear(); });

describe('PriorityPanel', () => {
  it('typing writes the setting after the debounce, and the counter follows', async () => {
    const user = userEvent.setup();
    const setValue = vi.fn();
    render(<PriorityPanel value="" setValue={setValue} />);
    const box = screen.getByLabelText('优先词') as HTMLTextAreaElement;
    expect(box.placeholder).toBe('沈砚秋；排练厅；通告单');
    expect(screen.getByText('0/50')).toBeTruthy();

    await user.type(box, '爱我吗；用力');
    expect(screen.getByText('2/50')).toBeTruthy();
    // Debounced: the setting lands only after the pause.
    await vi.waitFor(() => expect(setValue).toHaveBeenCalledWith('爱我吗；用力'));
  });

  it('51 items turn the counter red and say only the first 50 are kept', async () => {
    const many = Array.from({ length: 51 }, (_, i) => `词${i}`).join('；');
    render(<PriorityPanel value={many} setValue={vi.fn()} />);
    const counter = screen.getByText('51/50');
    expect(counter.className).toContain('over');
    expect(counter.getAttribute('title')).toBe('只取前 50 个');
  });
});

describe('priority words and the rest of the app', () => {
  it('priority words live inside the advanced panel, not as a rail entry', async () => {
    render(<App />);
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['{"messages":[]}'], 'a.jsonl')] } });
    await vi.waitFor(() => expect(document.querySelector('.rail')).toBeTruthy());
    // No rail entry any more; the textarea itself is covered by the PriorityPanel tests above,
    // and App renders it inside the advanced sheet (rail buttons stay disabled without a result).
    expect(screen.queryByTitle('优先词')).toBeNull();
    expect(screen.getByTitle('高级设置')).toBeTruthy();
  });

  it('the sample cloud does not apply priority words', async () => {
    localStorage.setItem('tw-settings', JSON.stringify({ priority: '爱我吗；用力' }));
    render(<App />);
    // The sample view returns DEMO_WORDS before the priority pass runs.
    expect(screen.getByRole('button', { name: '示例词云 · 点任意位置开始导入' })).toBeTruthy();
    expect(applyPrioritySpy).not.toHaveBeenCalled();
  });
});

describe('CSV', () => {
  it('has a source column marking priority rows', async () => {
    const words: WordCount[] = [
      { text: '爱我吗', count: 20, kind: 'plain', priority: true },
      { text: '咖啡馆', count: 5, kind: 'place' },
    ];
    const text = await wordsToCsv(words).text();
    const lines = text.replace(/^﻿/, '').split('\n');
    expect(lines[0]).toBe('word,count,kind,source');
    expect(lines[1]).toBe('爱我吗,20,plain,priority');
    expect(lines[2]).toBe('咖啡馆,5,place,tokenizer');
  });
});

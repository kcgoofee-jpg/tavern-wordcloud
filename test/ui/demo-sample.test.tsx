// @vitest-environment happy-dom
/**
 * The sample cloud on the first screen follows the interface language: an English visitor
 * must not be met by Chinese words. The canvas is stubbed with a list so the words the app
 * actually hands the renderer are readable in the DOM.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEMO_WORDS, DEMO_WORDS_EN, demoWords } from '../../src/ui/demo';
import type { WordCount } from '../../src/core/types';

const CJK = /[一-鿿]/;

class StubWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage() {}
  terminate() {}
  addEventListener() {}
  removeEventListener() {}
}
vi.mock('../../src/worker/analyze.worker?worker&inline', () => ({ default: StubWorker }));

/** The cloud is a <canvas>; render the words as a list instead so the test can read them. */
vi.mock('../../src/ui/CloudCanvas', async () => {
  const { forwardRef } = await import('react');
  const CloudStub = forwardRef<unknown, { words: WordCount[] }>(function CloudStub({ words }, _ref) {
    return (
      <ul data-testid="cloud">
        {words.map((w) => <li key={w.text}>{w.text}</li>)}
      </ul>
    );
  });
  return { default: CloudStub };
});

// happy-dom reports en-US; pin Chinese so the app opens in Chinese and the switch is observable
Object.defineProperty(navigator, 'language', { value: 'zh-CN', configurable: true });
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))));
if (!('ResizeObserver' in globalThis)) {
  class RO { observe() {} unobserve() {} disconnect() {} }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO;
}

const { default: App } = await import('../../src/ui/App');

afterEach(() => { cleanup(); localStorage.clear(); });

const cloudText = () => screen.getByTestId('cloud').textContent ?? '';

describe('sample cloud language', () => {
  it('opens on the Chinese sample and swaps to the English one when the language button is clicked', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Chinese first: the sample words are Chinese and none of the English ones are present
    expect(screen.getByRole('button', { name: '开始' })).toBeTruthy();
    for (const w of ['雨夜', '书房', '旧信', '沉默']) expect(cloudText()).toContain(w);
    expect(cloudText()).not.toContain('Elias');
    expect(cloudText()).not.toContain('lighthouse');

    // Same click that switches the copy switches the sample — no reload
    await user.click(screen.getByTitle('Switch to English'));
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy();
    for (const w of ['Elias', 'lighthouse', 'silence', 'harbor']) expect(cloudText()).toContain(w);
    expect(CJK.test(cloudText())).toBe(false);

    // And back again
    await user.click(screen.getByTitle('切换到中文'));
    expect(cloudText()).toContain('雨夜');
    expect(cloudText()).not.toContain('Elias');
  });
});

describe('sample word lists', () => {
  it('the English list is English, the Chinese list is Chinese, and neither is empty', () => {
    expect(DEMO_WORDS.length).toBeGreaterThan(20);
    expect(DEMO_WORDS_EN.length).toBeGreaterThan(20);
    expect(DEMO_WORDS.every((w) => CJK.test(w.text))).toBe(true);
    // Latin letters only: an English cloud must carry no Chinese at all
    expect(DEMO_WORDS_EN.every((w) => /^[A-Za-z][A-Za-z' -]*$/.test(w.text))).toBe(true);
  });

  it('reads like a real result: counts descend from a clear top word into a long tail', () => {
    for (const list of [DEMO_WORDS, DEMO_WORDS_EN]) {
      const counts = list.map((w) => w.count);
      expect([...counts].sort((a, b) => b - a)).toEqual(counts);
      expect(counts[0]).toBeGreaterThan(counts[counts.length - 1] * 5);
      expect(new Set(list.map((w) => w.text)).size).toBe(list.length);
      expect(list.every((w) => w.count > 0)).toBe(true);
    }
  });

  it('the selector follows the language, and returns the stable module arrays', () => {
    expect(demoWords('zh')).toBe(DEMO_WORDS);
    expect(demoWords('en')).toBe(DEMO_WORDS_EN);
  });
});

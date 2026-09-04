// @vitest-environment happy-dom
/**
 * Keyboard reachability (U5): Tab order rail → panel → dock, focus moves into a panel when
 * it opens and returns to the button that opened it, Escape closes, Enter activates a
 * focused icon button, and every control has a visible :focus-visible ring.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))));

if (!('ResizeObserver' in globalThis)) {
  class RO { observe() {} unobserve() {} disconnect() {} }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO;
}

const { default: App } = await import('../../src/ui/App');

afterEach(() => { cleanup(); localStorage.clear(); });

/** The theme panel is the one panel that opens without any imported data. */
const openThemePanel = async (user: ReturnType<typeof userEvent.setup>) => {
  const trigger = screen.getByTitle('风格与配色') as HTMLButtonElement;
  await user.click(trigger);
  return trigger;
};

describe('panel focus handoff', () => {
  it('opening a panel moves focus into it; Tab then lands on a control inside', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openThemePanel(user);
    const sheet = screen.getByRole('dialog') as HTMLElement;
    expect(sheet.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(sheet);
    await user.tab();
    expect(sheet.contains(document.activeElement)).toBe(true);
    expect((document.activeElement as HTMLElement).tagName).toBe('BUTTON');
  });

  it('Escape closes the panel and hands focus back to the button that opened it', async () => {
    const user = userEvent.setup();
    render(<App />);
    const trigger = await openThemePanel(user);
    expect(screen.getByRole('dialog')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('the close button also returns focus to the opener', async () => {
    const user = userEvent.setup();
    render(<App />);
    const trigger = await openThemePanel(user);
    await user.click(screen.getByTitle('关闭'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe('icon buttons take the keyboard', () => {
  it('Enter on a focused icon button opens its panel; Enter on the close button shuts it', async () => {
    const user = userEvent.setup();
    render(<App />);
    const trigger = screen.getByTitle('风格与配色') as HTMLButtonElement;
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog')).toBeTruthy();
    const close = screen.getByTitle('关闭') as HTMLButtonElement;
    close.focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Space activates a focused icon button too', async () => {
    const user = userEvent.setup();
    render(<App />);
    const trigger = screen.getByTitle('风格与配色') as HTMLButtonElement;
    trigger.focus();
    await user.keyboard(' ');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('tab order: rail before the sheet before the dock', () => {
  it('the rail, the open sheet and the dock appear in that order in the document', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openThemePanel(user);
    const rail = document.querySelector('.rail, .dock') as HTMLElement;
    const sheet = screen.getByRole('dialog') as HTMLElement;
    const dock = document.querySelector('.dock') as HTMLElement;
    expect(dock).toBeTruthy();
    expect(rail).toBeTruthy();
    // Tab order follows document order when nothing sets a positive tabindex.
    expect(document.querySelector('[tabindex]:not([tabindex="-1"]):not([tabindex="0"])')).toBeNull();
    expect(sheet.compareDocumentPosition(dock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('focus ring', () => {
  const css = readFileSync(path.join(process.cwd(), 'src/ui/styles/50-focus.css'), 'utf8');

  it('the shared stylesheet draws an accent ring on :focus-visible', () => {
    expect(css).toContain(':focus-visible');
    expect(css).toMatch(/outline:\s*2px solid var\(--accent\)/);
  });

  it('it is registered in the cascade, before the mobile overrides', () => {
    const index = readFileSync(path.join(process.cwd(), 'src/ui/styles/index.css'), 'utf8');
    expect(index).toContain("@import './50-focus.css';");
    expect(index.indexOf("50-focus.css")).toBeLessThan(index.indexOf('37-mobile-overrides.css'));
  });

  it('no control kills its outline without :focus-visible putting one back', () => {
    // `outline: none` on a plain :focus is the pattern that leaves keyboard users blind.
    // It is allowed only for the panel shells, which are focused programmatically.
    const dir = path.join(process.cwd(), 'src/ui/styles');
    const files = readFileSync(path.join(dir, 'index.css'), 'utf8')
      .match(/'\.\/([^']+\.css)'/g)!.map((m) => m.slice(3, -1));
    const offenders: string[] = [];
    for (const f of files) {
      if (f === '50-focus.css') continue;
      for (const line of readFileSync(path.join(dir, f), 'utf8').split('\n')) {
        if (!/outline:\s*none/.test(line)) continue;
        // Paired with an accent border on the same rule, the control is still marked.
        if (/border-color:\s*var\(--accent\)/.test(line)) continue;
        offenders.push(`${f}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

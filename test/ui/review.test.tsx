// @vitest-environment happy-dom
/** The review page (F11): filter by kind, re-file, mark as noise, undo, and the old-store migration. */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { WordCount, WordOverride } from '../../src/core/types';
import { ReviewPanel } from '../../src/ui/panels';
import { migrateKindOverrides } from '../../src/ui/hooks/useSettings';
import { setCurrentLang } from '../../src/ui/i18n';

// `tx()` (kind names) reads a module-level language; happy-dom's navigator would make it English.
setCurrentLang('zh');
afterEach(cleanup);

const WORDS: WordCount[] = [
  { text: '西德妮', count: 30, kind: 'person', kinds: [{ kind: 'person', conf: 0.95 }] },
  { text: '咖啡馆', count: 12, kind: 'place', kinds: [{ kind: 'place', conf: 0.85 }] },
  { text: '早上', count: 7, kind: 'time', kinds: [{ kind: 'time', conf: 0.9 }] },
];

function harness(init: Record<string, WordOverride> = {}, stop: string[] = []) {
  const state = { ov: init, stop };
  const ui = () => (
    <ReviewPanel
      words={WORDS}
      overrides={state.ov}
      setOverrides={(fn) => { state.ov = fn(state.ov); view.rerender(ui()); }}
      extraStopwords={state.stop}
      setExtraStopwords={(v) => { state.stop = v; view.rerender(ui()); }} />
  );
  const view = render(ui());
  return state;
}

const rowNames = () => screen.getAllByRole('listitem').map((li) => li.querySelector('b')?.textContent);

describe('ReviewPanel', () => {
  it('lists every word by count, and the kind tabs filter it', async () => {
    const user = userEvent.setup();
    harness();
    expect(rowNames()).toEqual(['西德妮', '咖啡馆', '早上']);
    await user.click(screen.getByRole('button', { name: '地点' }));
    expect(rowNames()).toEqual(['咖啡馆']);
  });

  it('the search box filters within the tab', async () => {
    const user = userEvent.setup();
    harness();
    await user.type(screen.getByLabelText('搜词'), '咖啡');
    expect(rowNames()).toEqual(['咖啡馆']);
  });

  it('the kind menu writes overrides[word].kind and moves the word to that tab', async () => {
    const user = userEvent.setup();
    const s = harness();
    await user.click(screen.getAllByTitle('改类别')[1]);
    await user.click(screen.getByRole('menuitem', { name: '品牌' }));
    expect(s.ov['咖啡馆'].kind).toBe('brand');
    await user.click(screen.getByRole('button', { name: '品牌' }));
    expect(rowNames()).toEqual(['咖啡馆']);
  });

  it('「移出分类」writes plain, not the old kindOverrides store', async () => {
    const user = userEvent.setup();
    const s = harness();
    await user.click(screen.getAllByTitle('移出分类')[0]);
    expect(s.ov['西德妮']).toEqual({ kind: 'plain' });
  });

  it('「标为非词」writes extraStopwords and disables the button', async () => {
    const user = userEvent.setup();
    const s = harness();
    await user.click(screen.getAllByTitle('标为非词')[0]);
    expect(s.stop).toEqual(['西德妮']);
    expect((screen.getAllByTitle('标为非词')[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it('「全部撤销」reverts only what this session changed', async () => {
    const user = userEvent.setup();
    const s = harness({ '早上': { display: '清晨' } });
    await user.click(screen.getAllByTitle('改类别')[0]);
    await user.click(screen.getByRole('menuitem', { name: '地点' }));
    await user.click(screen.getAllByTitle('标为非词')[2]);
    expect(screen.getByText('本次改了 2 个')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '全部撤销' }));
    expect(s.ov['西德妮']).toBeUndefined();
    // A pre-existing override is untouched by the undo.
    expect(s.ov['早上']).toEqual({ display: '清晨' });
    expect(s.stop).toEqual([]);
    expect(screen.getByText('本次改了 0 个')).toBeTruthy();
  });
});

describe('kindOverrides migration', () => {
  it('folds the old store into overrides[word].kind and empties it', () => {
    const out = migrateKindOverrides({ '咖啡馆': 'place' }, { '西德妮': { display: 'Sydney' } });
    expect(out.kindOverrides).toEqual({});
    expect(out.overrides).toEqual({
      '西德妮': { display: 'Sydney' },
      '咖啡馆': { kind: 'place' },
    });
  });

  it('an existing overrides kind wins over the old store', () => {
    const out = migrateKindOverrides({ '咖啡馆': 'place' }, { '咖啡馆': { kind: 'brand' } });
    expect(out.overrides['咖啡馆'].kind).toBe('brand');
  });

  it('missing fields are safe', () => {
    expect(migrateKindOverrides(undefined, undefined)).toEqual({ kindOverrides: {}, overrides: {} });
  });
});

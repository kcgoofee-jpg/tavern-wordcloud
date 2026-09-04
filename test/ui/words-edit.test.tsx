// @vitest-environment happy-dom
/** Word table row editing: display name, forced rotation, and the chips that undo them. */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ANALYZE_OPTIONS } from '../../src/core/analyze';
import type { WordCount, WordOverride } from '../../src/core/types';
import { WordsPanel } from '../../src/ui/panels';

afterEach(cleanup);

const WORDS: WordCount[] = [
  { text: '西德妮', count: 12 },
  { text: '咖啡馆', count: 5 },
];

/** Renders the panel over a mutable override map and re-renders after every change. */
function harness(init: Record<string, WordOverride> = {}, words: WordCount[] = WORDS) {
  let current = init;
  const setOverrides = vi.fn((fn: (o: Record<string, WordOverride>) => Record<string, WordOverride>) => {
    current = fn(current);
    view.rerender(ui());
  });
  const ui = () => (
    <WordsPanel
      words={words} options={DEFAULT_ANALYZE_OPTIONS} setOptions={() => {}}
      onHover={() => {}} hovered={null}
      overrides={current} setOverrides={setOverrides} />
  );
  const view = render(ui());
  return { get: () => current };
}

const pencil = (i = 0) => screen.getAllByTitle(/在云上显示的字/)[i];
const rotateBtn = (i = 0) => screen.getAllByRole('button', { name: /横排|竖排|横竖/ })[i];

describe('WordsPanel display name', () => {
  it('the pencil turns the row into an input and Enter writes display', async () => {
    const user = userEvent.setup();
    const h = harness();
    expect(screen.queryByLabelText('显示名')).toBeNull();
    await user.click(pencil());
    const input = screen.getByLabelText('显示名') as HTMLInputElement;
    expect(input.value).toBe('西德妮');
    await user.clear(input);
    await user.type(input, 'Sydney{Enter}');
    expect(h.get()['西德妮'].display).toBe('Sydney');
    // The row shows the original alongside the new name, and the editor is gone.
    expect(screen.queryByLabelText('显示名')).toBeNull();
    expect(screen.getByText('西德妮 →')).toBeTruthy();
  });

  it('Escape cancels without writing anything', async () => {
    const user = userEvent.setup();
    const h = harness();
    await user.click(pencil());
    const input = screen.getByLabelText('显示名') as HTMLInputElement;
    await user.clear(input);
    await user.type(input, 'Sydney{Escape}');
    expect(h.get()).toEqual({});
    expect(screen.queryByLabelText('显示名')).toBeNull();
  });

  it('a renamed word cannot be split any more', async () => {
    const user = userEvent.setup();
    harness();
    expect((screen.getAllByTitle(/拆开，不当成一个词/)[0] as HTMLButtonElement).disabled).toBe(false);
    await user.click(pencil());
    await user.type(screen.getByLabelText('显示名'), 'X{Enter}');
    const split = screen.getByTitle('已改显示名的词不能再拆') as HTMLButtonElement;
    expect(split.disabled).toBe(true);
  });
});

describe('WordsPanel rotation', () => {
  it('one click stands the word up, the next lays it flat (auto comes back via the chip)', async () => {
    const user = userEvent.setup();
    const h = harness();
    await user.click(rotateBtn());
    expect(h.get()['西德妮'].rotate).toBe('v');
    await user.click(rotateBtn());
    expect(h.get()['西德妮'].rotate).toBe('h');
    await user.click(rotateBtn());
    expect(h.get()['西德妮'].rotate).toBe('v');
  });
});

describe('WordsPanel edit chips', () => {
  it('a chip per override undoes it', async () => {
    const user = userEvent.setup();
    const h = harness({ '西德妮': { display: 'Sydney' }, '咖啡馆': { rotate: 'v' } });
    const chips = screen.getAllByTitle('撤销这条改动');
    expect(chips.length).toBe(2);
    await user.click(chips[0]);
    expect(h.get()['西德妮']).toBeUndefined();
    await user.click(screen.getAllByTitle('撤销这条改动')[0]);
    expect(h.get()).toEqual({});
  });
});

/** Word list with kinds, so same-kind candidate ranking is observable. */
const KINDED: WordCount[] = [
  { text: '西德妮', count: 12, kind: 'person' },
  { text: 'sydney', count: 7, kind: 'person' },
  { text: '咖啡馆', count: 5, kind: 'place' },
];

const equalsBtn = (i = 0) => screen.getAllByTitle(/把别的词并入/)[i];
const aliasInput = () => screen.getByLabelText(/要并入/) as HTMLInputElement;

describe('WordsPanel equivalence mode', () => {
  it('the ≡ button turns the search box into the merge input, and × leaves', async () => {
    const user = userEvent.setup();
    harness({}, KINDED);
    expect(screen.queryByLabelText(/要并入/)).toBeNull();
    await user.click(equalsBtn());
    expect(aliasInput().placeholder).toBe('输入要并入「西德妮」的词');
    await user.click(screen.getByTitle('退出等价模式'));
    expect(screen.queryByLabelText(/要并入/)).toBeNull();
    expect(screen.getByPlaceholderText('搜索')).toBeTruthy();
  });

  it('candidates exclude the target, rank same-kind first, and filter as you type', async () => {
    const user = userEvent.setup();
    harness({}, KINDED);
    await user.click(equalsBtn());
    const names = () => screen.getAllByTitle(/把「.+」并入/).map((b) => b.textContent);
    // No input yet: same kind (sydney) outranks the other kind, and the target is not listed.
    expect(names()[0]).toContain('sydney');
    expect(names().some((n) => n?.includes('西德妮'))).toBe(false);
    await user.type(aliasInput(), '咖啡');
    expect(names().length).toBe(1);
    expect(names()[0]).toContain('咖啡馆');
  });

  it('Enter takes the first candidate and writes alias', async () => {
    const user = userEvent.setup();
    const h = harness({}, KINDED);
    await user.click(equalsBtn());
    await user.type(aliasInput(), 'syd{Enter}');
    expect(h.get()['sydney'].alias).toBe('西德妮');
    // Mode closes and the undo chip appears.
    expect(screen.queryByLabelText(/要并入/)).toBeNull();
    expect(screen.getByText('等价')).toBeTruthy();
  });

  it('a merge that would close a loop is refused with a message', async () => {
    const user = userEvent.setup();
    const h = harness({ '西德妮': { alias: 'sydney' } }, KINDED);
    // Now merging sydney into 西德妮 would be a cycle.
    await user.click(equalsBtn());
    await user.type(aliasInput(), 'syd{Enter}');
    expect(h.get()['sydney']).toBeUndefined();
    expect(screen.getByText(/会绕圈/)).toBeTruthy();
  });

  it('with no candidate, Enter falls back to renaming the target', async () => {
    const user = userEvent.setup();
    const h = harness({}, KINDED);
    await user.click(equalsBtn());
    await user.type(aliasInput(), 'zzz{Enter}');
    expect(screen.getByText('没有匹配的词，已改为只修改显示名')).toBeTruthy();
    const input = screen.getByLabelText('显示名') as HTMLInputElement;
    expect(input.value).toBe('zzz');
    await user.type(input, '{Enter}');
    expect(h.get()['西德妮'].display).toBe('zzz');
  });

  it('the 等价 chip undoes the alias', async () => {
    const user = userEvent.setup();
    const h = harness({ 'sydney': { alias: '西德妮' } }, KINDED);
    await user.click(screen.getByTitle('撤销这条改动'));
    expect(h.get()['sydney']).toBeUndefined();
  });
});

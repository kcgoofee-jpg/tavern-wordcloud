// @vitest-environment happy-dom
/**
 * Making the equivalence action findable.
 *
 * The feature shipped and the user still asked whether it existed: six 13px icons
 * on every row, none of them saying 等价. These cases pin the three things that
 * changed — the row volunteers a candidate when it has one, the icon lights up on
 * that row, and every tooltip on the button names the feature — plus the row
 * layout that had to hold the new chip.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ANALYZE_OPTIONS } from '../../src/core/analyze';
import type { WordCount, WordOverride } from '../../src/core/types';
import { WordsPanel } from '../../src/ui/panels';
import type { CorefGroup } from '../../src/core/entities';

afterEach(cleanup);

/** 西德妮 / sydney is a transliteration pair; 咖啡 sits inside 咖啡厅 but is not it. */
const WORDS: WordCount[] = [
  { text: '西德妮', count: 12, kind: 'person' },
  { text: 'sydney', count: 7, kind: 'person' },
  { text: '咖啡厅', count: 6, kind: 'place' },
  { text: '咖啡', count: 4 },
];

function harness(init: Record<string, WordOverride> = {}, words: WordCount[] = WORDS, coref?: CorefGroup[]) {
  let current = init;
  const setOverrides = vi.fn((fn: (o: Record<string, WordOverride>) => Record<string, WordOverride>) => {
    current = fn(current);
    view.rerender(ui());
  });
  const ui = () => (
    <WordsPanel
      words={words} options={DEFAULT_ANALYZE_OPTIONS} setOptions={() => {}}
      onHover={() => {}} hovered={null}
      overrides={current} setOverrides={setOverrides} coref={coref} corefSplit={[]} onSplitCoref={() => {}} />
  );
  const view = render(ui());
  return { get: () => current, view };
}

/** The suggestion chips, in row order. */
const tips = () => [...document.querySelectorAll('.alias-tip')] as HTMLButtonElement[];
/** The equivalence icon buttons — every state's tooltip starts with the feature's name. */
const equalsBtns = () => screen.getAllByTitle(/^等价：/) as HTMLButtonElement[];
const rowOf = (text: string) =>
  [...document.querySelectorAll('li')].find((li) => li.querySelector('.word')?.textContent?.startsWith(text))!;

describe('equivalence suggestion on the row', () => {
  it('volunteers the other spelling, on the side that absorbs it, and names it', () => {
    harness();
    expect(tips().length).toBe(1);
    const tip = tips()[0];
    // The chip sits on 西德妮 (the more frequent form), not on sydney: one pair, one chip.
    expect(rowOf('西德妮').contains(tip)).toBe(true);
    expect(rowOf('sydney').querySelector('.alias-tip')).toBeNull();
    // It says the feature's name and the word it found.
    expect(tip.textContent).toContain('等价？');
    expect(tip.textContent).toContain('sydney');
    expect(tip.title).toContain('sydney');
    expect(tip.title).toContain('西德妮');
  });

  it('does not volunteer a word that is merely contained in another', () => {
    harness();
    // 咖啡 is inside 咖啡厅, which is a part, not an equivalent; no row offers it.
    expect(tips().map((b) => b.textContent).join(' ')).not.toContain('咖啡');
  });

  it('does not volunteer two different English words that merely look alike', () => {
    // letter/better score 0.6+ on spelling, which alone cleared the floor (0.6 × 6 = 3.6 > 3.5):
    // every look-alike pair in an English log recommended each other (2026-09-08). Spelling may
    // strengthen a suggestion that another signal started, never start one.
    harness({}, [{ text: 'letter', count: 10 }, { text: 'better', count: 8 }, { text: 'station', count: 9 }, { text: 'nation', count: 7 }]);
    expect(tips().map((b) => b.textContent).join(' '), 'no chip on any row').toBe('');
  });

  it('says nothing about a word that is already merged somewhere', () => {
    harness({ sydney: { alias: '西德妮' } });
    expect(tips().length).toBe(0);
  });

  it('lights the icon only on the row that has a suggestion', () => {
    harness();
    const lit = equalsBtns().filter((b) => b.className.includes('hot'));
    expect(lit.length).toBe(1);
    expect(rowOf('西德妮').contains(lit[0])).toBe(true);
  });
});

describe('equivalence vocabulary', () => {
  it('every state of the button leads with the feature name', async () => {
    const user = userEvent.setup();
    harness();
    // Idle and suggested rows both.
    expect(equalsBtns().length).toBe(WORDS.length);
    expect(equalsBtns()[0].title).toContain('等价');
    expect(equalsBtns()[2].title).toContain('等价');
    // And the mode it opens announces itself by the same name.
    await user.click(equalsBtns()[0]);
    expect(screen.getByText(/^等价：/)).toBeTruthy();
  });
});

describe('equivalence suggestion behaviour', () => {
  it('the chip opens the same picker the icon does, and merging still works', async () => {
    const user = userEvent.setup();
    const h = harness();
    expect(screen.queryByLabelText(/要并入/)).toBeNull();
    await user.click(tips()[0]);
    // Equivalence mode for 西德妮, with the suggested word first in the list.
    expect((screen.getByLabelText(/要并入/) as HTMLInputElement).placeholder)
      .toBe('输入要并入「西德妮」的词');
    const cands = screen.getAllByTitle(/把「.+」并入/);
    expect(cands[0].textContent).toContain('sydney');
    await user.click(cands[0]);
    expect(h.get()['sydney'].alias).toBe('西德妮');
    // The picker closes and the chip is gone: the pair is merged.
    expect(screen.queryByLabelText(/要并入/)).toBeNull();
    expect(tips().length).toBe(0);
  });

  it('the icon still opens the picker for its own row', async () => {
    const user = userEvent.setup();
    harness();
    await user.click(equalsBtns()[2]);
    expect((screen.getByLabelText(/要并入/) as HTMLInputElement).placeholder)
      .toBe('输入要并入「咖啡厅」的词');
  });
});

describe('word-table row layout', () => {
  it('a row keeps its four grid cells however many chips it carries', () => {
    // The row is a four-track grid; a fifth child would auto-place onto a second line,
    // dropping the count and the whole icon strip below the word.
    harness({}, [{ text: '赵一文', count: 49 }, { text: '西德妮', count: 12, kind: 'person' }, { text: 'sydney', count: 7, kind: 'person' }],
      [{ full: '赵一文', aliases: ['小赵'] }]);
    const rows = [...document.querySelectorAll('.wordlist.words-edit > li')];
    expect(rows.length).toBe(3);
    for (const li of rows) expect(li.children.length).toBe(4);
    // Both kinds of chip live inside the word cell, next to the word itself.
    expect(rowOf('赵一文').querySelector('.word-cell > .coref-tag')).toBeTruthy();
    expect(rowOf('西德妮').querySelector('.word-cell > .alias-tip')).toBeTruthy();
  });
});

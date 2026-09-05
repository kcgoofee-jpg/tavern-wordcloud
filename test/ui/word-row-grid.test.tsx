// @vitest-environment happy-dom
/** A coref chip must stay inside the word cell, not become a fifth grid item. */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_ANALYZE_OPTIONS } from '../../src/core/analyze';
import type { WordCount } from '../../src/core/types';
import { WordsPanel } from '../../src/ui/panels';
import type { CorefGroup } from '../../src/core/entities';

afterEach(cleanup);

describe('WordsPanel row grid', () => {
  const words: WordCount[] = [
    { text: '赵一文', count: 49 },
    { text: '咖啡馆', count: 5 },
  ];
  const groups: CorefGroup[] = [{ full: '赵一文', aliases: ['小赵'] }];

  it('a merged name still has four grid children; the chip lives in the word cell', () => {
    const { container } = render(
      <WordsPanel
        words={words} options={DEFAULT_ANALYZE_OPTIONS} setOptions={() => {}}
        onHover={() => {}} hovered={null}
        overrides={{}} setOverrides={() => {}}
        coref={groups} corefSplit={[]} onSplitCoref={() => {}} />,
    );
    const row = container.querySelector('.wordlist li') as HTMLElement;
    expect(row).toBeTruthy();
    const kids = [...row.children];
    expect(kids.map((el) => el.className)).toEqual(['rank', 'word-cell', 'count', 'row-acts']);
    expect(row.querySelector('.word-cell .coref-tag')).toBeTruthy();
    expect(kids.some((el) => el.classList.contains('coref-tag'))).toBe(false);
  });
});

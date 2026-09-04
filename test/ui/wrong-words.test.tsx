// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ANALYZE_OPTIONS, type AnalyzeOptions } from '../../src/core/analyze';
import { AdvancedPanel } from '../../src/ui/panels';

afterEach(cleanup);

function setup(tokenize: Partial<AnalyzeOptions['tokenize']> = {}) {
  let opts: AnalyzeOptions = {
    ...DEFAULT_ANALYZE_OPTIONS,
    tokenize: { ...DEFAULT_ANALYZE_OPTIONS.tokenize, ...tokenize },
  };
  const setOptions = vi.fn((fn: (o: AnalyzeOptions) => AnalyzeOptions) => { opts = fn(opts); });
  const view = render(<AdvancedPanel options={opts} setOptions={setOptions} />);
  const rerender = () => view.rerender(<AdvancedPanel options={opts} setOptions={setOptions} />);
  const rows = () => Array.from(view.container.querySelectorAll('.wrong-words-row'));
  const inputs = (i: number) =>
    Array.from(rows()[i].querySelectorAll('input')) as HTMLInputElement[];
  return { view, rerender, rows, inputs, get options() { return opts; } };
}

/** F9: "wrong word → correct words" writes the left side to splitWords, the right side to forceWords. */
describe('wrong word rules', () => {
  it('commits a new rule into both fields on blur', () => {
    const s = setup();
    expect(s.rows()).toHaveLength(1); // one blank row to start
    const [wrong, right] = s.inputs(0);
    fireEvent.change(wrong, { target: { value: '沈砚秋是' } });
    fireEvent.change(right, { target: { value: '沈砚秋 是' } });
    expect(s.options.tokenize.splitWords).toEqual([]); // nothing while typing
    fireEvent.blur(right);
    expect(s.options.tokenize.splitWords).toEqual(['沈砚秋是']);
    expect(s.options.tokenize.forceWords).toEqual(['沈砚秋', '是']);
  });

  it('rejects a self-referencing rule and shows the error', () => {
    const s = setup();
    const [wrong, right] = s.inputs(0);
    fireEvent.change(wrong, { target: { value: '沈砚秋' } });
    fireEvent.change(right, { target: { value: '沈砚秋 秋' } });
    fireEvent.blur(right);
    expect(s.rows()[0].querySelector('.wrong-words-err')?.textContent)
      .toContain('正确词不能是错词本身');
    expect(s.options.tokenize.splitWords).toEqual([]);
    expect(s.options.tokenize.forceWords).toEqual([]);
  });

  it('truncates to five correct words and says so', () => {
    const s = setup();
    const [wrong, right] = s.inputs(0);
    fireEvent.change(wrong, { target: { value: '一二三四五六' } });
    fireEvent.change(right, { target: { value: '一 二 三 四 五 六' } });
    fireEvent.blur(right);
    expect(s.rows()[0].querySelector('.wrong-words-err')?.textContent).toContain('最多 5 个');
    expect(s.options.tokenize.forceWords).toEqual(['一', '二', '三', '四', '五']);
  });

  it('shows a half rule for a splitWords entry with no targets', () => {
    const s = setup({ splitWords: ['盛集团'] });
    const [wrong, right] = s.inputs(0);
    expect(wrong.value).toBe('盛集团');
    expect(right.value).toBe('');
    expect(right.placeholder).toBe('（只拆开）');
    // The user can complete it.
    fireEvent.change(right, { target: { value: '盛 集团' } });
    fireEvent.blur(right);
    expect(s.options.tokenize.splitWords).toEqual(['盛集团']);
    expect(s.options.tokenize.forceWords).toEqual(['盛', '集团']);
  });

  it('deletes a rule and clears what it had written', () => {
    const s = setup();
    const [wrong, right] = s.inputs(0);
    fireEvent.change(wrong, { target: { value: '沈砚秋是' } });
    fireEvent.change(right, { target: { value: '沈砚秋' } });
    fireEvent.blur(right);
    s.rerender();
    expect(s.options.tokenize.splitWords).toEqual(['沈砚秋是']);
    fireEvent.click(s.rows()[0].querySelector('button') as HTMLButtonElement);
    expect(s.options.tokenize.splitWords).toEqual([]);
    expect(s.options.tokenize.forceWords).toEqual([]);
    expect(s.rows()).toHaveLength(1);
  });
});

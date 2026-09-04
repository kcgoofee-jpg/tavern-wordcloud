// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ANALYZE_OPTIONS, type AnalyzeOptions } from '../../src/core/analyze';
import { AdvancedPanel } from '../../src/ui/panels';

afterEach(cleanup);

/** Enter in the word lists must add a line, not re-run the analysis on every keystroke. */
describe('advanced word lists', () => {
  it('keeps the newline while typing and commits the list on blur', () => {
    let opts: AnalyzeOptions = { ...DEFAULT_ANALYZE_OPTIONS };
    const setOptions = vi.fn((fn: (o: AnalyzeOptions) => AnalyzeOptions) => { opts = fn(opts); });
    const { container } = render(<AdvancedPanel options={opts} setOptions={setOptions} />);
    const box = container.querySelectorAll('textarea')[0] as HTMLTextAreaElement; // 不显示这些词
    expect(Number(box.rows)).toBe(2);
    fireEvent.change(box, { target: { value: '沈砚秋\n' } });
    expect(box.value).toBe('沈砚秋\n');
    expect(setOptions).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: '沈砚秋\n中央戏剧学院' } });
    fireEvent.blur(box);
    expect(setOptions).toHaveBeenCalledTimes(1);
    expect(opts.tokenize.extraStopwords).toEqual(['沈砚秋', '中央戏剧学院']);
  });
});

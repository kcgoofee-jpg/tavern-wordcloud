// @vitest-environment happy-dom
/** The trailing blank rule row is for typing the next one; deleting it is a no-op. */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ANALYZE_OPTIONS, type AnalyzeOptions } from '../../src/core/analyze';
import { AdvancedPanel } from '../../src/ui/panels';

afterEach(cleanup);

describe('wrong-word placeholder row', () => {
  it('the empty last row cannot be deleted', () => {
    let opts: AnalyzeOptions = DEFAULT_ANALYZE_OPTIONS;
    render(<AdvancedPanel options={opts} setOptions={vi.fn((fn) => { opts = fn(opts); })} />);
    const btn = document.querySelector('.wrong-words-row button') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe('删除这条规则');
  });
});

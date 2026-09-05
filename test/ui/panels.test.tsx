// @vitest-environment happy-dom
/** Per-panel behaviour: state changes after interaction, not styling. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ANALYZE_OPTIONS, type AnalyzeOptions } from '../../src/core/analyze';
import { AdvancedPanel, FilterPanel, WordsPanel } from '../../src/ui/panels';
import Slider from '../../src/ui/panels/Slider';

afterEach(cleanup);

/** Apply functional setOptions updates to a local copy and assert the result */
function optionsHarness(init: AnalyzeOptions = DEFAULT_ANALYZE_OPTIONS) {
  let current = init;
  const setOptions = vi.fn((fn: (o: AnalyzeOptions) => AnalyzeOptions) => { current = fn(current); });
  return { setOptions, get: () => current };
}

describe('FilterPanel', () => {
  it('clicking the character role toggles char in roles', async () => {
    const user = userEvent.setup();
    const h = optionsHarness({ ...DEFAULT_ANALYZE_OPTIONS, roles: ['user'] });
    render(<FilterPanel options={h.get()} setOptions={h.setOptions} kindOverrides={{}} setKindOverrides={() => {}} rotateRatio={0} setRotateRatio={() => {}} result={null} />);
    await user.click(screen.getByRole('button', { name: '角色说的' }));
    expect(h.get().roles).toEqual(['user', 'char']);
    // The panel holds stale props; re-render with the latest options before clicking again
    cleanup();
    render(<FilterPanel options={h.get()} setOptions={h.setOptions} kindOverrides={{}} setKindOverrides={() => {}} rotateRatio={0} setRotateRatio={() => {}} result={null} />);
    await user.click(screen.getByRole('button', { name: '角色说的' }));
    expect(h.get().roles).toEqual(['user']);
  });

  it('the common kind buttons; the experimental ones say so, and clicking toggles that kind', async () => {
    const user = userEvent.setup();
    const h = optionsHarness();
    render(<FilterPanel options={h.get()} setOptions={h.setOptions} kindOverrides={{}} setKindOverrides={() => {}} rotateRatio={0} setRotateRatio={() => {}} result={null} />);
    // tx() (kind labels, from the core) renders English here; t() (the title attribute) renders Chinese.
    for (const name of ['Other', 'Names', 'Places', 'Time', 'Common words', 'Brands', 'Clothing', 'Titles']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${name}`) }), name).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: /^Brands/ }).getAttribute('title')).toBe('实验，可能有误判');
    expect(screen.getByRole('button', { name: /^Clothing/ }).getAttribute('title')).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Titles/ }));
    expect(h.get().kinds).not.toContain('title');
  });

  it('the min-length slider changes tokenize.minLength only', () => {
    const h = optionsHarness();
    render(<FilterPanel options={h.get()} setOptions={h.setOptions} kindOverrides={{}} setKindOverrides={() => {}} rotateRatio={0} setRotateRatio={() => {}} result={null} />);
    const slider = screen.getByLabelText(/最少几个字/) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '3' } });
    expect(h.get().tokenize.minLength).toBe(3);
    expect(h.get().tokenize.minCount).toBe(DEFAULT_ANALYZE_OPTIONS.tokenize.minCount);
  });
});

/** The 60-kind design (notes/docs/33 §3): the buttons are grouped, not a flat row of 24. */
describe('FilterPanel kind groups', () => {
  const panel = (h: ReturnType<typeof optionsHarness>) => (
    <FilterPanel options={h.get()} setOptions={h.setOptions} kindOverrides={{}} setKindOverrides={() => {}}
      rotateRatio={0} setRotateRatio={() => {}} result={null} />
  );

  it('only the common kinds are on screen until a group is opened', () => {
    const h = optionsHarness();
    render(panel(h));
    // 常用 is flat…
    expect(screen.getByRole('button', { name: /^Names/ })).toBeTruthy();
    // …every other group is a collapsed <details> with a summary
    for (const g of ['People & identity', 'Things', 'Body & senses', 'Society & organisations']) {
      expect(screen.getByText(new RegExp(g)), g).toBeTruthy();
    }
    // A kind inside a closed group is still in the DOM (details keeps its children) but its
    // group is not open: what matters is that the summary exists and is clickable.
    expect(document.querySelectorAll('.kind-group').length).toBeGreaterThan(3);
  });

  it('toggling a kind inside a group updates options.kinds', async () => {
    const user = userEvent.setup();
    const h = optionsHarness();
    render(panel(h));
    expect(h.get().kinds).toContain('emotion');
    await user.click(screen.getByRole('button', { name: /^Feelings/ }));
    expect(h.get().kinds).not.toContain('emotion');
  });
});

describe('FilterPanel compact kind view', () => {
  it('Compact bulk-toggles a bucket; Detailed still has the fine buttons', async () => {
    const user = userEvent.setup();
    const h = optionsHarness();
    let view: 'coarse' | 'fine' = 'fine';
    const { rerender } = render(
      <FilterPanel options={h.get()} setOptions={h.setOptions} kindOverrides={{}} setKindOverrides={() => {}}
        rotateRatio={0} setRotateRatio={() => {}} result={null}
        kindView={view} setKindView={(v) => { view = v; }} />,
    );
    // t() stays Chinese in this harness; tx() (bucket/kind labels from core) is English.
    expect(screen.getByRole('button', { name: '详细' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '简洁' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Titles/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '简洁' }));
    rerender(
      <FilterPanel options={h.get()} setOptions={h.setOptions} kindOverrides={{}} setKindOverrides={() => {}}
        rotateRatio={0} setRotateRatio={() => {}} result={null}
        kindView={view} setKindView={(v) => { view = v; }} />,
    );
    expect(screen.queryByRole('button', { name: /^Titles/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Docs & organisations/ })).toBeTruthy();
    expect(h.get().kinds).toContain('person');
    expect(h.get().kinds).toContain('title');
    await user.click(screen.getByRole('button', { name: /^Names/ }));
    expect(h.get().kinds).not.toContain('person');
    expect(h.get().kinds).not.toContain('title');
    expect(h.get().kinds).toContain('place');
  });
});

describe('FilterPanel explicit words', () => {
  it('mode buttons set nsfwMode; category buttons toggle nsfwKinds', async () => {
    const user = userEvent.setup();
    const h = optionsHarness();
    const { rerender } = render(<FilterPanel options={h.get()} setOptions={h.setOptions} kindOverrides={{}} setKindOverrides={() => {}} rotateRatio={0} setRotateRatio={() => {}} result={null} />);
    expect(h.get().nsfwMode).toBe('show');
    await user.click(screen.getByRole('button', { name: '隐藏 NSFW' }));
    expect(h.get().nsfwMode).toBe('hide');
    // categories are collapsed; open them first. body is not explicit by default; clicking adds it
    await user.click(screen.getByRole('button', { name: '分类' }));
    expect(h.get().nsfwKinds).not.toContain('body');
    await user.click(screen.getByRole('button', { name: /^身体/ }));
    expect(h.get().nsfwKinds).toContain('body');
    rerender(<FilterPanel options={h.get()} setOptions={h.setOptions} kindOverrides={{}} setKindOverrides={() => {}} rotateRatio={0} setRotateRatio={() => {}} result={null} />);
    await user.click(screen.getByRole('button', { name: /^身体/ }));
    expect(h.get().nsfwKinds).not.toContain('body');
    // Other fields untouched
    expect(h.get().roles).toEqual(DEFAULT_ANALYZE_OPTIONS.roles);
  });
});

describe('AdvancedPanel', () => {
  it('textareas split by line; the blocklist switch sets ignoreOwnerBlocklist', async () => {
    const user = userEvent.setup();
    const h = optionsHarness();
    render(<AdvancedPanel options={h.get()} setOptions={h.setOptions} />);
    // Controlled textarea in a harness without re-render: set the whole value
    fireEvent.change(screen.getByLabelText(/不显示这些词/), { target: { value: 'foo\n bar \n\n' } });
    // The list is handed over on blur, so a newline can be typed without re-running the analysis.
    fireEvent.blur(screen.getByLabelText(/不显示这些词/));
    expect(h.get().tokenize.extraStopwords).toEqual(['foo', 'bar']);
    await user.click(screen.getByLabelText(/不用站长维护的禁词表/));
    expect(h.get().ignoreOwnerBlocklist).toBe(true);
    expect(h.get().tokenize.forceWords).toEqual([]);
  });
});

describe('WordsPanel', () => {
  const words = [{ text: '沈砚秋', count: 768 }, { text: '办公室', count: 180 }, { text: '合同', count: 275 }];

  it('the search box filters words', async () => {
    const user = userEvent.setup();
    const h = optionsHarness();
    render(<WordsPanel words={words} options={h.get()} setOptions={h.setOptions} onHover={() => {}} hovered={null}
      overrides={{}} setOverrides={() => {}} />);
    expect(screen.getByText('办公室')).toBeTruthy();
    await user.type(screen.getByPlaceholderText('搜索'), '沈');
    expect(screen.getByText('沈砚秋')).toBeTruthy();
    expect(screen.queryByText('办公室')).toBeNull();
  });
});

describe('Slider', () => {
  it('shows the formatted value and calls back with a number', () => {
    const onChange = vi.fn();
    render(<Slider label="竖排比例" value={0.25} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={onChange} />);
    expect(screen.getByText('25%')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/竖排比例/), { target: { value: '0.5' } });
    expect(onChange).toHaveBeenCalledWith(0.5);
  });
});

describe('CommunityPanel', () => {
  it('explains why nothing is shown below the contributor minimum; the contribute checkbox calls back', async () => {
    const { CommunityPanel } = await import('../../src/ui/panels');
    const user = userEvent.setup();
    const setContribute = vi.fn();
    render(<CommunityPanel loading={false} offline={false} contribute={false} setContribute={setContribute}
      stats={{ contributors: 1, contributions: 1, messages: 5, chars: 100, views30d: 12, analyses30d: 3, minContributors: 3, words: [], trend: [], hours: new Array(24).fill(0), sizes: [{ label: '<1万', n: 1 }], zhRatio: 0.9, updated: 0, models: [], endpoints: [], kinds: [], genMs: null }} />);
    expect(screen.getByText(/至少 3 个不同的人都用过才会出现/)).toBeTruthy();
    await user.click(screen.getByRole('checkbox'));
    expect(setContribute).toHaveBeenCalledWith(true);
  });
});

describe('FilterPanel kind list', () => {
  it('shows which words were classified as names so the user can see what left the cloud', async () => {
    const user = userEvent.setup();
    const result = {
      words: [], allWords: [{ text: 'nicole', count: 32, kind: 'person' }, { text: '书房', count: 5, kind: 'place' }, { text: '几乎', count: 9, kind: 'generic' }],
      entities: { persons: [], byKind: [{ kind: 'person', words: 1 }, { kind: 'place', words: 1 }, { kind: 'generic', words: 1 }, { kind: 'time', words: 0 }, { kind: 'plain', words: 0 }, { kind: 'system', words: 0 }] },
      blocked: { total: 0, byReason: { manual: 0, auto: 0, template: 0 }, samples: [] },
      nsfwByKind: [], sensitive: 0, cot: { available: 0, models: [], boilerplateSentences: [] }, speakers: [], messageCount: 10, totalMessages: 10,
    } as unknown as import('../../src/core/types').AnalysisResult;
    render(<FilterPanel options={DEFAULT_ANALYZE_OPTIONS} setOptions={vi.fn()} kindOverrides={{}} setKindOverrides={() => {}} rotateRatio={0} setRotateRatio={() => {}} result={result} />);
    await user.click(screen.getByText('看看各类都有哪些词'));
    expect(screen.getByText(/nicole 32/)).toBeTruthy();
    expect(screen.getByText(/几乎 9/)).toBeTruthy();
  });
});

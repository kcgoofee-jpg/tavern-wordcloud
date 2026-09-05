// @vitest-environment happy-dom
/** Compact filter badges count primary kind, not summed secondary tags. */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ANALYZE_OPTIONS } from '../../src/core/analyze';
import { FilterPanel } from '../../src/ui/panels';
import type { AnalysisResult } from '../../src/core/types';

afterEach(cleanup);

describe('FilterPanel compact bucket counts', () => {
  it('赵总 is one Names badge, not person+title', () => {
    const result = {
      words: [],
      allWords: [
        { text: '赵总', count: 8, kind: 'person', kinds: [{ kind: 'person', conf: 0.95 }, { kind: 'title', conf: 0.7 }] },
        { text: '朝阳区', count: 5, kind: 'place', kinds: [{ kind: 'place', conf: 0.85 }, { kind: 'region', conf: 0.323 }] },
      ],
      entities: {
        persons: [],
        byKind: [
          { kind: 'person', words: 1 },
          { kind: 'title', words: 1 },
          { kind: 'place', words: 1 },
          { kind: 'region', words: 1 },
        ],
      },
      blocked: { total: 0, byReason: { manual: 0, auto: 0, template: 0 }, samples: [] },
      nsfwByKind: [],
      sensitive: 0,
      cot: { available: 0, models: [], boilerplateSentences: [] },
      speakers: [],
      messageCount: 10,
      totalMessages: 10,
    } as unknown as AnalysisResult;

    render(
      <FilterPanel
        options={DEFAULT_ANALYZE_OPTIONS}
        setOptions={vi.fn()}
        kindOverrides={{}}
        setKindOverrides={() => {}}
        rotateRatio={0}
        setRotateRatio={() => {}}
        result={result}
        kindView="coarse"
      />,
    );

    // tx() is English in this harness. Summing byKind would show Names 2 / Places 2.
    expect(screen.getByRole('button', { name: /^Names 1$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Places 1$/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Names 2$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Places 2$/ })).toBeNull();
  });
});

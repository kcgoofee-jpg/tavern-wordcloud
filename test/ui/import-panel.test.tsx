// @vitest-environment happy-dom
/** Import panel: the card-rule-pack note (notes/docs/23) and its one-click undo. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import ImportPanel, { type ImportSummary } from '../../src/ui/ImportPanel';
import { DEFAULT_ANALYZE_OPTIONS } from '../../src/core/analyze';

afterEach(cleanup);

const summary: ImportSummary = { fileCount: 1, chars: 1000, characters: ['排练厅的下午'], bundle: null, fromZip: false };

function panel(props: Partial<ComponentProps<typeof ImportPanel>> = {}) {
  return render(
    <ImportPanel summary={summary} options={DEFAULT_ANALYZE_OPTIONS} setOptions={vi.fn()}
      busy={false} progress={null} onStart={vi.fn()} onCancel={vi.fn()} onConfigureAi={vi.fn()}
      contribute={false} hasServer={false} {...props} />,
  );
}

describe('ImportPanel: card rule pack note', () => {
  it('shows nothing when no saved rule pack was applied', () => {
    panel({ cardRuleApplied: null });
    expect(screen.queryByText(/自动套用/)).toBeNull();
  });

  it('shows nothing when the applied count is zero', () => {
    panel({ cardRuleApplied: 0 });
    expect(screen.queryByText(/自动套用/)).toBeNull();
  });

  it('shows the count and an undo button when a saved pack was applied, and undo calls back', () => {
    const onUndo = vi.fn();
    panel({ cardRuleApplied: 3, onUndoCardRule: onUndo });
    expect(screen.getByText(/这张卡有你之前保存的 3 条修正，已自动套用/)).toBeTruthy();
    const undoBtn = screen.getByRole('button', { name: '撤销本次套用' });
    fireEvent.click(undoBtn);
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});

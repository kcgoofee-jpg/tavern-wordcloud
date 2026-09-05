// @vitest-environment happy-dom
/** Import panel: the card-rule-pack note (notes/docs/23) and its one-click undo. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import ImportPanel, { type ImportSummary } from '../../src/ui/ImportPanel';
import { DEFAULT_ANALYZE_OPTIONS } from '../../src/core/analyze';
import { MAX_UPLOAD_BYTES } from '../../src/net/server';

afterEach(cleanup);

const summary: ImportSummary = { fileCount: 1, chars: 1000, uploadBytes: 3000, characters: ['排练厅的下午'], bundle: null, fromZip: false };

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

  /** A weak (name-only) match may be a different card that shares the name; the wording must not claim otherwise. */
  it('hedges the wording when only the weak fingerprint matched', () => {
    panel({ cardRuleApplied: 3, cardRuleWeak: true });
    expect(screen.queryByText(/这张卡有你之前保存的/)).toBeNull();
    expect(screen.getByText(/有一张同名的卡保存过 3 条修正/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '撤销本次套用' })).toBeTruthy();
  });
});

describe('ImportPanel: over the 10 MB upload cap', () => {
  /** The size shown must come from `uploadBytes`, not from `chars` — see notes/docs/31 §10.5. */
  const over = { ...summary, chars: 1_000_000, uploadBytes: MAX_UPLOAD_BYTES + 512 * 1024 };

  it('says the real upload size and the limit, and offers the local build for download', () => {
    panel({ hasServer: true, summary: over });
    expect(screen.getByText(/网页版上限 10 MB，这份传上去有 10\.5 MB/)).toBeTruthy();
    const link = screen.getByRole('link', { name: '下载本地版' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/download/index.html');
    expect(link.hasAttribute('download')).toBe(true);
  });

  it('stays quiet under the cap, and when there is no server to upload to', () => {
    panel({ hasServer: true, summary: { ...over, uploadBytes: MAX_UPLOAD_BYTES - 1 } });
    expect(screen.queryByText(/网页版上限 10 MB/)).toBeNull();
    cleanup();
    // A million characters would have tripped the old `chars * 3` estimate
    panel({ hasServer: false, summary: over });
    expect(screen.queryByText(/网页版上限 10 MB/)).toBeNull();
  });
});

describe('ImportPanel kind buckets', () => {
  it('shows the ops buckets, not the fine title/clothing buttons', () => {
    panel();
    for (const name of ['Names', 'Places', 'Time', 'Docs & organizations', 'Other', 'Common words']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${name}`) }), name).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: /^Titles/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Clothing/ })).toBeNull();
  });

  it('turning Names off drops person and title together', async () => {
    const user = userEvent.setup();
    let current = DEFAULT_ANALYZE_OPTIONS;
    const setOptions = vi.fn((fn: (o: typeof current) => typeof current) => { current = fn(current); });
    panel({ options: current, setOptions });
    await user.click(screen.getByRole('button', { name: /^Names/ }));
    expect(current.kinds).not.toContain('person');
    expect(current.kinds).not.toContain('title');
    expect(current.kinds).toContain('place');
  });
});

// @vitest-environment happy-dom
/**
 * Maintenance mode has to be visible before the visitor picks a file. /api/health has always
 * carried `mode`, but ServerHealth did not declare it, so nothing could react: the site let you
 * import, parse and start analysing, then failed with a toast (2026-09-05, reported).
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Landing from '../../src/ui/Landing';
import { DEFAULT_ANALYZE_OPTIONS } from '../../src/core/analyze';

afterEach(cleanup);

const base = {
  hasServer: true, keywordMode: false, aiReady: false,
  onCloudMode: () => {}, communityActive: false, onToggleCommunity: () => {},
  dark: false, onToggleScheme: () => {}, lang: 'zh' as const, onToggleLang: () => {},
  onPickFile: vi.fn(), onShowSample: () => {},
};

describe('maintenance mode on the landing page', () => {
  it('says so before the file picker, and offers the local build', () => {
    render(<Landing {...base} mode="maintenance" />);
    const notice = screen.getByText(/正在维护/);
    expect(notice).toBeTruthy();
    const drop = screen.getByRole('button', { name: /把聊天记录拖进来/ });
    // The notice must precede the picker in document order, or it is not a warning, it is a footnote.
    expect(notice.compareDocumentPosition(drop) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const link = notice.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/download/index.html');
  });

  it('stays quiet in normal mode', () => {
    render(<Landing {...base} mode="normal" />);
    expect(screen.queryByText(/正在维护/)).toBeNull();
  });

  it('stays quiet when there is no server at all', () => {
    render(<Landing {...base} hasServer={false} mode="maintenance" />);
    expect(screen.queryByText(/正在维护/)).toBeNull();
  });
});

describe('limited mode in the import panel', () => {
  it('warns before the run and names the cap the server is actually enforcing', async () => {
    const ImportPanel = (await import('../../src/ui/ImportPanel')).default;
    const summary = { fileCount: 1, chars: 100, uploadBytes: 1024, characters: ['A'], bundle: null, fromZip: false };
    render(<ImportPanel
      summary={summary} options={DEFAULT_ANALYZE_OPTIONS} setOptions={() => {}}
      busy={false} progress={null} onStart={() => {}} onCancel={() => {}} onConfigureAi={() => {}}
      contribute={false} hasServer mode="limited" maxBytes={5 * 1024 * 1024} />);
    const note = screen.getByText(/正在限流/);
    expect(note.textContent, 'names the real cap, not the built-in 10').toContain('5 MB');
  });
});

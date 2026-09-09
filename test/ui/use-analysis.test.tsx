// @vitest-environment happy-dom
/**
 * `useAnalysis` (ui/hooks/useAnalysis.ts): the fourth state home from AGENTS hard rule 8 —
 * the analysis result and the file set behind it. The rules it owns are the ones App used to
 * spell out at every call site: the full clear, the "a link or a PNG replaces the run" clear,
 * the progress overlay's 300 ms delay / 500 ms floor, and the toast's own lifetime.
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAnalysis } from '../../src/ui/hooks/useAnalysis';
import type { AnalysisResult } from '../../src/core/types';

/** Offline: no server behind the page, which is also the single-file build's situation. */
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))));

afterEach(() => { cleanup(); vi.useRealTimers(); });

/** Just enough of a result for the hook: it only ever stores and clears it. */
const fakeResult = (word: string): AnalysisResult => ({
  words: [{ text: word, count: 3 }],
  allWords: [{ text: word, count: 3 }],
  messageCount: 1, totalMessages: 1, rawChars: 10, cleanChars: 10,
  uniqueTokens: 1, countedTokens: 3, warnings: [], groups: [], perSource: [],
} as unknown as AnalysisResult);

describe('useAnalysis', () => {
  it('import → result → clear: the whole file set and result go away together', () => {
    const { result: hook } = renderHook(() => useAnalysis());
    expect(hook.current.hasFiles).toBe(false);
    expect(hook.current.result).toBeNull();

    // Import: files land in the ref, `loadSeq` ticks so the analysis effect re-runs.
    act(() => {
      hook.current.filesRef.current = [{ name: 'a.jsonl', content: '{}' }];
      hook.current.cardFpsRef.current = { alice: 'fp-1' };
      hook.current.setHasFiles(true);
      hook.current.setLoadSeq((n) => n + 1);
    });
    act(() => {
      hook.current.setResult(fakeResult('明月'));
      hook.current.setCardFp('fp-1');
      hook.current.setBundle({ characterCards: 1, worlds: [], warnings: [] } as never);
    });
    expect(hook.current.hasFiles).toBe(true);
    expect(hook.current.result?.words[0].text).toBe('明月');
    expect(hook.current.loadSeq).toBe(1);

    // Clear: one call, not nine setters at the call site.
    act(() => hook.current.clearData());
    expect(hook.current.hasFiles).toBe(false);
    expect(hook.current.result).toBeNull();
    expect(hook.current.bundle).toBeNull();
    expect(hook.current.cardFp).toBeNull();
    expect(hook.current.filesRef.current).toEqual([]);
    expect(hook.current.cardFpsRef.current).toEqual({});
  });

  it('a share link or a cloud PNG replaces the run without touching the card-rule state', () => {
    const { result: hook } = renderHook(() => useAnalysis());
    act(() => {
      hook.current.filesRef.current = [{ name: 'a.jsonl', content: '{}' }];
      hook.current.setHasFiles(true);
      hook.current.setResult(fakeResult('明月'));
      hook.current.setCardFp('fp-1');
    });
    act(() => hook.current.showSharedWords([{ text: '流水', count: 9 }]));
    expect(hook.current.sharedWords?.[0].text).toBe('流水');
    expect(hook.current.result).toBeNull();
    expect(hook.current.hasFiles).toBe(false);
    expect(hook.current.filesRef.current).toEqual([]);
    // No card came with the link, so the pack that was applied to the import is left alone.
    expect(hook.current.cardFp).toBe('fp-1');
  });

  it('hover: the pointed word is remembered, and null clears it', () => {
    const { result: hook } = renderHook(() => useAnalysis());
    expect(hook.current.hovered).toBeNull();
    act(() => hook.current.setHovered('明月'));
    expect(hook.current.hovered).toBe('明月');
    act(() => hook.current.setHovered(null));
    expect(hook.current.hovered).toBeNull();
  });

  it('share goes in and out; clearing the data drops the built link with it', () => {
    const { result: hook } = renderHook(() => useAnalysis());
    expect(hook.current.share).toBeNull();
    act(() => hook.current.setShare({ url: 'https://example.test/#c=xx', wordCount: 12, truncated: false }));
    expect(hook.current.share?.wordCount).toBe(12);
    act(() => hook.current.setShare(null));
    expect(hook.current.share).toBeNull();

    act(() => hook.current.setShare({ url: 'https://example.test/#c=xx', wordCount: 12, truncated: false }));
    act(() => hook.current.clearData());
    expect(hook.current.share).toBeNull();
  });

  it('the progress overlay waits 300 ms and then stays at least 500 ms', () => {
    vi.useFakeTimers();
    const { result: hook } = renderHook(() => useAnalysis());
    act(() => hook.current.setBusy(true));
    // A quick local recompute finishes inside the delay and must never flash the overlay.
    act(() => { vi.advanceTimersByTime(299); });
    expect(hook.current.showProgress).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(hook.current.showProgress).toBe(true);
    // Once shown it holds its floor rather than blinking out on a fast finish.
    act(() => hook.current.setBusy(false));
    act(() => { vi.advanceTimersByTime(499); });
    expect(hook.current.showProgress).toBe(true);
    act(() => { vi.advanceTimersByTime(1); });
    expect(hook.current.showProgress).toBe(false);
  });

  it('a plain toast dismisses itself after 5 s; one with an action gets 15 s', () => {
    vi.useFakeTimers();
    const { result: hook } = renderHook(() => useAnalysis());
    act(() => hook.current.setError({ kind: 'notice', title: '读到 2 条正则规则' }));
    act(() => { vi.advanceTimersByTime(4999); });
    expect(hook.current.error).not.toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(hook.current.error).toBeNull();

    act(() => hook.current.setError({ kind: 'notice', title: '加上角色说的', action: { label: '好', run: () => {} } }));
    act(() => { vi.advanceTimersByTime(5000); });
    expect(hook.current.error).not.toBeNull();
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(hook.current.error).toBeNull();
  });

  it('no server behind the page: health stays null and the analysis route is local', async () => {
    const { result: hook } = renderHook(() => useAnalysis());
    await waitFor(() => expect(hook.current.health).toBeNull());
    expect(hook.current.onServer).toBe(false);
    // No `meta[name=wc-served]` in the test document, so nothing is "blocked" either.
    expect(hook.current.served).toBe(false);
    expect(hook.current.apiBlocked).toBe(false);
  });
});

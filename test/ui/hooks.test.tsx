// @vitest-environment happy-dom
/** Hook rules: panel / card exclusivity and closing; transient flash; level-by-level settings merge. */
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useOverlay } from '../../src/ui/hooks/useOverlay';
import { useHashRoute } from '../../src/ui/hooks/useHashRoute';
import { useFlash } from '../../src/ui/hooks/useFlash';
import { loadSettings } from '../../src/ui/hooks/useSettings';
import { DEFAULT_SETTINGS } from '../../src/ui/settings';
import Note from '../../src/ui/Note';
import { phaseFraction } from '../../src/ui/hooks/progressModel';

afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); });

describe('useOverlay', () => {
  it('opening a panel closes the card and vice versa', () => {
    const { result } = renderHook(() => useOverlay<'theme' | 'words'>());
    act(() => result.current.openCard(true));
    expect(result.current.cardOpen).toBe(true);
    act(() => result.current.openPanel('theme'));
    expect(result.current.panel).toBe('theme');
    expect(result.current.cardOpen).toBe(false);
    act(() => result.current.openCard(true));
    expect(result.current.panel).toBeNull();
    expect(result.current.cardOpen).toBe(true);
  });

  it('outside click and Escape close; clicks inside do not', () => {
    const { result } = renderHook(() => useOverlay<'theme'>());
    const sheet = document.createElement('div'); sheet.className = 'sheet';
    document.body.append(sheet);
    act(() => result.current.openPanel('theme'));
    act(() => { sheet.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    expect(result.current.panel).toBe('theme');
    act(() => { document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    expect(result.current.panel).toBeNull();
    act(() => result.current.openPanel('theme'));
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(result.current.panel).toBeNull();
    sheet.remove();
  });

  it('the notice popover is exclusive with panels and the card, and closes on an outside click', () => {
    const { result } = renderHook(() => useOverlay<'theme'>());
    act(() => result.current.openPanel('theme'));
    act(() => result.current.toggleNotice());
    expect(result.current.noticeOpen).toBe(true);
    expect(result.current.panel).toBeNull();
    act(() => result.current.openCard(true));
    expect(result.current.noticeOpen).toBe(false);
    act(() => result.current.toggleNotice());
    expect(result.current.cardOpen).toBe(false);
    act(() => { document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    expect(result.current.noticeOpen).toBe(false);
  });

  it('the community button cycles: stats page → aggregate cloud only → off', () => {
    const { result } = renderHook(() => useOverlay<'theme' | 'community'>());
    act(() => result.current.cycleCommunity());
    expect(result.current.panel).toBe('community');
    expect(result.current.communityCloud).toBe(false);
    act(() => result.current.cycleCommunity());
    expect(result.current.panel).toBeNull();
    expect(result.current.communityCloud).toBe(true);
    // The sample view would cover the aggregate cloud, so it steps aside and comes back after.
    expect(result.current.sampleOpen).toBe(false);
    act(() => result.current.cycleCommunity());
    expect(result.current.panel).toBeNull();
    expect(result.current.communityCloud).toBe(false);
    expect(result.current.sampleOpen).toBe(true);
  });

  it('outside click does not dismiss the sample view or the community cloud', () => {
    const { result } = renderHook(() => useOverlay<'theme' | 'community'>());
    act(() => result.current.openPanel('theme'));
    act(() => { document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    expect(result.current.panel).toBeNull();
    expect(result.current.sampleOpen).toBe(true);

    act(() => result.current.cycleCommunity());
    act(() => result.current.cycleCommunity());
    expect(result.current.communityCloud).toBe(true);
    act(() => result.current.openPanel('theme'));
    expect(result.current.communityCloud).toBe(true);
    act(() => { document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    expect(result.current.panel).toBeNull();
    expect(result.current.communityCloud).toBe(true);
  });

  it('language, scheme and cloud-mode chrome are not outside clicks', () => {
    const { result } = renderHook(() => useOverlay<'theme'>());
    const nodes = ['.lang-quick', '.mode-quick', '.cloudmode', '.land-top'].map((cls) => {
      const el = document.createElement('button');
      el.className = cls.slice(1);
      document.body.append(el);
      return el;
    });
    act(() => result.current.openPanel('theme'));
    for (const el of nodes) {
      act(() => { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
      expect(result.current.panel, el.className).toBe('theme');
    }
    nodes.forEach((el) => el.remove());
  });

  it('the sample view is open at start, opens and closes, and closeAll dismisses it', () => {
    const { result } = renderHook(() => useOverlay<'theme'>());
    expect(result.current.sampleOpen).toBe(true);
    act(() => result.current.closeSample());
    expect(result.current.sampleOpen).toBe(false);
    act(() => result.current.openSample());
    expect(result.current.sampleOpen).toBe(true);
    act(() => result.current.closeSample());
    expect(result.current.sampleOpen).toBe(false);
    act(() => result.current.openSample());
    act(() => result.current.openPanel('theme'));
    act(() => result.current.closeAll());
    expect(result.current.sampleOpen).toBe(false);
    expect(result.current.panel).toBeNull();
  });
});

describe('useHashRoute', () => {
  afterEach(() => { window.location.hash = ''; });

  it('follows hashchange between legal routes and the main page', () => {
    const setHash = (h: string) => { window.location.hash = h; window.dispatchEvent(new HashChangeEvent('hashchange')); };
    const { result } = renderHook(() => useHashRoute());
    expect(result.current).toBeNull();
    act(() => setHash('#/terms'));
    expect(result.current).toBe('terms');
    act(() => setHash('#/enforcement'));
    expect(result.current).toBe('enforcement');
    // Share-link hashes are not routes
    act(() => setHash('#c=abc'));
    expect(result.current).toBeNull();
    act(() => setHash(''));
    expect(result.current).toBeNull();
  });
});

describe('Note', () => {
  it('opening and closing three times leaves no extra window listeners', async () => {
    const user = userEvent.setup();
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    try {
      render(<Note>说明内容</Note>);
      const btn = screen.getByRole('button', { name: '说明' });
      for (let i = 0; i < 3; i++) { await user.click(btn); await user.click(btn); }
      const watched = (calls: unknown[][]) =>
        calls.filter(([type]) => type === 'scroll' || type === 'resize').length;
      // Each open adds one scroll + one resize listener; every close must remove them again
      expect(watched(addSpy.mock.calls)).toBe(3 * 2);
      expect(watched(removeSpy.mock.calls)).toBe(watched(addSpy.mock.calls));
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });
});

describe('useFlash', () => {
  it('flash clears on its own; flash(false) clears immediately', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useFlash(1000));
    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);
    act(() => { vi.advanceTimersByTime(999); });
    expect(result.current[0]).toBe(true);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current[0]).toBe(false);
    act(() => result.current[1]());
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
  });
});

describe('loadSettings', () => {
  it('old saves get defaults for new fields', () => {
    localStorage.setItem('tw-settings', JSON.stringify({ themeId: 'custom', custom: { hue: 30 }, options: { roles: ['user', 'system'] } }));
    const s = loadSettings();
    expect(s.themeId).toBe('custom');
    expect(s.custom.hue).toBe(30);
    for (const k of Object.keys(DEFAULT_SETTINGS.custom)) expect(s.custom[k as keyof typeof s.custom]).not.toBeUndefined();
    expect(s.font).toEqual(DEFAULT_SETTINGS.font);
    expect(s.options.roles).not.toContain('system');   // Stale system-message selection is cleared
  });

  it('a partial nested options object does not drop newer tokenize/ai fields', () => {
    localStorage.setItem('tw-settings', JSON.stringify({
      options: { tokenize: { maxWords: 50 }, ai: { model: 'x' } },
    }));
    const s = loadSettings();
    expect(s.options.tokenize.maxWords).toBe(50);
    expect(s.options.tokenize.minLength).toBe(DEFAULT_SETTINGS.options.tokenize.minLength);
    expect(s.options.tokenize.mergeEnglishForms).toBe(DEFAULT_SETTINGS.options.tokenize.mergeEnglishForms);
    expect(s.options.ai.model).toBe('x');
    expect(s.options.ai.chunkChars).toBe(DEFAULT_SETTINGS.options.ai.chunkChars);
    expect(s.options.ai.enabled).toBe(false);
    expect(s.options.clean.stripCustomTags).toBe(true);
  });

  it('corrupt saves fall back to defaults', () => {
    localStorage.setItem('tw-settings', '{not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('progress phase mapping', () => {
  /** The ring is one continuous scale, so a whole run must never walk backwards. */
  it('a whole run reports a non-decreasing fraction ending at 1', () => {
    const run: Array<[string, number, number]> = [
      ['unzip', 0, 1], ['unzip', 1, 1],
      ['scan', 0, 3], ['scan', 3, 3],
      ['read', 0, 5], ['read', 5, 5],
      ['parse', 0, 2], ['parse', 2, 2],
      ['tokenize', 0, 100], ['tokenize', 50, 100], ['tokenize', 100, 100],
      ['ai', 0, 8], ['ai', 8, 8],
      ['curate', 0, 0], ['curate', 1, 1],
    ];
    let prev = -1;
    for (const [phase, done, total] of run) {
      const f = phaseFraction(phase, done, total);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
    expect(prev).toBeCloseTo(1, 6);
  });

  it('the cached-LLM path lands in the same band as a real run', () => {
    expect(phaseFraction('aicache', 1, 1)).toBeCloseTo(phaseFraction('ai', 1, 1), 6);
  });

  it('an unrecognized phase still uses done/total', () => {
    expect(phaseFraction('nope', 1, 2)).toBeCloseTo(0.5, 6);
    expect(phaseFraction(undefined, 0, 0)).toBe(0);
  });
});

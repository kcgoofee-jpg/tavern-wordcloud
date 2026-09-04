// @vitest-environment happy-dom
/** Landing's narrow-viewport hint: shown under 768px, dismissible, sticky via localStorage. */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Landing from '../../src/ui/Landing';

afterEach(() => { cleanup(); });

const landingProps = () => ({
  hasServer: false,
  keywordMode: false,
  aiReady: false,
  onCloudMode: vi.fn(),
  communityActive: false,
  onToggleCommunity: vi.fn(),
  dark: true,
  onToggleScheme: vi.fn(),
  lang: 'zh' as const,
  onToggleLang: vi.fn(),
  onPickFile: vi.fn(),
  onShowSample: vi.fn(),
});

/** Stubs matchMedia for a given viewport width against a `(max-width: Npx)` query. */
function stubMatchMedia(width: number) {
  window.matchMedia = ((query: string) => {
    const m = /max-width:\s*(\d+)px/.exec(query);
    const matches = m ? width <= Number(m[1]) : false;
    return {
      matches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

beforeEach(() => {
  localStorage.clear();
});

const HINT = '手机上能用，但电脑浏览器体验更好：面板更宽、导出更清晰';

describe('MobileHint', () => {
  it('shows on a narrow viewport', () => {
    stubMatchMedia(400);
    render(<Landing {...landingProps()} />);
    expect(screen.getByText(HINT)).toBeTruthy();
  });

  it('does not show on a wide viewport', () => {
    stubMatchMedia(1200);
    render(<Landing {...landingProps()} />);
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it('dismissing hides it and the choice sticks across remounts', async () => {
    stubMatchMedia(400);
    const user = userEvent.setup();
    const { unmount } = render(<Landing {...landingProps()} />);
    expect(screen.getByText(HINT)).toBeTruthy();
    await user.click(screen.getByTitle('关闭提示'));
    expect(screen.queryByText(HINT)).toBeNull();
    unmount();

    render(<Landing {...landingProps()} />);
    expect(screen.queryByText(HINT)).toBeNull();
  });
});

// @vitest-environment happy-dom
/** Palette panel: group folding and the colour-vision gate. */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemePanel } from '../../src/ui/panels';
import { DEFAULT_SETTINGS, type Settings } from '../../src/ui/settings';
import { THEMES } from '../../src/theme/themes';
import { setCurrentLang } from '../../src/ui/i18n';

// Palette and group names are dynamic values (tx), which reads the module-level language;
// happy-dom has no browser language, so pin it to match the t() context default.
setCurrentLang('zh');

afterEach(cleanup);

/** Apply patches to a local copy so assertions read the latest settings. */
function harness(init: Partial<Settings> = {}) {
  let current: Settings = { ...DEFAULT_SETTINGS, ...init };
  const patch = vi.fn((p: Partial<Settings>) => { current = { ...current, ...p }; });
  return { patch, get: () => current };
}

const groupHead = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });
const expanded = (name: string) => groupHead(name).getAttribute('aria-expanded');

describe('ThemePanel groups', () => {
  it('only 推荐 is expanded on first render', () => {
    const h = harness();
    render(<ThemePanel settings={h.get()} patch={h.patch} />);
    expect(expanded('推荐')).toBe('true');
    for (const g of ['科研', '自然', '现代', '复古', '写实', '无障碍']) {
      expect(expanded(g), g).toBe('false');
    }
    // Only the three recommended palettes are rendered as cards
    expect(screen.getByRole('button', { name: /^Claude/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Okabe-Ito/ })).toBeNull();
  });

  it('clicking a group name expands it, clicking again collapses it', async () => {
    const user = userEvent.setup();
    const h = harness();
    render(<ThemePanel settings={h.get()} patch={h.patch} />);
    await user.click(groupHead('无障碍'));
    expect(expanded('无障碍')).toBe('true');
    expect(screen.getByRole('button', { name: /^Okabe-Ito/ })).toBeTruthy();
    await user.click(groupHead('无障碍'));
    expect(expanded('无障碍')).toBe('false');
    expect(screen.queryByRole('button', { name: /^Okabe-Ito/ })).toBeNull();
  });

  it('picking a palette patches themeId only', async () => {
    const user = userEvent.setup();
    const h = harness();
    render(<ThemePanel settings={h.get()} patch={h.patch} />);
    await user.click(screen.getByRole('button', { name: /^极简/ }));
    expect(h.get().themeId).toBe('minimal');
    expect(h.get().colorVision).toBe('normal');
  });
});

describe('ThemePanel colour vision', () => {
  it('the three-way tab sets colorVision', async () => {
    const user = userEvent.setup();
    const h = harness();
    render(<ThemePanel settings={h.get()} patch={h.patch} />);
    expect(screen.getByRole('button', { name: '正常' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(screen.getByRole('button', { name: '红绿色弱' }));
    expect(h.get().colorVision).toBe('rg');
  });

  it('under a colour-vision setting only cvd-safe palettes stay clickable', () => {
    // 彩色 is a hue-shifting ramp: it collapses under simulation, so it must be disabled.
    // 高对比 is in the accessible group and must stay available.
    const h = harness({ colorVision: 'rg' });
    render(<ThemePanel settings={h.get()} patch={h.patch} />);
    const colorful = screen.getByRole('button', { name: /^彩色/ }) as HTMLButtonElement;
    expect(THEMES.find((t) => t.id === 'colorful')!.cvd).not.toBe('safe');
    expect(colorful.disabled).toBe(true);
    // The reason is spelled out, since the card carries no visible label for it
    expect(colorful.title).toMatch(/分不开相邻词频/);
  });

  it('cvd-safe palettes stay enabled under a colour-vision setting', async () => {
    const user = userEvent.setup();
    const h = harness({ colorVision: 'by' });
    render(<ThemePanel settings={h.get()} patch={h.patch} />);
    await user.click(groupHead('无障碍'));
    const hc = screen.getByRole('button', { name: /^高对比/ }) as HTMLButtonElement;
    expect(hc.disabled).toBe(false);
    await user.click(hc);
    expect(h.get().themeId).toBe('high-contrast');
  });

  it('every palette is selectable again once colour vision is 正常', () => {
    const h = harness({ colorVision: 'normal' });
    render(<ThemePanel settings={h.get()} patch={h.patch} />);
    for (const id of ['Claude', '彩色', '极简']) {
      expect((screen.getByRole('button', { name: new RegExp(`^${id}`) }) as HTMLButtonElement).disabled).toBe(false);
    }
  });
});

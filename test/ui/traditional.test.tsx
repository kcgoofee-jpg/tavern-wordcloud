// @vitest-environment happy-dom
/** Traditional-display toggle: settings write, word-table render, CSV stays Simplified. */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FontPanel, WordsPanel } from '../../src/ui/panels';
import { DEFAULT_SETTINGS } from '../../src/ui/settings';
import { DEFAULT_ANALYZE_OPTIONS } from '../../src/core/analyze';
import { setCurrentLang } from '../../src/ui/i18n';
import { toTraditional } from '../../src/theme/s2t';
import { wordsToCsv } from '../../src/ui/export';

setCurrentLang('zh');

afterEach(cleanup);

describe('FontPanel traditional toggle', () => {
  it('clicking 繁 patches settings.traditional to true, 简 back to false', async () => {
    const user = userEvent.setup();
    const setFont = vi.fn();
    const setTraditional = vi.fn();
    render(
      <FontPanel
        font={DEFAULT_SETTINGS.font}
        setFont={setFont}
        traditional={false}
        setTraditional={setTraditional}
      />,
    );
    await user.click(screen.getByRole('button', { name: '繁' }));
    expect(setTraditional).toHaveBeenCalledWith(true);

    cleanup();
    render(
      <FontPanel
        font={DEFAULT_SETTINGS.font}
        setFont={setFont}
        traditional={true}
        setTraditional={setTraditional}
      />,
    );
    await user.click(screen.getByRole('button', { name: '简' }));
    expect(setTraditional).toHaveBeenCalledWith(false);
  });
});

describe('word table shows the converted display', () => {
  it('renders w.display (set by the App-level toTraditional pass) instead of w.text', () => {
    const words = [
      { text: '学习', count: 10, display: toTraditional('学习') },
      { text: '国家', count: 5, display: toTraditional('国家') },
    ];
    render(
      <WordsPanel
        words={words}
        options={DEFAULT_ANALYZE_OPTIONS}
        setOptions={vi.fn()}
        onHover={vi.fn()}
        hovered={null}
        overrides={{}}
        setOverrides={vi.fn()}
      />,
    );
    expect(screen.getByText('學習')).toBeTruthy();
    expect(screen.getByText('國家')).toBeTruthy();
    expect(screen.queryByText('学习')).toBeNull();
  });

  it('an explicit user override display still wins over the traditional conversion', () => {
    const words = [{ text: '学习', count: 10, display: toTraditional('学习') }];
    render(
      <WordsPanel
        words={words}
        options={DEFAULT_ANALYZE_OPTIONS}
        setOptions={vi.fn()}
        onHover={vi.fn()}
        hovered={null}
        overrides={{ '学习': { display: '努力' } }}
        setOverrides={vi.fn()}
      />,
    );
    expect(screen.getByText('努力')).toBeTruthy();
    expect(screen.queryByText('學習')).toBeNull();
  });
});

describe('CSV export stays Simplified', () => {
  it('wordsToCsv writes w.text, ignoring w.display', () => {
    const words = [{ text: '学习', count: 3, display: toTraditional('学习'), kind: 'plain' as const }];
    const blob = wordsToCsv(words);
    return blob.text().then((csv: string) => {
      expect(csv).toContain('学习');
      expect(csv).not.toContain('學習');
    });
  });
});

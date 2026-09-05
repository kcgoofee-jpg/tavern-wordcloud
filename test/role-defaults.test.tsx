// @vitest-environment happy-dom
/**
 * «统计谁的话» defaults (user decision 2026-09-05): a fresh profile counts BOTH speakers,
 * `system` stays off, and a saved selection is never overwritten by the new default.
 *
 * Before this change the default was `['user']` — a fresh import silently dropped the
 * character's half of the chat. The reversal is recorded in notes/docs/13.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyze, DEFAULT_ANALYZE_OPTIONS } from '../src/core/analyze';
import type { Role } from '../src/core/types';
import { DEFAULT_SETTINGS, resetSlice } from '../src/ui/settings';
import { loadSettings } from '../src/ui/hooks/useSettings';
import { FilterPanel } from '../src/ui/panels';
import ImportPanel, { type ImportSummary } from '../src/ui/ImportPanel';

afterEach(() => { cleanup(); localStorage.clear(); });

const KEY = 'tw-settings';
/** Write a save exactly as `useSettings` persists it, then read it back through the real loader. */
const savedRoles = (roles: Role[] | undefined): Role[] => {
  localStorage.setItem(KEY, JSON.stringify({ options: roles === undefined ? {} : { roles } }));
  return loadSettings().options.roles;
};

describe('a fresh profile counts both speakers', () => {
  it('the analyze default is user + char, and not system', () => {
    expect(DEFAULT_ANALYZE_OPTIONS.roles).toEqual(['user', 'char']);
    expect(DEFAULT_ANALYZE_OPTIONS.roles).not.toContain('system');
  });

  it('settings inherit it, so an import with nothing stored starts with both', () => {
    expect(DEFAULT_SETTINGS.options.roles).toEqual(['user', 'char']);
    expect(loadSettings().options.roles).toEqual(['user', 'char']);   // empty localStorage
  });

  it('a save that predates the field at all takes the new default', () => {
    expect(savedRoles(undefined)).toEqual(['user', 'char']);
  });

  it('resetting the filter panel returns to both speakers', () => {
    const narrowed = { ...DEFAULT_SETTINGS, options: { ...DEFAULT_SETTINGS.options, roles: ['char'] as Role[] } };
    expect(resetSlice(narrowed, 'filter').options.roles).toEqual(['user', 'char']);
  });
});

describe('a stored selection survives the new default', () => {
  /** The whole point: someone who narrowed it to their own lines must not be silently widened. */
  it('keeps a legacy user-only save instead of overwriting it', () => {
    expect(savedRoles(['user'])).toEqual(['user']);
  });

  it('keeps a character-only save', () => {
    expect(savedRoles(['char'])).toEqual(['char']);
  });

  it('keeps an empty selection — both toggles off is a choice, not a missing field', () => {
    expect(savedRoles([])).toEqual([]);
  });

  it('drops a stale system pick without re-defaulting the rest', () => {
    expect(savedRoles(['user', 'system'])).toEqual(['user']);
  });
});

/**
 * The defaults above are only worth anything if the pipeline actually reads both sides.
 * `analyze` is pure, so this runs the shipped path with the shipped defaults.
 */
describe('a default run counts both sides of the chat', () => {
  /**
   * 8 alternating messages; the user only ever says 排练厅, the character only 录音棚.
   * The surrounding wording differs every time on purpose — repeating one sentence makes
   * phrase discovery glue the whole thing into 「我又去了排练」 and the check measures nothing.
   */
  const mine = ['我又去了排练厅，灯还亮着。', '排练厅的地板很凉。', '下午在排练厅等了很久。', '她说排练厅七点关门。'];
  const theirs = ['他把带子留在录音棚。', '录音棚的门锁上了。', '昨天夜里录音棚很吵。', '录音棚里一个人也没有。'];
  const chat = [
    JSON.stringify({ user_name: 'u', character_name: 'c' }),
    ...Array.from({ length: 8 }, (_, i) => JSON.stringify({
      name: i % 2 === 0 ? 'u' : 'c',
      is_user: i % 2 === 0,
      mes: i % 2 === 0 ? mine[i / 2] : theirs[(i - 1) / 2],
    })),
  ].join('\n');
  const run = (roles?: Role[]) => analyze(
    [{ name: 'a.jsonl', content: chat }],
    {
      ...DEFAULT_ANALYZE_OPTIONS,
      ...(roles ? { roles } : {}),
      tokenize: { ...DEFAULT_ANALYZE_OPTIONS.tokenize, minCount: 1 },
    },
  );

  it('with the defaults, both speakers reach the cloud and no message is dropped', () => {
    const r = run();
    const words = r.words.map((w) => w.text);
    expect(words).toContain('排练厅');
    expect(words).toContain('录音棚');
    expect(r.messageCount).toBe(r.totalMessages);
  });

  /** The control: the character's word is absent only because of `roles`, not because it never tokenized. */
  it('narrowing to the user alone drops the character’s word again', () => {
    const words = run(['user']).words.map((w) => w.text);
    expect(words).toContain('排练厅');
    expect(words).not.toContain('录音棚');
  });
});

describe('the toggles show it on a fresh profile', () => {
  const fresh = () => loadSettings().options;   // empty localStorage = fresh profile

  it('the filter panel lights both role buttons', () => {
    render(
      <FilterPanel options={fresh()} setOptions={vi.fn()} kindOverrides={{}} setKindOverrides={() => {}}
        rotateRatio={0} setRotateRatio={() => {}} result={null} />,
    );
    for (const name of ['我说的', '角色说的']) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-pressed')).toBe('true');
    }
  });

  it('the import confirmation lights both role buttons', () => {
    const summary: ImportSummary = {
      fileCount: 1, chars: 1000, uploadBytes: 3000, characters: ['排练厅的下午'], bundle: null, fromZip: false,
    };
    render(
      <ImportPanel summary={summary} options={fresh()} setOptions={vi.fn()}
        busy={false} progress={null} onStart={vi.fn()} onCancel={vi.fn()} onConfigureAi={vi.fn()}
        contribute={false} hasServer={false} />,
    );
    // The import panel marks a selected segment with `on`; it has no aria-pressed (see ImportPanel.tsx).
    for (const name of ['我说的', '角色说的']) {
      expect(screen.getByRole('button', { name }).className).toContain('on');
    }
  });
});

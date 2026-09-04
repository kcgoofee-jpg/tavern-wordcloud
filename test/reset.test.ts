/** Per-panel reset: the word table resets only its manual edits, not the other options. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, RESET_SCOPE, isDirty, resetSlice, type ResetScope } from '../src/ui/settings';

const dirty = () => ({
  ...structuredClone(DEFAULT_SETTINGS),
  themeId: 'neon',
  options: {
    ...structuredClone(DEFAULT_SETTINGS.options),
    roles: ['user', 'char'] as never,
    ai: { ...DEFAULT_SETTINGS.options.ai, endpoint: 'https://x/v1', apiKey: 'sk-keep-me', model: 'm' },
    tokenize: {
      ...structuredClone(DEFAULT_SETTINGS.options.tokenize),
      extraStopwords: ['许婉如', '本轮用户'],
      forceWords: ['东阳砚山'],
      splitWords: ['盛集团'],
      maxWords: 200,
    },
  },
});

describe('per-panel reset', () => {
  it.each(Object.keys(RESET_SCOPE) as ResetScope[])('%s 有重置作用域', (k) => {
    expect(RESET_SCOPE[k].length).toBeGreaterThan(0);
  });

  it('word-table reset clears forced splits only', () => {
    const before = dirty();
    expect(isDirty(before, 'words')).toBe(true);
    const after = resetSlice(before, 'words');

    // Cleared
    expect(after.options.tokenize.splitWords).toEqual([]);
    expect(isDirty(after, 'words')).toBe(false);

    // Untouched: merges and hides belong to the advanced panel's scope
    expect(after.options.tokenize.extraStopwords).toEqual(['许婉如', '本轮用户']);
    expect(after.options.tokenize.forceWords).toEqual(['东阳砚山']);
    expect(after.options.ai.apiKey).toBe('sk-keep-me');
    expect(after.options.roles).toEqual(['user', 'char']);
    expect(after.options.tokenize.maxWords).toBe(200);
    expect(after.themeId).toBe('neon');
  });

  it('filter reset leaves the API key alone', () => {
    const before = dirty();
    expect(isDirty(before, 'filter')).toBe(true);
    const after = resetSlice(before, 'filter');

    // Cleared: the filter panel's own controls
    expect(after.options.roles).toEqual(DEFAULT_SETTINGS.options.roles);
    expect(after.rotateRatio).toBe(DEFAULT_SETTINGS.rotateRatio);
    expect(isDirty(after, 'filter')).toBe(false);

    // Untouched: endpoint settings and word-table edits
    expect(after.options.ai.apiKey).toBe('sk-keep-me');
    expect(after.options.ai.endpoint).toBe('https://x/v1');
    expect(after.options.tokenize.splitWords).toEqual(['盛集团']);
    expect(after.options.tokenize.maxWords).toBe(200);
  });

  it('advanced reset clears custom word lists', () => {
    const after = resetSlice(dirty(), 'advanced');
    expect(after.options.tokenize.extraStopwords).toEqual([]);
    expect(after.options.tokenize.forceWords).toEqual([]);
    expect(after.options.ai.apiKey).toBe('sk-keep-me');
  });

  it('the button is disabled when unchanged', () => {
    expect(isDirty(structuredClone(DEFAULT_SETTINGS), 'words')).toBe(false);
  });

  it('reset does not mutate the original object', () => {
    const before = dirty();
    const snapshot = JSON.stringify(before);
    resetSlice(before, 'words');
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('other panels reset only their own scope', () => {
    const after = resetSlice(dirty(), 'theme');
    expect(after.themeId).toBe(DEFAULT_SETTINGS.themeId);
    // Theme reset does not touch word-table edits
    expect(after.options.tokenize.extraStopwords).toEqual(['许婉如', '本轮用户']);
  });
});

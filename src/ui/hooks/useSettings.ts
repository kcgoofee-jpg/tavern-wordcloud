/** Settings: load, deep-merge, persist, translation function, theme resolution and CSS variables. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AnalyzeOptions } from '../../core/analyze';
import { setCurrentLang, translate } from '../i18n';
import { themeById } from '../../theme/themes';
import { DEFAULT_SETTINGS, type ExportOpts, type Settings } from '../settings';

const KEY = 'tw-settings';

const load = <T,>(key: string, fallback: T): T => {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
};

/** Saved settings are merged level by level so fields added later keep their defaults. */
function migrateNsfw(o: (Partial<AnalyzeOptions> & { hideSensitive?: boolean; nsfwOnly?: boolean }) | undefined): Partial<AnalyzeOptions> {
  if (!o || o.nsfwMode) return {};
  if (o.nsfwOnly) return { nsfwMode: 'only' };
  if (o.hideSensitive) return { nsfwMode: 'hide' };
  return {};
}

/**
 * Export options grew from four fields to a dozen. Missing fields take their
 * default; the old `transparent: true` boolean becomes `bg: 'transparent'`.
 */
export function migrateExportOpts(saved: (Partial<ExportOpts> & { transparent?: boolean }) | undefined): ExportOpts {
  const next: ExportOpts = { ...DEFAULT_SETTINGS.exportOpts, ...saved };
  if (saved && saved.bg === undefined) next.bg = saved.transparent ? 'transparent' : 'theme';
  // `transparent` is no longer part of the type; drop it so it stops being persisted
  delete (next as Partial<ExportOpts> & { transparent?: boolean }).transparent;
  return next;
}

/**
 * `kindOverrides` (text -> kind) was the old «move a word out of its class» store.
 * The review panel writes `overrides[word].kind` instead, so a saved map is folded in
 * once and the old field is emptied. An existing `overrides[…].kind` wins: it is newer.
 */
export function migrateKindOverrides(
  kindOverrides: Settings['kindOverrides'] | undefined,
  overrides: Settings['overrides'] | undefined,
): Pick<Settings, 'kindOverrides' | 'overrides'> {
  const next = { ...(overrides ?? {}) };
  for (const [word, kind] of Object.entries(kindOverrides ?? {})) {
    const k = word.toLowerCase();
    if (next[k]?.kind) continue;
    next[k] = { ...next[k], kind };
  }
  return { kindOverrides: {}, overrides: next };
}

export function loadSettings(): Settings {
  const saved = load(KEY, {} as Partial<Settings>);
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    options: {
      ...DEFAULT_SETTINGS.options,
      ...saved.options,
      // Nested objects used to replace the default wholesale, so a save from
      // before `mergeEnglishForms` / `chunkChars` landed dropped those fields.
      clean: { ...DEFAULT_SETTINGS.options.clean, ...saved.options?.clean },
      tokenize: { ...DEFAULT_SETTINGS.options.tokenize, ...saved.options?.tokenize },
      ai: { ...DEFAULT_SETTINGS.options.ai, ...saved.options?.ai },
      // System messages are UI notices, not chat content; drop a stale selection from old saves
      roles: (saved.options?.roles ?? DEFAULT_SETTINGS.options.roles).filter((r) => r !== 'system'),
      // Old saves used two booleans (hide / only); migrate to the three-state mode
      ...migrateNsfw(saved.options as Partial<AnalyzeOptions> & { hideSensitive?: boolean; nsfwOnly?: boolean } | undefined),
    },
    custom: { ...DEFAULT_SETTINGS.custom, ...saved.custom },
    exportOpts: migrateExportOpts(saved.exportOpts),
    font: { ...DEFAULT_SETTINGS.font, ...saved.font },
    ...migrateKindOverrides(saved.kindOverrides, saved.overrides),
  };
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const patch = useCallback((p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p })), []);
  const setOptions = useCallback(
    (fn: (o: AnalyzeOptions) => AnalyzeOptions) => setSettings((s) => ({ ...s, options: fn(s.options) })),
    [],
  );

  /** Not `useT()`: this hook renders the provider itself. Translate from settings.lang directly. */
  const t = useCallback(
    (zh: string, vars?: Record<string, string | number>) => translate(settings.lang, zh, vars),
    [settings.lang],
  );

  // tx()/txv() translate dynamic values (worker progress, warnings) outside hooks
  useEffect(() => { setCurrentLang(settings.lang); }, [settings.lang]);

  const theme = useMemo(
    () => themeById(settings.themeId, { custom: settings.custom, mode: settings.mode, font: settings.font }),
    [settings.themeId, settings.custom, settings.mode, settings.font],
  );

  useEffect(() => { localStorage.setItem(KEY, JSON.stringify(settings)); }, [settings]);

  // "Follow system" must track changes, not just the initial value
  useEffect(() => {
    if (settings.mode !== 'auto' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSettings((s) => ({ ...s }));
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [settings.mode]);

  // The theme reaches the UI and the canvas only through CSS variables
  useEffect(() => {
    const r = document.documentElement;
    const v: Record<string, string> = {
      '--surface': theme.surface, '--surface2': theme.surface2, '--line': theme.line,
      '--fg': theme.fg, '--fg-dim': theme.fgDim, '--accent': theme.accent,
      '--font-ui': theme.uiFont,
    };
    for (const [k, val] of Object.entries(v)) r.style.setProperty(k, val);
    r.style.colorScheme = theme.mode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.surface);
  }, [theme]);

  return { settings, setSettings, patch, setOptions, t, theme };
}

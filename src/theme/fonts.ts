/**
 * Font stacks. System fonts only; no web fonts are loaded (offline use, no external requests).
 * Each stack is ordered macOS -> Windows -> Linux -> generic.
 */
export const FONT_STACKS = {
  /** Sans. Default for the UI and most themes */
  sans:
    '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", ' +
    '"Source Han Sans SC", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',

  /** Serif. Used by the Claude and scientific styles */
  serif:
    'Georgia, "Songti SC", "SimSun", "Noto Serif CJK SC", "Source Han Serif SC", ' +
    '"Times New Roman", serif',

  /** Kai / rounded. Literary styles */
  rounded:
    '"Kaiti SC", "STKaiti", "KaiTi", "Noto Serif CJK SC", Georgia, serif',

  /** Palatino family: the documented fallback stack for Nature's Harding typeface. */
  palatino:
    'Palatino, "Palatino Linotype", "Book Antiqua", "Songti SC", ' +
    '"Noto Serif CJK SC", "Source Han Serif SC", Georgia, serif',

  /** Monospace. Scientific numerals and minimal style */
  mono:
    '"SF Mono", "SFMono-Regular", ui-monospace, Menlo, Consolas, ' +
    '"Noto Sans Mono CJK SC", "Courier New", monospace',

  /**
   * Traditional-Chinese-friendly sans. Loaded from Google Fonts when online;
   * the single-file (offline) build never fetches it, so the system fallback
   * carries the weight there.
   */
  'tc-sans':
    '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif',

  /** Traditional-Chinese-friendly serif, same fallback story as tc-sans. */
  'tc-serif':
    '"Noto Serif TC", "PingFang TC", "Microsoft JhengHei", Georgia, serif',
} as const;

export type FontKey = keyof typeof FONT_STACKS;

/** Google Fonts family names for the web-loaded entries in FONT_STACKS. */
export const GOOGLE_FONT_FAMILIES: Partial<Record<FontKey, string>> = {
  'tc-sans': 'Noto+Sans+TC:wght@400;600;700',
  'tc-serif': 'Noto+Serif+TC:wght@400;600;700',
};

const loadedGoogleFonts = new Set<FontKey>();

/**
 * Lazily injects a Google Fonts stylesheet for a web font key. No-op if
 * already injected, if the key isn't a web font, or if `document` is
 * unavailable (worker/server/tests). A network failure here just leaves the
 * fallback stack in FONT_STACKS doing the work — never throws.
 */
/**
 * Resolves a cloud-font key to a CSS font-family string. Built-in keys look up
 * FONT_STACKS; anything else is treated as a custom-imported font family name
 * (registered as a FontFace elsewhere) with the traditional-Chinese-friendly
 * system fallback chain appended.
 */
export function resolveFontStack(key: string): string {
  const builtin = (FONT_STACKS as Record<string, string>)[key];
  if (builtin) return builtin;
  return `"${key}", "PingFang TC", "Microsoft JhengHei", sans-serif`;
}

export function ensureGoogleFont(key: FontKey): void {
  const family = GOOGLE_FONT_FAMILIES[key];
  if (!family || loadedGoogleFonts.has(key) || typeof document === 'undefined') return;
  loadedGoogleFonts.add(key);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${family}&display=swap`;
  document.head.appendChild(link);
}

export interface ThemeFonts {
  /** UI text */
  ui: FontKey;
  /** Cloud text, set separately. A built-in FontKey, or a custom-imported font family name. */
  cloud: FontKey | (string & {});
  /** Cloud weight */
  cloudWeight: string;
  /** Cloud letter spacing in em. Negative values follow Nature's heading style. */
  cloudTracking: number;
}

export const DEFAULT_FONTS: ThemeFonts = {
  ui: 'sans', cloud: 'sans', cloudWeight: '600', cloudTracking: 0,
};

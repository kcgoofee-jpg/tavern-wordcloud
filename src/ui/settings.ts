import type { AnalyzeOptions } from '../core/analyze';
// From the split-out module, not `core/analyze`: the pipeline itself belongs to the worker.
import { DEFAULT_ANALYZE_OPTIONS } from '../core/analyzeOptions';
import type { CardRules } from '../core/cardRules';
import type { EntityKind } from '../core/entities';
import { detectLang, type Lang } from './i18n';
import { DEFAULT_WATERMARK_TEXT, type WatermarkPos } from './watermark';
import {
  DEFAULT_CUSTOM, DEFAULT_FONT_CHOICE, DEFAULT_MODE, DEFAULT_THEME_ID,
  type ColorVision, type CustomThemeSetting, type FontChoice, type ModePref,
} from '../theme/themes';

/** All adjustable state, with per-panel reset scopes. */
/**
 * Two cloud modes:
 *   freq     local word counts; no network
 *   keyword  the model reads the whole chat and picks words; text is sent to the configured endpoint
 */
export type CloudMode = 'freq' | 'keyword';


/**
 * Raster formats the canvas can write directly. `svg` is listed so the UI can show
 * it greyed out: a vector export needs a second rendering path (see notes/docs/28).
 */
export type ExportFormat = 'png' | 'jpg' | 'webp' | 'svg';

/** What goes underneath the words. */
export type ExportBg = 'transparent' | 'theme' | 'custom';

/** Export panel options. Every control in the panel writes into exactly one field here. */
export interface ExportOpts {
  format: ExportFormat;
  /** Multiple of the on-screen canvas, used when `sizeMode` is `preset`. */
  scale: 1 | 2 | 3;
  sizeMode: 'preset' | 'custom';
  /** Output pixels when `sizeMode` is `custom`; the cloud is contained, never stretched. */
  customW: number;
  customH: number;
  /** Keep the custom width/height at the canvas aspect ratio. */
  lockRatio: boolean;
  bg: ExportBg;
  /** Used when `bg` is `custom`. */
  bgColor: string;
  /** Corner radius in output pixels; 0 is square. */
  radius: number;
  /** Embed the word table and palette in the PNG so it can be dragged back in. PNG only. */
  embed: boolean;
  /** Stamp a QR code of the share link in the corner. */
  qr: boolean;
  /** Stamp «card · date» (plus `watermarkText`) in the corner. */
  watermark: boolean;
  /** Extra line appended to the visible stamp; empty means card and date only. */
  watermarkText: string;
  /** Which corner the visible stamp sits in. */
  watermarkPos: WatermarkPos;
  /** Visible stamp opacity, 0.05–1. */
  watermarkOpacity: number;
  /** Invisible watermark in a PNG tEXt chunk. PNG only; survives a lossless re-save. */
  hiddenMeta: boolean;
  /** Invisible watermark in the RGB low bits. PNG only; a JPG/WebP re-encode destroys it. */
  hiddenLsb: boolean;
  /** CSV: how many words to write, by count, top down. */
  csvN: number;
  /** File-name template; empty means the built-in rule (see ui/export.ts `exportName`). */
  nameTpl: string;
}

export interface Settings {
  /** UI language. Follows the browser until the user switches. */
  lang: Lang;
  exportOpts: ExportOpts;
  cloudMode: CloudMode;
  /** Number of words requested in keyword mode. */
  keywordN: number;
  /** Contribute anonymous statistics (card names, top words, counts) to the community board. */
  contribute: boolean;
  /**
   * Words the user re-filed by hand: text -> kind. Applied in the UI before the
   * kind buttons decide what is shown, so `src/core` keeps its own classification.
   */
  kindOverrides: Record<string, EntityKind>;
  themeId: string;
  custom: CustomThemeSetting;
  /** Colour vision. Anything but `normal` restricts the palette list to cvd-safe themes. */
  colorVision: ColorVision;
  mode: ModePref;
  font: FontChoice;
  /** Display-only: show words in Traditional characters. Original (Simplified) text is unchanged for CSV/JSON/search. */
  traditional: boolean;
  rotateRatio: number;
  options: AnalyzeOptions;
  /** Priority words, raw user input (semicolon-separated), see core/overrides.ts. */
  priority: string;
  /** Per-word display/alias/rotate/kind overrides, keyed by lowercased word. */
  overrides: Record<string, import('../core/types').WordOverride>;
  /**
   * Per-card saved fixes (notes/docs/23), keyed by the card's fingerprint (`core/cardRules.ts`).
   * Local only — never uploaded. Auto-applied on top of `overrides`/`options.tokenize.extraStopwords`
   * when the same card is imported again; the current session's own edits always win.
   */
  cardRules: CardRules;
  /**
   * Full names whose coreference group the user pulled apart again. Since C6 the
   * proposals from `core/entities.ts detectCoref` are applied by default (recall
   * 97.5%, mis-merge 0% on `npm run eval:coref`); this is the opt-out, one entry
   * per full name, and it is what the word table's 「拆开」 chip writes.
   */
  corefSplit: string[];
}

/**
 * Development-only endpoint prefill from .env.local. Read only under
 * `import.meta.env.DEV`, so it is tree-shaken out of production builds;
 * `enabled` stays false.
 */
const devAi = import.meta.env.DEV
  ? {
      endpoint: (import.meta.env.VITE_DEV_AI_ENDPOINT as string) || '',
      model: (import.meta.env.VITE_DEV_AI_MODEL as string) || '',
      apiKey: (import.meta.env.VITE_DEV_AI_KEY as string) || '',
    }
  : { endpoint: '', model: '', apiKey: '' };

export const DEFAULT_SETTINGS: Settings = {
  lang: detectLang(),
  exportOpts: {
    format: 'png', scale: 2, sizeMode: 'preset', customW: 1920, customH: 1080, lockRatio: true,
    bg: 'theme', bgColor: '#ffffff', radius: 0,
    embed: true, qr: false, watermark: false,
    watermarkText: DEFAULT_WATERMARK_TEXT, watermarkPos: 'bl', watermarkOpacity: 0.55,
    hiddenMeta: false, hiddenLsb: false,
    csvN: 200, nameTpl: '',
  },
  cloudMode: 'freq',
  keywordN: 100,
  contribute: true,
  kindOverrides: {},
  themeId: DEFAULT_THEME_ID,
  custom: { ...DEFAULT_CUSTOM },
  colorVision: 'normal',
  mode: DEFAULT_MODE,
  font: { ...DEFAULT_FONT_CHOICE },
  traditional: false,
  rotateRatio: 0.18,
  options: { ...DEFAULT_ANALYZE_OPTIONS, ai: { ...DEFAULT_ANALYZE_OPTIONS.ai, ...devAi } },
  priority: '',
  overrides: {},
  cardRules: {},
  corefSplit: [],
};

/** Panel -> settings paths it owns. Reset touches only those. */
export const RESET_SCOPE = {
  theme: ['themeId', 'custom', 'mode', 'colorVision'],
  font: ['font', 'traditional'],
  /** Only what the filter panel manages; the endpoint and key (options.ai) are NOT part of it. */
  filter: [
    'kindOverrides',
    'options.roles', 'options.kinds', 'options.nsfwMode', 'options.nsfwKinds',
    'options.clean.stripCustomTags', 'options.clean.stripStructuredLines',
    'options.includeAllSwipes', 'options.onlyCharacter', 'options.source',
    'rotateRatio',
  ],
  // The endpoint and key live in options.ai; resetting turns the network feature off, which is intended.
  ai: ['options.ai', 'keywordN'],
  /** The word table's own edits: words the user forced apart. */
  words: ['options.tokenize.splitWords', 'overrides'],
  /** Priority-words input. */
  /** The advanced panel resets only its own fields. */
  export: ['exportOpts'],
  advanced: [
    'priority',
    'options.tokenize.discoverMinCount', 'options.tokenize.extraStopwords', 'options.tokenize.forceWords',
    'options.ignoreOwnerBlocklist', 'options.clean.stripCodeBlocks', 'options.clean.stripOOC',
  ],
} as const;

export type ResetScope = keyof typeof RESET_SCOPE;

type Obj = Record<string, unknown>;

/** Read a dot path. */
function at(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Obj)?.[k], root);
}

/** Write a dot path, copying every level so React sees a new reference. */
function setAt(root: Obj, path: string, value: unknown): Obj {
  const [head, ...rest] = path.split('.');
  const copy: Obj = { ...root };
  copy[head] = rest.length ? setAt((copy[head] ?? {}) as Obj, rest.join('.'), value) : value;
  return copy;
}

export function resetSlice(s: Settings, scope: ResetScope): Settings {
  let next: Obj = { ...s };
  for (const path of RESET_SCOPE[scope]) {
    // Deep copy: default objects are shared
    next = setAt(next, path, structuredClone(at(DEFAULT_SETTINGS, path)));
  }
  return next as unknown as Settings;
}

/** Whether a scope differs from its defaults; drives the reset button state. */
export function isDirty(s: Settings, scope: ResetScope): boolean {
  return RESET_SCOPE[scope].some(
    (p) => JSON.stringify(at(s, p)) !== JSON.stringify(at(DEFAULT_SETTINGS, p)),
  );
}

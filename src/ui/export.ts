import type { WordCount } from '../core/types';
import type { ExportBg, ExportFormat, ExportOpts } from './settings';
import type { WatermarkPos } from './watermark';

/**
 * Widest canvas any of the three engines accepts. Chrome/Firefox allow 16384 or
 * more, iOS Safari caps a side at 8192 and silently returns a blank bitmap past
 * it, so the smallest limit is the one the panel enforces.
 */
export const MAX_EXPORT_PX = 8192;

/** Fixed output sizes offered in the dropdown; the cloud is contained inside them. */
export const SIZE_PRESETS = [
  { id: 'hd', w: 1920, h: 1080 },
  { id: 'classic', w: 1600, h: 1200 },
  { id: 'a4', w: 3508, h: 2480 },
  { id: 'phone', w: 1170, h: 2532 },
  { id: 'square', w: 1080, h: 1080 },
] as const;

/** Everything the canvas needs to paint one still, for both the preview and the file. */
export interface PaintOpts {
  width: number;
  height: number;
  bg: ExportBg;
  bgColor: string;
  /** Corner radius in output pixels. */
  radius: number;
  /** Already-composed watermark line, or null. */
  watermark: string | null;
  /** Corner for the watermark line. Defaults to bottom-left. */
  watermarkPos?: WatermarkPos;
  /** Watermark opacity. Defaults to 0.55. */
  watermarkOpacity?: number;
  /** Share URL to stamp as a QR code, or null. */
  qr: string | null;
  /**
   * Invisible watermark line. The canvas path carries it in PNG chunks / pixel low bits;
   * the SVG path can only put it in `<metadata>` and a comment.
   */
  hiddenText?: string | null;
}

const MIME: Record<ExportFormat, string> = {
  png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml',
};

/** MIME type for `canvas.toBlob`. */
export const mimeOf = (f: ExportFormat): string => MIME[f];

/** Output pixel size for the current options. `preset` multiplies the canvas, `custom` is literal. */
export function outputSize(base: { w: number; h: number }, o: ExportOpts): { w: number; h: number } {
  if (o.sizeMode === 'custom') {
    return { w: Math.max(1, Math.round(o.customW)), h: Math.max(1, Math.round(o.customH)) };
  }
  return { w: Math.round(base.w * o.scale), h: Math.round(base.h * o.scale) };
}

/** Past this the browser hands back a blank bitmap, so the export is refused instead. */
export const tooLarge = (s: { w: number; h: number }): boolean => s.w > MAX_EXPORT_PX || s.h > MAX_EXPORT_PX;

/** Object URL rather than data: URL; multi-MB data URLs fail silently in Safari. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.download = filename;
  a.href = url;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Vector export as a file. No canvas and no encoder: the markup is the file, so this
 * skips `toBlob` entirely while still going out through an object URL (hard rule 4).
 */
export function svgBlob(svg: string): Blob {
  return new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
}

/** Full word table as JSON, with the counts that produced it. */
export function wordsToJson(words: WordCount[], meta: { card?: string | null; mode: 'freq' | 'keyword'; total?: number }): Blob {
  const body = {
    card: meta.card ?? null,
    mode: meta.mode,
    counted: meta.total ?? words.length,
    exported: words.length,
    generated: new Date().toISOString(),
    words: words.map((w) => ({ text: w.text, count: w.count, kind: w.kind ?? null })),
  };
  return new Blob([JSON.stringify(body, null, 2)], { type: 'application/json;charset=utf-8' });
}

/** Tab-separated word table for pasting straight into a spreadsheet. */
export function wordsToTsv(words: WordCount[]): string {
  return words.map((w) => `${w.text}\t${w.count}\t${w.kind ?? ''}`).join('\n');
}

/** Full word table with a BOM so Excel opens CJK correctly. */
export function wordsToCsv(words: WordCount[]): Blob {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  // `source` says where the row came from: the user's priority list or the tokenizer.
  const rows = [
    ['word', 'count', 'kind', 'source'],
    ...words.map((w) => [w.text, String(w.count), w.kind ?? '', w.priority ? 'priority' : 'tokenizer']),
  ];
  return new Blob(['﻿' + rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
}

/** Template variables the file-name box understands. */
export const NAME_VARS = ['{card}', '{mode}', '{date}', '{n}'] as const;

/** Strip what no file system accepts and collapse whitespace. */
const sanitiseName = (v: string): string =>
  v.replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * File name for an export. One rule everywhere:
 *   酒馆词云_<角色卡>_<词频|关键词>_<YYYYMMDD-HHmm>_<N>词.png      (zh)
 *   wordcloud_<card>_<frequency|keywords>_<YYYYMMDD-HHmm>_<N>words.png (en)
 * The card name is sanitised for file systems and capped at 40 characters.
 *
 * A non-empty `tpl` replaces the whole stem: `{card} {mode} {date} {n}` expand,
 * anything else stays literal, and the result is sanitised the same way. A template
 * that sanitises down to nothing falls back to the built-in rule, so no export can
 * produce a nameless file.
 */
export function exportName(
  kind: 'png' | 'csv' | 'json',
  ctx: {
    card?: string | null; mode: 'freq' | 'keyword'; words: number; lang: 'zh' | 'en'; now?: Date;
    /** File-name template; empty or blank means the built-in rule. */
    tpl?: string;
    /** Image extension; only read for `png`. Defaults to `png`. */
    ext?: string;
  },
): string {
  const d = ctx.now ?? new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  // i18n-exempt: file-name pieces follow the UI language explicitly below
  const card = sanitiseName(ctx.card ?? '').slice(0, 40) || (ctx.lang === 'zh' ? '未命名' : 'untitled');
  const zh = ctx.lang === 'zh';
  // i18n-exempt
  const mode = zh ? (ctx.mode === 'keyword' ? '关键词' : '词频') : (ctx.mode === 'keyword' ? 'keywords' : 'frequency');
  // i18n-exempt
  const n = zh ? `${ctx.words}词` : `${ctx.words}words`;
  // i18n-exempt
  const builtin = `${zh ? '酒馆词云' : 'wordcloud'}_${card}_${mode}_${stamp}_${n}`;
  const vars: Record<string, string> = { card, mode, date: stamp, n: String(ctx.words) };
  const tpl = (ctx.tpl ?? '').trim();
  const templated = tpl
    ? sanitiseName(tpl.replace(/\{(card|mode|date|n)\}/g, (_m, k: string) => vars[k])).slice(0, 120)
    : '';
  const base = templated || builtin;
  // i18n-exempt
  if (kind === 'png') return `${base}.${ctx.ext ?? 'png'}`;
  // i18n-exempt
  return `${base}${zh ? '_词表' : '_table'}.${kind}`;
}

/** Export file names follow one rule; card names are sanitised for file systems. */
import { describe, expect, it } from 'vitest';
import { MAX_EXPORT_PX, exportName, outputSize, tooLarge, wordsToJson, wordsToTsv } from '../src/ui/export';
import { DEFAULT_SETTINGS, type ExportOpts } from '../src/ui/settings';
import { migrateExportOpts } from '../src/ui/hooks/useSettings';

const opts = (o: Partial<ExportOpts> = {}): ExportOpts => ({ ...DEFAULT_SETTINGS.exportOpts, ...o });

const now = new Date(2026, 8, 4, 9, 7);
describe('exportName', () => {
  it('zh: 酒馆词云_卡_模式_时间_N词', () => {
    expect(exportName('png', { card: '陆时衍', mode: 'freq', words: 120, lang: 'zh', now })).toBe('酒馆词云_陆时衍_词频_20260904-0907_120词.png');
    expect(exportName('csv', { card: '陆时衍', mode: 'keyword', words: 40, lang: 'zh', now })).toBe('酒馆词云_陆时衍_关键词_20260904-0907_40词_词表.csv');
  });
  it('en: wordcloud_card_mode_time_Nwords', () => {
    expect(exportName('png', { card: 'AMERICA v1.3.1', mode: 'keyword', words: 40, lang: 'en', now })).toBe('wordcloud_AMERICA v1.3.1_keywords_20260904-0907_40words.png');
  });
  it('strips characters file systems reject, caps length, falls back when there is no card', () => {
    expect(exportName('png', { card: 'a/b:c*d?e"f<g>h|i', mode: 'freq', words: 1, lang: 'en', now })).toBe('wordcloud_a b c d e f g h i_frequency_20260904-0907_1words.png');
    expect(exportName('png', { card: 'x'.repeat(60), mode: 'freq', words: 1, lang: 'zh', now })).toContain('x'.repeat(40) + '_');
    expect(exportName('png', { card: null, mode: 'freq', words: 1, lang: 'zh', now })).toContain('酒馆词云_未命名_');
  });

  it('the image extension follows the chosen format; JSON gets the table suffix', () => {
    expect(exportName('png', { card: 'A', mode: 'freq', words: 3, lang: 'en', now, ext: 'webp' }))
      .toBe('wordcloud_A_frequency_20260904-0907_3words.webp');
    expect(exportName('json', { card: 'A', mode: 'freq', words: 3, lang: 'en', now }))
      .toBe('wordcloud_A_frequency_20260904-0907_3words_table.json');
  });
});

describe('exportName templates', () => {
  const ctx = { card: '陆时衍', mode: 'freq' as const, words: 120, lang: 'zh' as const, now };

  it('expands every variable', () => {
    expect(exportName('png', { ...ctx, tpl: '{card}-{mode}-{date}-{n}' }))
      .toBe('陆时衍-词频-20260904-0907-120.png');
  });

  it('keeps literal text and unknown braces, and still appends the right extension', () => {
    expect(exportName('png', { ...ctx, tpl: 'cloud {who} {card}' })).toBe('cloud {who} 陆时衍.png');
    expect(exportName('csv', { ...ctx, tpl: '{card}' })).toBe('陆时衍_词表.csv');
  });

  it('sanitises the expanded result and caps it', () => {
    expect(exportName('png', { ...ctx, card: 'a/b', tpl: 'x:{card}?y' })).toBe('x a b y.png');
    expect(exportName('png', { ...ctx, tpl: 'y'.repeat(200) }).length).toBe(120 + '.png'.length);
  });

  it('falls back to the built-in rule for a blank template or one that sanitises away', () => {
    expect(exportName('png', { ...ctx, tpl: '   ' })).toBe('酒馆词云_陆时衍_词频_20260904-0907_120词.png');
    expect(exportName('png', { ...ctx, tpl: '///' })).toBe('酒馆词云_陆时衍_词频_20260904-0907_120词.png');
  });
});

describe('output size', () => {
  const base = { w: 1000, h: 500 };

  it('presets multiply the canvas, custom is literal', () => {
    expect(outputSize(base, opts({ sizeMode: 'preset', scale: 3 }))).toEqual({ w: 3000, h: 1500 });
    expect(outputSize(base, opts({ sizeMode: 'custom', customW: 1170, customH: 2532 }))).toEqual({ w: 1170, h: 2532 });
  });

  it('refuses anything past the smallest browser canvas limit', () => {
    expect(tooLarge({ w: MAX_EXPORT_PX, h: MAX_EXPORT_PX })).toBe(false);
    expect(tooLarge({ w: MAX_EXPORT_PX + 1, h: 100 })).toBe(true);
    expect(tooLarge(outputSize({ w: 4000, h: 3000 }, opts({ sizeMode: 'preset', scale: 3 })))).toBe(true);
  });
});

describe('data exports', () => {
  const words = [{ text: '灯', count: 9, kind: 'plain' as const }, { text: '雨', count: 4 }];

  it('TSV is three columns per line', () => {
    expect(wordsToTsv(words)).toBe('灯\t9\tplain\n雨\t4\t');
  });

  it('JSON carries the metadata the CSV cannot', async () => {
    const parsed = JSON.parse(await wordsToJson(words, { card: '陆时衍', mode: 'keyword', total: 900 }).text()) as
      { card: string; mode: string; counted: number; exported: number; words: { text: string; kind: string | null }[] };
    expect(parsed.card).toBe('陆时衍');
    expect(parsed.mode).toBe('keyword');
    expect(parsed.counted).toBe(900);
    expect(parsed.exported).toBe(2);
    expect(parsed.words[1].kind).toBe(null);
  });
});

describe('export options migration', () => {
  it('old saves keep their transparent background and gain defaults for the rest', () => {
    const m = migrateExportOpts({ scale: 3, transparent: true, embed: false, csvN: 50 } as Partial<ExportOpts>);
    expect(m.bg).toBe('transparent');
    expect(m.scale).toBe(3);
    expect(m.embed).toBe(false);
    expect(m.csvN).toBe(50);
    expect(m.format).toBe('png');
    expect(m.sizeMode).toBe('preset');
    expect(m.nameTpl).toBe('');
    expect('transparent' in m).toBe(false);
  });

  it('an opaque old save becomes the theme surface; a fresh save is untouched', () => {
    expect(migrateExportOpts({ transparent: false } as Partial<ExportOpts>).bg).toBe('theme');
    expect(migrateExportOpts(undefined)).toEqual(DEFAULT_SETTINGS.exportOpts);
    expect(migrateExportOpts({ bg: 'custom' }).bg).toBe('custom');
  });
});

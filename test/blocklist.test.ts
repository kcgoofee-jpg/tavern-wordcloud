import { describe, expect, it } from 'vitest';
import { blockReason, applyBlocklist, setBaselineWords } from '../src/core/blocklist';
import { parseManualBlocklist } from '../src/core/blocklist/manual';
import { nsfwKind, NSFW_EXPLICIT_KINDS } from '../src/core/nsfw';
import { analyze, analyzeAsync, DEFAULT_ANALYZE_OPTIONS } from '../src/core/analyze';
import fs from 'node:fs';
import path from 'node:path';

describe('blocklists', () => {
  it('the manual list parses sections and comments', () => {
    const e = parseManualBlocklist('## 分词碎片（说明）\n句话  # 注释\n\n## 预设自带\n输入\n# 整行注释\n');
    expect(e).toEqual([{ word: '句话', reason: '分词碎片' }, { word: '输入', reason: '预设自带' }]);
  });
  it('the three listed words are blocked, normal words are not', () => {
    expect(blockReason('句话')?.reason).toBe('manual');
    expect(blockReason('输入')?.reason).toBe('manual');
    expect(blockReason('小此')?.reason).toBe('manual');
    expect(blockReason('办公室')).toBeNull();
  });
  it('baseline words are removed silently, including as substrings, regardless of the owner-list switch', () => {
    setBaselineWords(['某某某']);
    const r = applyBlocklist([{ text: '某某某' }, { text: '前某某某' }, { text: '合同' }], false);
    setBaselineWords([]);
    expect(r.kept.map((w) => w.text)).toEqual(['合同']);
    expect(r.blocked.total).toBe(0);
    expect(blockReason('某某某')).toBeNull();
  });
  it('applyBlocklist counts and samples only owner-list hits', () => {
    const r = applyBlocklist([{ text: '句话' }, { text: '合同' }]);
    expect(r.kept.map((w) => w.text)).toEqual(['合同']);
    expect(r.blocked.total).toBe(1);
    expect(r.blocked.samples.map((s) => s.word)).toEqual(['句话']);
  });
});

describe('explicit-word categories', () => {
  it('whole-word by category; 3+ character entries match as substrings; two-character words with a sensitive character are maybe; others null', () => {
    expect(nsfwKind('高潮')).toBe('act');
    expect(nsfwKind('母畜')).toBe('slur');
    expect(nsfwKind('强奸处女案')).toBe('taboo');
    expect(nsfwKind('穴位')).toBe('maybe');
    expect(nsfwKind('合同')).toBeNull();
    // 高潮迭起 must not match: two-character entries are whole-word only
    expect(nsfwKind('高潮迭起')).toBeNull();
  });
  it('ordinary nouns are mild or maybe, not explicit', () => {
    expect(nsfwKind('项圈')).toBe('bdsm');
    expect(nsfwKind('胸部')).toBe('body');
    expect(nsfwKind('罩杯')).toBe('wear');
    expect(nsfwKind('母马')).toBe('maybe');
    for (const w of ['项圈', '胸部', '罩杯', '母马']) expect(NSFW_EXPLICIT_KINDS).not.toContain(nsfwKind(w));
    // Words removed from the list
    for (const w of ['战栗', '颤抖', '喘息', '欲望', '逼近', '奸细']) expect(nsfwKind(w)).toBeNull();
    // 淫威 is off the list but the single-character rule still tags it `maybe`
    expect(nsfwKind('淫威')).toBe('maybe');
  });
  it('hide and only use the selected categories; adding body includes 胸部', () => {
    const content = JSON.stringify({ name: 'x', is_user: true, mes: '合同 合同 合同 高潮 高潮 高潮 胸部 胸部 胸部 穴位 穴位 穴位' });
    const base = { ...DEFAULT_ANALYZE_OPTIONS, roles: ['user'] as ('user' | 'char' | 'system')[], tokenize: { ...DEFAULT_ANALYZE_OPTIONS.tokenize, minCount: 1 } };
    const texts = (o: typeof base) => analyze([{ name: 'a.jsonl', content }], o).words.map((w) => w.text);
    const only = texts({ ...base, nsfwMode: 'only' });
    expect(only).toEqual(['高潮']);
    const hide = texts({ ...base, nsfwMode: 'hide' });
    expect(hide).not.toContain('高潮'); expect(hide).toContain('胸部'); expect(hide).toContain('穴位'); expect(hide).toContain('合同');
    const hideBody = texts({ ...base, nsfwMode: 'hide', nsfwKinds: [...base.nsfwKinds, 'body'] });
    expect(hideBody).not.toContain('胸部'); expect(hideBody).toContain('穴位');
    const r = analyze([{ name: 'a.jsonl', content }], base);
    expect(r.sensitive).toBe(1);
    expect(r.nsfwByKind.find((x) => x.kind === 'body')?.words).toBe(1);
    expect(r.nsfwByKind.find((x) => x.kind === 'maybe')?.words).toBe(1);
    expect(r.words.find((w) => w.text === '胸部')?.nsfw).toBe('body');
  });
});

const FIX = path.join(process.cwd(), 'fixtures', 'ceo-zh.jsonl');
describe.skipIf(!fs.existsSync(FIX))('异步分析', () => {
  it('identical to the sync result; progress reaches the total', async () => {
    const content = fs.readFileSync(FIX, 'utf8');
    const opts = { ...DEFAULT_ANALYZE_OPTIONS, roles: ['user', 'char'] as ('user' | 'char' | 'system')[] };
    const a = analyze([{ name: 'a.jsonl', content }], opts);
    const ticks: [number, number][] = [];
    const b = await analyzeAsync([{ name: 'a.jsonl', content }], opts, undefined, undefined, (d, t) => ticks.push([d, t]));
    expect(b.words).toEqual(a.words);
    expect(b.allWords.length).toBe(a.allWords.length);
    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks[ticks.length - 1][0]).toBe(ticks[ticks.length - 1][1]);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i][0]).toBeGreaterThan(ticks[i - 1][0]);
  });
});

describe('template words', () => {
  it('a word that appears about once in most messages is removed as template', () => {
    const fill = ['她推开门走了进去', '窗外下起了雨', '两个人沉默了很久', '电话突然响了起来', '他把杯子放回桌上', '楼下传来脚步声'];
    const rows = Array.from({ length: 12 }, (_, i) => JSON.stringify({ name: 'Bot', is_user: false, mes: `选项提示 ${fill[i % 6]}，${i % 2 ? '风景' : '这里的风景'}真不错，${fill[(i + 1) % 6]}，${fill[(i + 2) % 6]}。` }));
    const r = analyze([{ name: 'a.jsonl', content: rows.join('\n') }], { ...DEFAULT_ANALYZE_OPTIONS, roles: ['char'], tokenize: { ...DEFAULT_ANALYZE_OPTIONS.tokenize, minCount: 1 } });
    const texts = r.allWords.map((w) => w.text);
    expect(texts).not.toContain('选项提示');
    expect(r.blocked.byReason.template).toBeGreaterThan(0);
    expect(texts.length).toBeGreaterThan(5);
  });
});

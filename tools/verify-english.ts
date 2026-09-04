/**
 * English tokenization and English UI acceptance run. Every item reports the
 * measured value and the value with the feature disabled; they must differ.
 */
import fs from 'node:fs';
import { analyze, DEFAULT_ANALYZE_OPTIONS, type AnalyzeOptions } from '../src/core/analyze';
import { parseChatFile, DEFAULT_PARSE_OPTIONS } from '../src/core/parse';
import { segmentToChunks } from '../src/core/tokenize';
import { planMerge, detectEnglishNames } from '../src/core/english';
import { buildStopwords } from '../src/core/stopwords';
import { translate, englishKeys } from '../src/ui/i18n';

const EN = 'fixtures/ceo-en.jsonl';
const content = fs.readFileSync(EN, 'utf8');
const base: AnalyzeOptions = {
  ...DEFAULT_ANALYZE_OPTIONS,
  roles: ['user', 'char'],
  kinds: ['plain', 'person', 'place', 'time'],
  tokenize: { ...DEFAULT_ANALYZE_OPTIONS.tokenize, maxWords: 60, minCount: 2 },
};
const run = (o: Partial<AnalyzeOptions['tokenize']> = {}) =>
  analyze([{ name: EN, content }], { ...base, tokenize: { ...base.tokenize, ...o } });

const line = (s: string) => console.log(s);
let failed = 0;
const check = (ok: boolean, label: string, detail = '') => {
  line(`  ${ok ? '✅' : '❌'} ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failed++;
};

line('══════════ 英文语料实测（ceo-en.jsonl，200 层）══════════\n');

// ── Size and timing ──
const t0 = performance.now();
const parsed = parseChatFile(EN, content, DEFAULT_PARSE_OPTIONS);
const parseMs = performance.now() - t0;
const t1 = performance.now();
const r = run();
const totalMs = performance.now() - t1;
const raw = parsed.messages.reduce((a, m) => a + m.raw.length, 0);
const clean = parsed.messages.reduce((a, m) => a + m.text.length, 0);

line('【规模与耗时】');
line(`  消息 ${parsed.messages.length} 条`);
line(`  原文 ${raw} → 清洗后 ${clean}（去噪 ${(((raw - clean) / raw) * 100).toFixed(1)}%）`);
line(`  解析 ${parseMs.toFixed(1)} ms · 分词 ${(totalMs - parseMs).toFixed(1)} ms`);
line(`  ${r.uniqueTokens} 个不重复词 / ${r.totalTokens} 个词元\n`);

// ── 1. Lemmatization is active ──
line('【1. 英文词形归并】');
const counts = new Map<string, number>();
for (const m of parsed.messages) for (const c of segmentToChunks(m.text)) for (const tok of c) {
  const w = tok.toLowerCase(); counts.set(w, (counts.get(w) ?? 0) + 1);
}
const stop = buildStopwords([], true, true);
const plan = planMerge(counts, (w) => stop.has(w));
line(`  归并 ${plan.groups} 组 / ${plan.merged} 个表面形式`);
check(plan.groups > 100, '归并组数 > 100', `实际 ${plan.groups}`);

/** Tokenization properties are checked on the full table, not the TOP 60. */
const all = (o: object = {}) => new Map(run({ maxWords: 100000, minCount: 1, ...o } as never)
  .allWords.map((w) => [w.text, w.count]));
const onAll = all();
const offAll = all({ mergeEnglishForms: false });
const groups = [['need', 'needs', 'needed', 'needing'], ['work', 'works', 'worked', 'working']];
for (const g of groups) {
  const a = g.filter((f) => onAll.has(f));
  const b = g.filter((f) => offAll.has(f));
  check(a.length === 1 && b.length > a.length,
    `${g[0]} 系列：开=${a.length} 个词（${a[0]}=${onAll.get(a[0]) ?? 0}），关=${b.length} 个词`,
    '（关掉必须更多，否则这条是空跑的）');
}
const poss = ["adrian's", "nora's", "whitlock's"];
check(poss.every((p) => !onAll.has(p)) && poss.some((p) => offAll.has(p)),
  '所有格并回本名', `开=${poss.filter((p) => onAll.has(p)).length} 关=${poss.filter((p) => offAll.has(p)).length}`);

// ── 2. English proper nouns ──
line('\n【2. 英文专名（大小写做证据）】');
const names = detectEnglishNames(parsed.messages.map((m) => m.text));
line(`  识别出 ${names.length} 个：${names.slice(0, 6).join(' / ')}`);
check(names.includes('Kestrel Holdings'), '多词公司名被认出来');
check(names.includes('Adrian Kestrel'), '多词人名被认出来');
/** Multi-word names come from the dictionary path; the evidence is a token containing a space. */
const multi = [...onAll.keys()].filter((w) => w.includes(' '));
check(onAll.has('kestrel holdings'), '并成一个词元进了词表',
  `kestrel holdings=${onAll.get('kestrel holdings') ?? 0} 次`);
check(multi.length >= 3, `词表里有 ${multi.length} 个含空格的词元（只能由词典合并产生）`,
  multi.slice(0, 4).join(' / '));

// ── 3. No invented words ──
line('\n【3. 词云上的词必须在原文里逐字存在】');
const lower = content.toLowerCase();
const whole = (w: string) => (/^[a-z][a-z' -]*$/.test(w)
  ? new RegExp(`(?<![a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`).test(lower)
  : lower.includes(w));
const ghosts = run({ maxWords: 100000 } as never).allWords.filter((w) => !whole(w.text.toLowerCase()));
check(ghosts.length === 0, '全部词表零假词', `${ghosts.length} 个${ghosts.length ? '：' + ghosts.slice(0, 5).map((g) => g.text).join(' ') : ''}`);

// ── 4. Contamination ──
line('\n【4. TOP 60 无代码词 / 插件标识串】');
const BAD = /^(fate_?ui|updatevariable|statusplaceholder\w*|jsonpatch|analysis|thinking|style|div|span|px|rgba?|linear|gradient|background|padding|border|display|flex|op|replace|path|value|img|src|base64|keyframes|typeof|undefined)$/i;
const dirty = r.words.filter((w) => BAD.test(w.text));
check(dirty.length === 0, 'TOP 60 干净', dirty.map((w) => w.text).join(' '));
const cleanOff = { ...base.clean };
for (const k of Object.keys(cleanOff) as (keyof typeof cleanOff)[])
  if (typeof cleanOff[k] === 'boolean') (cleanOff as Record<string, unknown>)[k] = false;
const dirtyOff = analyze([{ name: EN, content }], { ...base, clean: cleanOff }).words.filter((w) => BAD.test(w.text));
check(dirtyOff.length > 0, '关掉清洗后确实会脏（证明这条不是空跑）',
  dirtyOff.slice(0, 5).map((w) => `${w.text}(${w.count})`).join(' '));

line('\n  TOP 60：');
for (let i = 0; i < r.words.length; i += 6) {
  line('   ' + r.words.slice(i, i + 6).map((w) => `${w.text}(${w.count})`.padEnd(19)).join(''));
}

// ── 5. English UI ──
line('\n【5. 英文界面】');
const keys = englishKeys();
line(`  词典 ${keys.length} 条`);
check(keys.length > 100, '词典条目 > 100', `实际 ${keys.length}`);
check(keys.every((k) => !/[一-鿿]/.test(translate('en', k))), '英文译文里没有残留中文');
check(translate('en', '把酒馆的聊天记录拖进来') === 'Drop a SillyTavern chat log here', '入口页译文正确');
check(translate('en', '读到 {n} 份', { n: 3 }) !== '', '占位符替换可用');
check(translate('zh', '风格与配色') === '风格与配色', '中文原样返回');

line(`\n══════════ ${failed === 0 ? '全部通过' : `${failed} 项未通过`} ══════════`);
process.exit(failed ? 1 : 0);

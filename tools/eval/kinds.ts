/**
 * Word-kind precision harness (place / time).
 *
 *   npx vite-node tools/eval/kinds.ts        # or: npm run eval:kinds
 *
 * `eval:persons` measures the person layer. This one measures the other two
 * morphology-driven kinds: `classify` labels a word `place` from a suffix and
 * `time` from a large alternation, and both used to over-fire — body parts and
 * direction words became places, adverbs and conjunctions became time.
 *
 * Negatives are the strings a user reported on a real AMERICA card log
 * (2026-09-04). Positives are hand-written ground truth. Exits non-zero when any
 * negative is still accepted, or when a gated positive is lost.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, detectEntities } from '../../src/core/entities';
import { corpusSentences } from './run';

/* ---------- Negatives: observed on the real export ---------- */

/** Body parts, direction words and verb-object phrases caught by the place suffixes. */
const PLACE_NEG = [
  '胸口', '乳房', '面部', '大口', '裆部', '胸部', '腰部', '臀部', '阴部', '根部',
  '虎口', '背部', '中部', '内部', '外部', '底部', '尾部',
  '吐司', '查房', '接口', '磁场', '一路', '当场', '现场',
];

/** Adverbs, conjunctions and non-temporal nouns caught by the time alternation. */
const TIME_NEG = [
  '雨水', '最终', '更深', '往前', '一秒', '一瞬间', '临时', '平时',
  '这时', '什么时候', '偶尔', '先前', '不久',
];

/* ---------- Positives ---------- */

interface Positive { word: string; gate: boolean }

/**
 * Gated positives are the ones the suffix / alternation rules can reach at all.
 * `北京` / `墨西哥` carry no place suffix and no rule is supposed to produce
 * them without a gazetteer (hard rule 3: no dictionary files), so they are
 * reported for recall but not gated.
 */
const UNGATED = new Set(['墨西哥', '北京']);

const PLACE_POS: Positive[] = [
  '片场', '餐厅', '厨房', '浴室', '卧室', '客厅', '二楼', '一楼', '门口', '出口',
  '入口', '柏油路', '高速公路', '马路', '墨西哥', '北京', '朝阳区', '居民楼',
  '排练厅', '中央戏剧学院',
].map((word) => ({ word, gate: !UNGATED.has(word) }));

const TIME_POS: Positive[] = [
  '十分钟', '五分钟', '周日', '正午', '上午', '早上', '昨夜', '清晨', '下午',
  '三天', '八分', '六号', '二号', 'sunday', 'afternoon', 'morning', 'today',
].map((word) => ({ word, gate: true }));

/* ---------- Corpora ---------- */

/**
 * Real logs are read only to check the positives actually occur in natural
 * writing; nothing is copied out and no text is printed.
 */
function fixtureTexts(): string[] {
  const dir = fileURLToPath(new URL('../../fixtures/', import.meta.url));
  const out: string[] = [];
  let files: string[];
  try { files = fs.readdirSync(dir); } catch { return out; }
  for (const f of files) {
    if (!f.endsWith('.jsonl')) continue;
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line) as { mes?: unknown };
        if (typeof o.mes === 'string') out.push(o.mes);
      } catch { /* not a message line */ }
    }
  }
  return out;
}

/* ---------- Run ---------- */

const logs = corpusSentences();
const fixtures = fixtureTexts();
if (!logs.length) console.log('（本机酒馆语料没找到，只用 fixtures）');
const corpus = [...logs, ...fixtures];
const index = detectEntities(corpus);

const seenIn = (w: string) => corpus.some((t) => t.includes(w));

function measure(kind: 'place' | 'time', pos: Positive[], neg: string[]) {
  const tp = pos.filter((p) => classify(p.word, index) === kind);
  const fp = neg.filter((n) => classify(n, index) === kind);
  const fn = pos.filter((p) => classify(p.word, index) !== kind);
  const gated = pos.filter((p) => p.gate);
  const lost = gated.filter((p) => classify(p.word, index) !== kind);
  const precision = tp.length / Math.max(1, tp.length + fp.length);
  const label = kind === 'place' ? '地点' : '时间';
  console.log(`\n【${label}】正例 ${pos.length}（门禁 ${gated.length}）  负例 ${neg.length}`);
  console.log(`  准确率 precision = ${tp.length}/${tp.length + fp.length} = ${(precision * 100).toFixed(1)}%`);
  console.log(`  召回率 recall    = ${tp.length}/${pos.length} = ${(tp.length / pos.length * 100).toFixed(1)}%`);
  console.log(`  门禁召回        = ${gated.length - lost.length}/${gated.length}`);
  if (fp.length) console.log(`  ❌ 仍被当成${label}的负例：` + fp.join(' '));
  if (fn.length) console.log(`  没被认成${label}的正例：` + fn.map((p) => p.word + (p.gate ? '(门禁)' : '')).join(' '));
  return fp.length + lost.length;
}

console.log(`语料：本机 ${logs.length} 句 + fixtures ${fixtures.length} 条`);
const missing = [...PLACE_POS, ...TIME_POS].filter((p) => !/^[a-z]+$/.test(p.word) && !seenIn(p.word));
if (missing.length) console.log(`（正例里语料未出现的：${missing.map((p) => p.word).join(' ')}）`);

const bad = measure('place', PLACE_POS, PLACE_NEG) + measure('time', TIME_POS, TIME_NEG);

if (bad) {
  console.log(`\n❌ 不通过：${bad} 项`);
  process.exit(1);
}
console.log('\n✅ 通过：负例全部拒绝，门禁正例全部保留');

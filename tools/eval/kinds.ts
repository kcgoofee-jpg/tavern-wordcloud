/**
 * Word-kind precision harness (place / time / brand / wear / title).
 *
 *   npx vite-node tools/eval/kinds.ts        # or: npm run eval:kinds
 *
 * `eval:persons` measures the person layer. This one measures the other two
 * morphology-driven kinds: `classify` labels a word `place` from a suffix and
 * `time` from a large alternation, and both used to over-fire — body parts and
 * direction words became places, adverbs and conjunctions became time.
 *
 * Negatives are the strings misfiled in an earlier round; the words below are rewritten examples
 * (2026-09-04). Positives are hand-written ground truth. Exits non-zero when any
 * negative is still accepted, or when a gated positive is lost.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyKinds, detectEntities, ENTITY_LABEL, EXPERIMENTAL_KINDS, type EntityKind } from '../../src/core/entities';
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

/* ---------- The three kinds added in F10 (docs/27 §7) ---------- */

/**
 * Garments. Negatives are words that end in one of the design note's seed
 * characters but are not clothing (声带 / 毛巾 / 说服), plus ordinary objects
 * from the local TOP list.
 */
const WEAR_POS: Positive[] = [
  '衬衫', '外套', '裙子', '裤子', '丝袜', '领带', '内衣', '吊带', '大衣', '毛衣',
  '制服', '睡衣', '帽子', '鞋子', '高跟鞋', '长裙', '短裤', '袜子', '皮靴', '围巾',
  '婚纱', '手套',
].map((word) => ({ word, gate: true }));
const WEAR_NEG = [
  '声带', '磁带', '胶带', '地带', '一带', '韧带', '绷带', '纽带', '毛巾', '餐巾',
  '说服', '佩服', '舒服', '克服', '征服', '屈服',
  '合同', '电话', '沙发', '茶几', '抽屉',
];

/** Terms of address and job titles. `赵总` / `王老师` exercise the 姓 + 称谓 construction. */
const TITLE_POS: Positive[] = [
  '陛下', '殿下', '大人', '老板', '先生', '小姐', '女士', '夫人', '少爷', '公子',
  '总监', '经理', '导演', '制片', '主任', '老师', '医生', '队长', '前辈', '师父',
  '赵总', '王老师', '李经理',
].map((word) => ({ word, gate: true }));
const TITLE_NEG = [
  '合同', '电话', '手机', '名字', '电视', '抽屉', '项目', '剧组', '书包', '协议',
  '信封', '剧本', '角色', '消息', '投资', '平台', '屏幕', '筷子', '桌子', '沙发',
];

/**
 * Brands. Only two shapes are claimed: a token that itself ends in a corporate
 * suffix, and a corpus-attested Latin or transliterated word. The second shape
 * needs sentences to work on, so a handful of hand-written ones are appended to
 * the corpus (no real chat content is used or printed).
 */
const BRAND_POS: Positive[] = [
  '山文化工作室', '天宇集团', '星辰工作室', '华美公司', '蓝天集团', '光影工作室',
  '永久牌', '飞跃牌', '海鸥牌', '回力牌', '大白兔牌', '红星牌', '微软官方', '索尼公司',
  'nike', 'adidas', 'chanel', '迪奥', '索菲亚',
].map((word) => ({ word, gate: true }));
const BRAND_NEG = [
  '公司', '电话', '合同', '项目', '剧组', '平台', '投资', '影视', '制片', '卫视',
  '名片', '制作', '出品', '行业', '渠道', '财务', '部门', '银行', '会议', '账本',
];

/** Hand-written sentences, only so the corpus-context brand rules have something to fire on. */
const BRAND_SENTENCES = [
  'NIKE牌的鞋摆在门口，ADIDAS公司的人还没来。',
  'Chanel官方发了新款，ADIDAS公司说要跟。',
  'NIKE牌的广告挂在楼下，Chanel官方也来了。',
  '她穿了迪奥的裙子。', '我买了迪奥的新款。', '迪奥牌的口红也在。',
  '她穿索菲亚的外套。', '我买索菲亚的鞋。', '索菲亚牌的包在柜台上。',
];

/* ---------- Run ---------- */

const logs = corpusSentences();
const fixtures = fixtureTexts();
if (!logs.length) console.log('（本机酒馆语料没找到，只用 fixtures）');
const corpus = [...logs, ...fixtures];
const index = detectEntities(corpus);
/** Separate index so the synthetic brand sentences cannot influence the place / time numbers. */
const brandIndex = detectEntities([...corpus, ...BRAND_SENTENCES]);

const seenIn = (w: string) => corpus.some((t) => t.includes(w));

/** A word can carry several kinds now; a hit means the kind is among them. */
const hasKind = (w: string, kind: EntityKind, idx = index) =>
  classifyKinds(w, idx).some((k) => k.kind === kind);

interface Report { kind: EntityKind; precision: number; bad: number }

function measure(kind: EntityKind, pos: Positive[], neg: string[], idx = index): Report {
  const tp = pos.filter((p) => hasKind(p.word, kind, idx));
  const fp = neg.filter((n) => hasKind(n, kind, idx));
  const fn = pos.filter((p) => !hasKind(p.word, kind, idx));
  const gated = pos.filter((p) => p.gate);
  const lost = gated.filter((p) => !hasKind(p.word, kind, idx));
  const precision = tp.length / Math.max(1, tp.length + fp.length);
  const label = ENTITY_LABEL[kind];
  console.log(`\n【${label}】正例 ${pos.length}（门禁 ${gated.length}）  负例 ${neg.length}`);
  console.log(`  准确率 precision = ${tp.length}/${tp.length + fp.length} = ${(precision * 100).toFixed(1)}%`);
  console.log(`  召回率 recall    = ${tp.length}/${pos.length} = ${(tp.length / pos.length * 100).toFixed(1)}%`);
  console.log(`  门禁召回        = ${gated.length - lost.length}/${gated.length}`);
  if (fp.length) console.log(`  ❌ 仍被当成${label}的负例：` + fp.join(' '));
  if (fn.length) console.log(`  没被认成${label}的正例：` + fn.map((p) => p.word + (p.gate ? '(门禁)' : '')).join(' '));
  return { kind, precision, bad: fp.length + lost.length };
}

console.log(`语料：本机 ${logs.length} 句 + fixtures ${fixtures.length} 条`);
const missing = [...PLACE_POS, ...TIME_POS].filter((p) => !/^[a-z]+$/.test(p.word) && !seenIn(p.word));
if (missing.length) console.log(`（正例里语料未出现的：${missing.map((p) => p.word).join(' ')}）`);

/** The two original kinds are gated word by word: every negative rejected, every gated positive kept. */
let bad = measure('place', PLACE_POS, PLACE_NEG).bad + measure('time', TIME_POS, TIME_NEG).bad;

/**
 * The three new kinds are gated on precision instead: 80% is the line from
 * docs/27 §7, and anything under it must be declared experimental in
 * `EXPERIMENTAL_KINDS` so the UI warns about it. Recall is reported, not gated —
 * these rules are small seed tables on purpose.
 */
const NEW_KINDS: Report[] = [
  measure('wear', WEAR_POS, WEAR_NEG),
  measure('title', TITLE_POS, TITLE_NEG),
  measure('brand', BRAND_POS, BRAND_NEG, brandIndex),
];
console.log('');
for (const r of NEW_KINDS) {
  const weak = r.precision < 0.8;
  const declared = EXPERIMENTAL_KINDS.includes(r.kind);
  if (weak && !declared) {
    console.log(`❌ ${ENTITY_LABEL[r.kind]} 精度 ${(r.precision * 100).toFixed(1)}% < 80%，但没写进 EXPERIMENTAL_KINDS`);
    bad++;
  } else if (!weak && declared) {
    console.log(`（${ENTITY_LABEL[r.kind]} 精度已达 ${(r.precision * 100).toFixed(1)}%，可以从 EXPERIMENTAL_KINDS 里去掉）`);
  } else if (weak) {
    console.log(`⚠️  ${ENTITY_LABEL[r.kind]} 精度 ${(r.precision * 100).toFixed(1)}%，已标为实验`);
  }
}

if (bad) {
  console.log(`\n❌ 不通过：${bad} 项`);
  process.exit(1);
}
console.log('\n✅ 通过：负例全部拒绝，门禁正例全部保留，新类精度与实验标注一致');

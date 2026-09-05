/**
 * Person-name precision harness.
 *
 *   npx vite-node tools/eval/persons.ts        # or: npm run eval:persons
 *
 * `npm run eval` only asks whether a proper noun is segmented whole; it never
 * punishes junk that the entity layer promotes to a person name. This harness
 * measures the other side: how many of the strings `detectEntities` labels
 * `person` are really names.
 *
 * Corpora: the local SillyTavern export (read-only, nothing copied out) plus the
 * repo fixtures. Exits non-zero when a known non-name is detected as a person or
 * when a gated positive disappears.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { corpusSentences } from './run';
import { GROUND_TRUTH } from './groundtruth';
import { detectEntities } from '../../src/core/entities';
import { detectEnglishNames, ENGLISH_SINGLE_MIN } from '../../src/core/english';
import { tokenizeCorpus } from '../../src/core/tokenize';
import { localCorpusRoots } from '../../tools/localCorpus';

/* ---------- Positives ---------- */

/** Character-card folder names from the local export. Names only, never log text. */
function cardFolders(): string[] {
  const dir = (localCorpusRoots()[0] ?? '') + '/default-user/chats';
  let e: fs.Dirent[];
  try { e = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return e.filter((x) => x.isDirectory() && /[一-鿿]/.test(x.name)).map((x) => x.name);
}

interface Positive {
  word: string;
  /** Gated positives must stay detected; the rest are reported only. */
  gate: boolean;
  why: string;
}

/**
 * Gated = detected as a person at the 2026-09-04 baseline, so losing one is a
 * regression. `通告单` was on that list as a frozen false positive (C5: the
 * corpus pass stole document/media/event nouns in subject position); it now
 * lives in NEGATIVES instead.
 */
const BASELINE_DETECTED = new Set([
  '沈砚秋', '沈高飞', '周敬亭', '尹昭', '苏挽', '韩野', '佟慧', '郑晓龙',
  '制片主任',
]);

const POSITIVES: Positive[] = [
  ...GROUND_TRUTH.map((g) => ({
    word: g.word, gate: BASELINE_DETECTED.has(g.word), why: g.why,
  })),
  ...cardFolders().map((w) => ({
    word: w, gate: BASELINE_DETECTED.has(w), why: '角色卡文件夹名',
  })),
];

/* ---------- Negatives ---------- */

/**
 * Junk the entity layer used to promote to `person`.
 *
 * The first block is the list observed on the real export (2026-09-04). The
 * second block was harvested by running `detectEntities` over the local logs and
 * over `fixtures/*.jsonl` and picking strings that are plainly common nouns or
 * phrases: object names, room fixtures, job titles, stationery.
 */
const NEGATIVES: string[] = [
  // observed on the real export
  '侍应生', '木质地板', '仔裤裆部', '理石台面', '理石桌面', '完全暴露', '彻底暴露',
  '一文冷硬', '另一只手', '针织开衫', '天鹅绒沙', '条斯理地', '大明星', '受控制地',
  // harvested from the local logs
  '中年男人', '项目经理', '办公室', '文件夹', '复印件', '脚步声', '梧桐树',
  '小板凳', '苹果箱', '号码牌', '登记表', '预算表', '补充条款', '网络平台',
  '塑料叶子', '第一场戏', '厨房门口', '客厅地板',
  // harvested from fixtures/*.jsonl
  '保温杯', '台词本', '监视器', '折叠椅', '笔记本', '电梯门', '生意场', '云顶公馆',
  // C5: corpus person pass used to promote these in subject/possessive slots
  '合同', '协议', '通告单', '台词', '开幕式',
];

/* ---------- Corpora ---------- */

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

const detected = new Set<string>();
for (const texts of [logs, fixtures]) {
  if (!texts.length) continue;
  for (const n of detectEntities(texts).personNames) detected.add(n);
}

const tp = POSITIVES.filter((p) => detected.has(p.word));
const fn = POSITIVES.filter((p) => !detected.has(p.word));
const fp = NEGATIVES.filter((n) => detected.has(n));
const precision = tp.length / Math.max(1, tp.length + fp.length);
const recall = tp.length / Math.max(1, POSITIVES.length);
const gated = POSITIVES.filter((p) => p.gate);
const gatedLost = gated.filter((p) => !detected.has(p.word));

console.log(`语料：本机 ${logs.length} 句 + fixtures ${fixtures.length} 条；候选人名 ${detected.size} 个`);
console.log(`正例 ${POSITIVES.length}（其中门禁 ${gated.length}）  负例 ${NEGATIVES.length}`);
console.log(`准确率 precision = ${tp.length}/${tp.length + fp.length} = ${(precision * 100).toFixed(1)}%`);
console.log(`召回率 recall    = ${tp.length}/${POSITIVES.length} = ${(recall * 100).toFixed(1)}%`);
console.log(`门禁召回        = ${gated.length - gatedLost.length}/${gated.length}`);

if (fp.length) console.log(`\n误判成人名的负例 ${fp.length} 个：` + fp.join(' '));
if (fn.length) console.log(`\n没被认成人名的正例 ${fn.length} 个：` + fn.map((p) => p.word + (p.gate ? '(门禁)' : '')).join(' '));

/* ---------- English names ---------- */

/**
 * The Chinese corpora above say nothing about `detectEnglishNames`, so the English half runs on
 * `fixtures/ceo-en.jsonl`. Positives are the people and places the log is about; negatives are
 * the words the capitalization rule has actually produced that are not names. Gated on the
 * 2026-09-05 baseline: `ENGLISH_SINGLE_MIN = 4` misses Delgado and accepts three non-names,
 * and the possessive / all-caps folding must keep every spelling of a name on one entry.
 */
const EN_POSITIVE = [
  'Adrian', 'Nora', 'Eleanor', 'Dominic', 'Marcus', 'Priya', 'Elena', 'Cole',
  'Vance', 'Kestrel', 'Whitlock', 'Aurelian', 'Ravensmoor', 'Halcyon',
];
const EN_NEGATIVE_GATED = ['Sunday', 'Level', 'Sat', 'Group'];

const enTexts = fixtureTexts().filter((t) => (t.match(/[A-Za-z]/g)?.length ?? 0) > t.length * 0.3);
let enFailed = false;
if (!enTexts.length) {
  console.log('\n（fixtures 里没有英文语料，跳过英文人名部分）');
} else {
  const enNames = new Set(detectEnglishNames(enTexts));
  const enFn = EN_POSITIVE.filter((w) => !enNames.has(w));
  const enFp = EN_NEGATIVE_GATED.filter((w) => enNames.has(w));

  // Possessive and shouted spellings must land on the same word as the plain one.
  const shout = [
    "Nicole walked in. The room was cold and Nicole's coat was wet.",
    "Later Nicole's brother arrived. NICOLE shouted at him.",
    'Maya said hello to Nicole. NICOLE waved back.',
    "NICOLE and Maya left. Nicole's keys were gone.",
    'It was Nicole who found them. Maya thanked Nicole.',
  ];
  const shoutNames = detectEnglishNames(shout);
  const forms = tokenizeCorpus(shout, { dictionary: shoutNames }).allWords.filter((w) => w.text.startsWith('nicole'));
  const folded = forms.length === 1 && forms[0].text === 'nicole' && forms[0].count === 10;

  console.log(`\n英文语料 ${enTexts.length} 条：正例 ${EN_POSITIVE.length}  门禁负例 ${EN_NEGATIVE_GATED.length}  SINGLE_MIN = ${ENGLISH_SINGLE_MIN}`);
  console.log(`英文准确率 = ${EN_POSITIVE.length - enFn.length}/${EN_POSITIVE.length - enFn.length + enFp.length}`);
  if (enFn.length) console.log(`  没被认成人名的英文正例：${enFn.join(' ')}`);
  if (enFp.length) console.log(`  误判成人名的英文负例：${enFp.join(' ')}`);
  console.log(`所有格 / 全大写归并：${folded ? '✅ Nicole / Nicole\'s / NICOLE 合成一条（10 次）' : `❌ 拆成了 ${forms.map((w) => `${w.text}×${w.count}`).join(' ')}`}`);
  enFailed = enFn.length > 0 || enFp.length > 0 || !folded;
}

if (fp.length || gatedLost.length || enFailed) {
  console.log('\n❌ 不通过' + (fp.length ? `：${fp.length} 个负例被当成人名` : '') +
    (gatedLost.length ? `：${gatedLost.length} 个门禁正例丢了` : '') +
    (enFailed ? '：英文人名部分退步了' : ''));
  process.exit(1);
}
console.log('\n✅ 通过：负例全部拒绝，门禁正例全部保留，英文人名与归并未退步');

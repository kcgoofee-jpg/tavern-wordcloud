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
 * regression. The rest are ground-truth proper nouns the entity layer never
 * claimed (an institution and a place longer or shorter than a name candidate,
 * and card names, which are titles rather than people) — reported for recall,
 * not gated, because no person rule is supposed to produce them.
 */
const BASELINE_DETECTED = new Set([
  '沈砚秋', '沈高飞', '周敬亭', '尹昭', '苏挽', '韩野', '佟慧', '郑晓龙',
  '制片主任', '通告单',
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

if (fp.length || gatedLost.length) {
  console.log('\n❌ 不通过' + (fp.length ? `：${fp.length} 个负例被当成人名` : '') +
    (gatedLost.length ? `：${gatedLost.length} 个门禁正例丢了` : ''));
  process.exit(1);
}
console.log('\n✅ 通过：负例全部拒绝，门禁正例全部保留');

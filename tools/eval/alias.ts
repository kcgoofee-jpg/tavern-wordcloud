/**
 * Equivalence-picker harness (notes/docs/27 s2.2, task F4).
 *
 *   npm run eval:alias
 *
 * Question: with an empty search box, does the ranked candidate list put the
 * word that means the same thing as the target in the top 1 / top 3?
 *
 * Corpus: the local SillyTavern export only (WC_LOCAL_CORPUS, colon-separated
 * roots; the harness skips itself and says why when nothing is configured).
 * Nothing from the logs is written here or printed beyond the word pairs below,
 * which are single words, not text.
 *
 * A pair is evaluated only when BOTH of its words survive into the candidate
 * pool of some chat folder; pairs that do not are reported as skipped rather
 * than counted as misses, so the rate says something about the ranking instead
 * of about the tokenizer's vocabulary.
 */
import fs from 'node:fs';
import path from 'node:path';
import { analyze, DEFAULT_ANALYZE_OPTIONS } from '../../src/core/analyze';
import { ALIAS_WEIGHTS, rankAliasCandidates } from '../../src/core/aliasScore';
import { localCorpusRoots } from '../localCorpus';
import type { WordCount } from '../../src/core/types';

/**
 * 15 pairs of words that refer to the same thing, picked by reading the local
 * logs. Words only — never a line of the logs themselves.
 */
const PAIRS: { a: string; b: string; why: string }[] = [
  { a: '西德妮', b: 'sydney', why: '中英对照：同一角色' },
  { a: 'sydney', b: '西德妮', why: '反向（打分不完全对称：长度、已别名项）' },
  { a: '本子', b: '剧本', why: '同物异称' },
  { a: '我妈', b: '妈妈', why: '同一人物的两种称呼' },
  { a: '我妈', b: '母亲', why: '口语 / 书面' },
  { a: '沈砚秋', b: '砚秋', why: '全名 / 单名' },
  { a: '沈高飞', b: '高飞', why: '全名 / 单名' },
  { a: '周敬亭', b: '敬亭', why: '全名 / 单名' },
  { a: '郑晓龙', b: '晓龙', why: '全名 / 单名' },
  { a: '砚山文化', b: '砚山', why: '机构全称 / 简称' },
  { a: '中央戏剧学院', b: '中戏', why: '学校全称 / 简称' },
  { a: '北京电视艺术', b: '北京电视艺术中心', why: '切断的全称 / 全称' },
  { a: '公司', b: '工作室', why: '同一家机构的两种叫法' },
  { a: '片酬', b: '分成', why: '同一笔钱的两种叫法' },
  { a: '角色', b: '戏份', why: '同一件事的两种叫法' },
];

/**
 * The shipped weight and the design's original 6, so a later corpus can show
 * whether the 2026-09-05 reduction (top-3 below the 60% bar) should be undone.
 */
const CO_WEIGHTS = [ALIAS_WEIGHTS.cooccur, 6];

function chatFolders(): { name: string; dir: string }[] {
  const out: { name: string; dir: string }[] = [];
  for (const root of localCorpusRoots()) {
    const base = path.join(root, 'default-user/chats');
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory()) out.push({ name: e.name, dir: path.join(base, e.name) });
    }
    // Backups hold the longer runs of the same chats.
    const backups = path.join(root, 'default-user/backups');
    if (fs.existsSync(backups)) out.push({ name: 'backups', dir: backups });
  }
  return out;
}

interface Scope {
  name: string;
  words: WordCount[];
  cooccur: ReturnType<typeof analyze>['cooccur'];
  ms: number;
  chars: number;
}

function analyzeFolder(f: { name: string; dir: string }): Scope | null {
  let names: string[];
  try { names = fs.readdirSync(f.dir).filter((n) => n.endsWith('.jsonl')); } catch { return null; }
  if (!names.length) return null;
  const files = names.map((n) => ({ name: n, content: fs.readFileSync(path.join(f.dir, n), 'utf8') }));
  const t0 = Date.now();
  // Both sides of the conversation: the picker runs on whatever is in the cloud.
  const res = analyze(files, { ...DEFAULT_ANALYZE_OPTIONS, roles: ['user', 'assistant'] });
  return { name: f.name, words: res.words, cooccur: res.cooccur, ms: Date.now() - t0, chars: res.cleanChars };
}

const folders = chatFolders();
if (!folders.length) {
  console.log('跳过：没有本机语料。设置 WC_LOCAL_CORPUS（冒号分隔的酒馆 data 目录）后再跑。');
  process.exit(0);
}

const scopes = folders.map(analyzeFolder).filter((s): s is Scope => s !== null && s.words.length > 0);
if (!scopes.length) {
  console.log('跳过：本机语料里没有可分析的 .jsonl。');
  process.exit(0);
}

console.log(`语料：${scopes.length} 个会话范围，共 ${scopes.reduce((a, s) => a + s.chars, 0)} 个清洗后字符`);

for (const weight of CO_WEIGHTS) {
  let top1 = 0, top3 = 0, evaluated = 0;
  const skipped: string[] = [];
  const misses: string[] = [];
  for (const p of PAIRS) {
    // The first scope holding both words decides the pair.
    const scope = scopes.find((s) => {
      const keys = new Set(s.words.map((w) => w.text.toLowerCase()));
      return keys.has(p.a.toLowerCase()) && keys.has(p.b.toLowerCase());
    });
    if (!scope) { skipped.push(`${p.a}/${p.b}`); continue; }
    const target = scope.words.find((w) => w.text.toLowerCase() === p.a.toLowerCase())!;
    const ranked = rankAliasCandidates(target, scope.words, {
      cooccur: scope.cooccur, cooccurWeight: weight,
    });
    const at = ranked.findIndex((w) => w.text.toLowerCase() === p.b.toLowerCase());
    evaluated++;
    if (at === 0) top1++;
    if (at >= 0 && at < 3) top3++;
    else misses.push(`${p.a}→${p.b}(${at < 0 ? '未进前 8' : `第 ${at + 1}`})`);
  }
  const pct = (n: number) => (evaluated ? ((n / evaluated) * 100).toFixed(1) : '—') + '%';
  console.log(`\n共现权重 ${weight}：可评测 ${evaluated}/${PAIRS.length} 对（跳过 ${skipped.length}）`);
  console.log(`  top-1 命中 ${top1}/${evaluated} = ${pct(top1)}`);
  console.log(`  top-3 命中 ${top3}/${evaluated} = ${pct(top3)}`);
  if (misses.length) console.log(`  未进前三：${misses.join(' ')}`);
  if (skipped.length) console.log(`  跳过（词表里找不到其中一个词）：${skipped.join(' ')}`);
}

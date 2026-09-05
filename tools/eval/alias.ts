/**
 * Equivalence-picker harness (notes/docs/27 s2.2, TODO C.10).
 *
 *   npm run eval:alias
 *   npm run eval:alias -- --ablate     single-variable table, one signal off per row
 *
 * Question: with an empty search box, does the ranked candidate list put the word
 * that means the same thing as the target in the top 1 / top 3? The bar is
 * top-3 ≥ 60%, and a false-positive rate measured on pairs that look alike and
 * are *not* the same thing.
 *
 * ## Why the corpus here is synthetic
 *
 * The first version ranked inside the local SillyTavern export and could only
 * evaluate 3 of its 15 pairs: the other 12 never both survived into a word list.
 * 沈砚秋 is in the tokenizer's dictionary so 砚秋 is never emitted as a word of
 * its own; 西德妮 does not occur in any chat that also writes `sydney`. A rate
 * over three pairs measures the tokenizer's vocabulary, not the ranking.
 *
 * So the pool is built here, the way `tools/eval/coref.ts` builds its corpus and
 * for the same reason (AGENTS.md hard rule 1: real chat logs never enter the
 * repository). The *pairs* are the word shapes the local export actually
 * contains — full name / drop-surname, 机构全称 / 简称, 中英对照, two names for
 * one thing — and the words themselves are written out below; no line of any log
 * is. The local export is still ranked at the end as a reality check, reporting
 * whatever subset of the pairs it can see.
 *
 * Kinds come from `entities.ts` and the coreference groups from `detectCoref`,
 * both run over the generated messages, so those two signals are measured, not
 * assumed.
 */
import { rankAliasCandidates, ALL_ALIAS_SIGNALS, type AliasSignals, type AliasWord } from '../../src/core/aliasScore';
import { buildCooccur } from '../../src/core/cooccur';
import { classifyKinds, detectCoref, detectEntities, type CorefGroup } from '../../src/core/entities';
import { analyze, DEFAULT_ANALYZE_OPTIONS } from '../../src/core/analyze';
import { localCorpusRoots } from '../localCorpus';
import fs from 'node:fs';
import path from 'node:path';

interface Pair {
  a: string;
  b: string;
  why: string;
  /** Group tag for the per-family breakdown. */
  fam: 'coref' | 'abbrev' | 'cross' | 'spelling' | 'synonym';
  /**
   * `share` = the two forms appear together (a gloss, a rename in progress);
   * `apart` = complementary distribution, the shape a pair of spellings usually
   * has. Both are generated so the ablation can tell them apart.
   */
  dist: 'share' | 'apart';
  /** Sentences that establish the pair on their own terms (coreference needs them). */
  extra?: string[];
}

/**
 * 22 pairs that name the same thing. Seven are 中英对照 and two are Latin
 * spelling variants, which is where the picker was blindest.
 */
const PAIRS: Pair[] = [
  // ---- 中英对照 (7) ----
  { a: '西德妮', b: 'sydney', why: '音译 / 原名', fam: 'cross', dist: 'apart' },
  { a: 'sydney', b: '西德妮', why: '反向：打分不完全对称（长度、已别名项）', fam: 'cross', dist: 'apart' },
  { a: '玛丽', b: 'mary', why: '音译 / 原名', fam: 'cross', dist: 'apart' },
  { a: '艾莉丝', b: 'alice', why: '音译 / 原名（软音 c）', fam: 'cross', dist: 'apart' },
  { a: '杰克', b: 'jack', why: '音译 / 原名', fam: 'cross', dist: 'share' },
  { a: '索菲亚', b: 'sophia', why: '音译 / 原名（ph）', fam: 'cross', dist: 'apart' },
  { a: '莉莉丝', b: 'lilith', why: '音译 / 原名（th）', fam: 'cross', dist: 'apart' },
  // ---- 英文异写 (2) ----
  { a: 'sydney', b: 'sydny', why: '漏字母的异写', fam: 'spelling', dist: 'apart' },
  { a: 'claire', b: 'clair', why: '掉尾 e 的异写', fam: 'spelling', dist: 'apart' },
  // ---- 全称 / 简称 (4) ----
  { a: '砚山文化', b: '砚山', why: '机构全称 / 简称', fam: 'abbrev', dist: 'apart' },
  { a: '中央戏剧学院', b: '中戏', why: '取字缩写，不是子串', fam: 'abbrev', dist: 'apart' },
  { a: '北京电视艺术中心', b: '北京电视艺术', why: '被切断的全称 / 全称', fam: 'abbrev', dist: 'apart' },
  { a: '东阳影视基地', b: '东阳', why: '地名全称 / 简称', fam: 'abbrev', dist: 'apart' },
  // ---- 同指（detectCoref 已给出的组）(4) ----
  { a: '沈砚秋', b: '砚秋', why: '全名 / 去姓', fam: 'coref', dist: 'apart' },
  { a: '周敬亭', b: '敬亭', why: '全名 / 去姓', fam: 'coref', dist: 'apart' },
  { a: '郑晓龙', b: '晓龙', why: '全名 / 去姓（几乎不单独出现）', fam: 'coref', dist: 'apart' },
  { a: '陆时衍', b: '陆总', why: '全名 / 姓+头衔', fam: 'coref', dist: 'apart' },
  // ---- 同物异称 (5) ----
  { a: '本子', b: '剧本', why: '同物异称', fam: 'synonym', dist: 'apart' },
  { a: '我妈', b: '妈妈', why: '同一人物的两种称呼', fam: 'synonym', dist: 'apart' },
  { a: '我妈', b: '母亲', why: '口语 / 书面', fam: 'synonym', dist: 'apart' },
  { a: '公司', b: '工作室', why: '同一家机构的两种叫法', fam: 'synonym', dist: 'apart' },
  { a: '片酬', b: '分成', why: '同一笔钱的两种叫法', fam: 'synonym', dist: 'apart' },
];

/**
 * 8 pairs that look alike and are not the same thing. A negative counts as a
 * false positive when the second word lands in the first's top 3 — the position
 * a user would accept without reading.
 */
const NEGATIVES: Pair[] = [
  { a: '电话', b: '电视', why: '共享首字，不同物', fam: 'synonym', dist: 'apart' },
  { a: '台词', b: '台灯', why: '共享首字，不同物', fam: 'synonym', dist: 'apart' },
  { a: '剧组', b: '剧本', why: '共享首字：一个是人，一个是纸', fam: 'synonym', dist: 'apart' },
  { a: '上课', b: '上车', why: '共享首字，不同动作', fam: 'synonym', dist: 'apart' },
  { a: '合同', b: '合影', why: '共享首字，不同物', fam: 'synonym', dist: 'apart' },
  { a: 'sydney', b: 'sandy', why: '拼写相近的两个人', fam: 'spelling', dist: 'apart' },
  { a: '玛丽', b: '玛雅', why: '同一音译首字的两个人', fam: 'cross', dist: 'apart' },
  { a: '办公室', b: '公司', why: '共享一个字，一个是房间一个是机构', fam: 'synonym', dist: 'apart' },
];

/**
 * Ordinary words that fill the candidate pool so a top-3 means something. None of
 * them is a pair word: a negative that also got distractor messages would share
 * the whole neighbour ring with its partner, and the false-positive rate would be
 * measuring this generator instead of the ranking.
 */
const DISTRACTORS = [
  '副导演', '演员', '导演', '监视器', '化妆间', '灯架', '收工', '开机', '统筹', '场记',
  '晚上', '下午', '第二天', '牛皮纸信封', '存折', '复印件', '补充条款', '三十万', '比例', '账户',
  '孩子', '男孩', '家长', '客厅', '窗外', '抽屉', '钥匙', '雨伞', '车站', '医院',
  '通知', '名单', '签字', '发票', '排期', '预算', '会议', '走廊', '电梯', '保安',
];

/** Neighbour words, three per pair, so neighbour similarity has something to see. */
const NEIGHBORS = ['片场', '试镜', '合同', '剧组', '排练厅', '化妆间', '监视器', '走廊', '楼下', '门口', '饭桌', '书房'];

/**
 * Five sentences that put a name in five distinct syntactic positions, which is
 * what `detectEntities` needs before it calls a string a person. Same helper as
 * tools/eval/coref.ts; duplicated rather than shared so neither harness can
 * quietly change the other's corpus.
 */
function intro(name: string): string[] {
  return [
    `${name}说道："这个方案我看过了。"`,
    `${name}点了点头，没有再说话。`,
    `${name}的声音压得很低。`,
    `林岚和${name}说了几句就走了。`,
    `${name}，你先坐下。`,
  ];
}

/** Sentences that let `detectCoref` see the four full-name / short-form groups. */
const COREF_MSGS = [
  ...intro('沈砚秋'),
  '沈砚秋走进来，屋里很安静。', '沈砚秋接过杯子，沈砚秋没有喝。',
  '砚秋，你过来一下。沈砚秋抬起头。', '他叫了一声砚秋，沈砚秋应了。',
  ...intro('周敬亭'),
  '周敬亭把本子合上。', '敬亭，先别急。周敬亭没有回头。',
  '他喊了一声敬亭，周敬亭停下来。', '周敬亭又看了一遍。',
  ...intro('郑晓龙'),
  '郑晓龙把镜头调过来。', '郑晓龙又看了一遍监视器。', '郑晓龙让大家先休息。',
  ...intro('陆时衍'),
  '陆总把合同推过来，陆时衍的字签得很快。', '陆总先开口，会议就算开始了。',
  '陆总看了看表，站起身。', '楼下等的是陆总。',
];

/**
 * Generates the corpus. Every pair word gets its own messages built from three
 * neighbours; a `share` pair also gets messages holding both forms, an `apart`
 * pair never does. Negatives get *different* neighbours from each other, which
 * is what neighbour similarity is supposed to notice.
 */
function buildCorpus(): { texts: string[]; words: AliasWord[]; coref: CorefGroup[] } {
  const texts: string[] = [...COREF_MSGS];
  const say = (w: string, ns: string[], i: number) => {
    const n = ns[i % ns.length];
    switch (i % 4) {
      case 0: return `${n}那边的事定下来了，${w}的部分先放一放。`;
      case 1: return `我们在${n}等了很久，后来才说到${w}。`;
      case 2: return `${w}这件事，${n}里没有人再提。`;
      default: return `${n}散了以后，我又想起${w}。`;
    }
  };
  const all = [...PAIRS, ...NEGATIVES];
  all.forEach((p, idx) => {
    // Each pair gets its own neighbour window; negatives get the two halves of
    // theirs, so the two words genuinely keep different company.
    const base = (idx * 3) % NEIGHBORS.length;
    const ring = [NEIGHBORS[base], NEIGHBORS[(base + 1) % NEIGHBORS.length], NEIGHBORS[(base + 2) % NEIGHBORS.length]];
    const isNeg = idx >= PAIRS.length;
    const ringB = isNeg
      ? [NEIGHBORS[(base + 5) % NEIGHBORS.length], NEIGHBORS[(base + 6) % NEIGHBORS.length], NEIGHBORS[(base + 7) % NEIGHBORS.length]]
      : ring;
    for (let i = 0; i < 6; i++) texts.push(say(p.a, ring, i));
    for (let i = 0; i < 6; i++) texts.push(say(p.b, ringB, i + 1));
    if (!isNeg && p.dist === 'share') {
      texts.push(`${p.a}也就是${p.b}，两边说的是一回事。`);
      texts.push(`名单上写的是${p.a}，我们平时叫${p.b}。`);
    }
    if (p.extra) texts.push(...p.extra);
  });
  for (const d of DISTRACTORS) {
    for (let i = 0; i < 3; i++) texts.push(say(d, NEIGHBORS, i + 2));
  }

  // The pool: every word the pairs and the distractors name, counted by scan.
  const vocab = [...new Set([...all.flatMap((p) => [p.a, p.b]), ...DISTRACTORS, ...NEIGHBORS])];
  const joined = texts.join('\n');
  const countOf = (w: string) => {
    let n = 0, i = 0;
    const hay = joined.toLowerCase(), needle = w.toLowerCase();
    while ((i = hay.indexOf(needle, i)) >= 0) { n++; i += needle.length; }
    return n;
  };
  const index = detectEntities(texts);
  const words: AliasWord[] = vocab
    .map((text) => ({ text, count: countOf(text), kind: classifyKinds(text, index)[0]?.kind }))
    .filter((w) => w.count > 0)
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
  const coref = detectCoref(texts, index.personNames, index);
  return { texts, words, coref };
}

interface Row { label: string; top1: number; top3: number; fp: number; n: number; nNeg: number }

function run(
  words: AliasWord[],
  cooccur: ReturnType<typeof buildCooccur> | null,
  coref: CorefGroup[],
  signals: Partial<AliasSignals>,
  label: string,
  verbose = false,
): Row {
  const find = (t: string) => words.find((w) => w.text.toLowerCase() === t.toLowerCase());
  let top1 = 0, top3 = 0, n = 0, fp = 0, nNeg = 0;
  const misses: string[] = [];
  const fps: string[] = [];
  for (const p of PAIRS) {
    const target = find(p.a);
    if (!target || !find(p.b)) continue;
    n++;
    const ranked = rankAliasCandidates(target, words, { cooccur, coref, signals });
    const at = ranked.findIndex((w) => w.text.toLowerCase() === p.b.toLowerCase());
    if (at === 0) top1++;
    if (at >= 0 && at < 3) top3++;
    else misses.push(`${p.a}→${p.b}(${at < 0 ? '未进前 8' : `第 ${at + 1}`})`);
  }
  for (const p of NEGATIVES) {
    const target = find(p.a);
    if (!target || !find(p.b)) continue;
    nNeg++;
    const ranked = rankAliasCandidates(target, words, { cooccur, coref, signals });
    const at = ranked.findIndex((w) => w.text.toLowerCase() === p.b.toLowerCase());
    if (at >= 0 && at < 3) {
      fp++;
      const kb = find(p.b)?.kind ?? '—';
      fps.push(`${p.a}[${target.kind ?? '—'}]→${p.b}[${kb}](第 ${at + 1})`);
    }
  }
  if (verbose) {
    if (misses.length) console.log(`  未进前三：${misses.join(' ')}`);
    if (fps.length) console.log(`  负例误入前三：${fps.join(' ')}`);
  }
  return { label, top1, top3, fp, n, nNeg };
}

function table(rows: Row[]): void {
  const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) : '—') + '%';
  const w = Math.max(...rows.map((r) => [...r.label].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0)));
  const pad = (s: string) => {
    const len = [...s].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0);
    return s + ' '.repeat(Math.max(0, w - len));
  };
  console.log(`\n${pad('信号')}  top-1     top-3     误报率`);
  for (const r of rows) {
    console.log(`${pad(r.label)}  ${pct(r.top1, r.n).padEnd(8)}  ${pct(r.top3, r.n).padEnd(8)}  ${pct(r.fp, r.nNeg)}`);
  }
}

// ---------------------------------------------------------------- synthetic run
const { texts, words, coref } = buildCorpus();
const cooccur = buildCooccur(texts, words, { topN: 200 });

console.log(`候选池 ${words.length} 个词，${texts.length} 条合成消息；同指组 ${coref.length} 个：`
  + coref.map((g) => `${g.full}=${g.aliases.join('/')}`).join(' ') || '（无）');

const full = run(words, cooccur, coref, {}, '全部信号', true);
console.log(`\n可评测 ${full.n}/${PAIRS.length} 对正例，${full.nNeg}/${NEGATIVES.length} 对负例`);

const rows: Row[] = [full];
if (process.argv.includes('--ablate')) {
  for (const k of Object.keys(ALL_ALIAS_SIGNALS) as (keyof AliasSignals)[]) {
    rows.push(run(words, cooccur, coref, { [k]: false }, `−${k}`));
  }
  // Coreference and containment cover the same four full-name pairs, so neither
  // moves the rate on its own; dropping both is what shows the size of the overlap.
  rows.push(run(words, cooccur, coref, { coref: false, affix: false }, '−coref −affix'));
  rows.push(run(words, null, [], { coref: false, neighbor: false, cooccur: false }, '只留字形/音译'));
}
table(rows);

const pass = full.n > 0 && full.top3 / full.n >= 0.6;
console.log(`\n${pass ? '达标' : '未达标'}：top-3 ${full.top3}/${full.n} 对，门槛 60%`);

// ------------------------------------------------------------- local corpus run
// A reality check only: the local export can rank very few of these pairs (most
// never both reach a word list), so it reports and never decides.
function chatFolders(): { name: string; dir: string }[] {
  const out: { name: string; dir: string }[] = [];
  for (const root of localCorpusRoots()) {
    const base = path.join(root, 'default-user/chats');
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) if (e.isDirectory()) out.push({ name: e.name, dir: path.join(base, e.name) });
    const backups = path.join(root, 'default-user/backups');
    if (fs.existsSync(backups)) out.push({ name: 'backups', dir: backups });
  }
  return out;
}

const folders = chatFolders();
if (!folders.length) {
  console.log('\n本机语料：未配置 WC_LOCAL_CORPUS，跳过对照。');
} else {
  let n = 0, top3 = 0, skipped = 0;
  const seen: string[] = [];
  const scopes = folders.map((f) => {
    let names: string[] = [];
    try { names = fs.readdirSync(f.dir).filter((x) => x.endsWith('.jsonl')); } catch { return null; }
    if (!names.length) return null;
    const files = names.map((x) => ({ name: x, content: fs.readFileSync(path.join(f.dir, x), 'utf8') }));
    return analyze(files, { ...DEFAULT_ANALYZE_OPTIONS, roles: ['user', 'assistant'] });
  }).filter((s): s is NonNullable<typeof s> => s !== null && s.words.length > 0);
  for (const p of PAIRS) {
    const scope = scopes.find((s) => {
      const keys = new Set(s.words.map((w) => w.text.toLowerCase()));
      return keys.has(p.a.toLowerCase()) && keys.has(p.b.toLowerCase());
    });
    if (!scope) { skipped++; continue; }
    n++;
    const target = scope.words.find((w) => w.text.toLowerCase() === p.a.toLowerCase())!;
    const ranked = rankAliasCandidates(target, scope.words, { cooccur: scope.cooccur, coref: scope.coref });
    const at = ranked.findIndex((w) => w.text.toLowerCase() === p.b.toLowerCase());
    if (at >= 0 && at < 3) top3++; else seen.push(`${p.a}→${p.b}(${at < 0 ? '未进前 8' : `第 ${at + 1}`})`);
  }
  console.log(`\n本机语料对照：可评测 ${n}/${PAIRS.length} 对（${skipped} 对因为两个词没同时进词表而跳过）`);
  if (n) console.log(`  top-3 命中 ${top3}/${n}`);
  if (seen.length) console.log(`  未进前三：${seen.join(' ')}`);
}

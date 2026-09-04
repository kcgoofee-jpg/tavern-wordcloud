/**
 * Threshold sweeps. Every number in the tables below is measured, not estimated; the
 * constants in `src/core/analyze.ts` and `src/core/tokenize.ts` cite the run that set them.
 *
 *   npm run eval:sweep                 # all three
 *   npm run eval:sweep generic         # GENERIC_DP × GENERIC_PER_MESSAGE
 *   npm run eval:sweep cohesion        # DISCOVER_COHESION
 *   npm run eval:sweep english         # ENGLISH_SINGLE_MIN
 *
 * Corpora: the local SillyTavern export (WC_LOCAL_CORPUS; nothing is copied out, only counts
 * are printed) plus `fixtures/*.jsonl`. Without the local export the generic and cohesion
 * sweeps have nothing to measure and say so instead of printing a table of zeros.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyze,
  DEFAULT_ANALYZE_OPTIONS,
  DEFAULT_GENERIC_TUNING,
  type AnalyzeOptions,
} from '../../src/core/analyze';
import { detectEntities } from '../../src/core/entities';
import { detectEnglishNames, ENGLISH_SINGLE_MIN } from '../../src/core/english';
import { DISCOVER_COHESION, segmentToChunks, tokenizeCorpus } from '../../src/core/tokenize';
import type { WordCount } from '../../src/core/types';
import { localCorpusRoots } from '../localCorpus';
import { JUNK } from './junk';
import { GROUND_TRUTH } from './groundtruth';
import { buildEvalSet, corpusSentences, score } from './run';

const which = process.argv[2] ?? 'all';
const JUNK_SET = new Set(JUNK);
const TOP = 60;

/* ---------- Corpora ---------- */

/** Large local logs — the same selection `test/junk.test.ts` uses. */
function realLogs(): { name: string; content: string }[] {
  const out: { name: string; content: string }[] = [];
  for (const r of localCorpusRoots()) {
    const dir = path.join(r, 'default-user/chats');
    if (!fs.existsSync(dir)) continue;
    for (const card of fs.readdirSync(dir)) {
      const cd = path.join(dir, card);
      if (!fs.statSync(cd).isDirectory()) continue;
      for (const f of fs.readdirSync(cd)) {
        const p = path.join(cd, f);
        if (f.endsWith('.jsonl') && fs.statSync(p).size > 200_000) {
          out.push({ name: f, content: fs.readFileSync(p, 'utf8') });
        }
      }
    }
  }
  return out.slice(0, 6);
}

function fixtureMessages(file: string): string[] {
  const p = fileURLToPath(new URL(`../../fixtures/${file}`, import.meta.url));
  const out: string[] = [];
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line) as { mes?: unknown };
      if (typeof o.mes === 'string') out.push(o.mes);
    } catch { /* metadata line */ }
  }
  return out;
}

/* ---------- The 108-item proper-noun eval, in process ---------- */

const evalItems = buildEvalSet(108);
const evalCorpus = corpusSentences();
const evalEntities = evalCorpus.length ? detectEntities(evalCorpus) : null;

/** Same maximal matching as `tools/eval/cli.ts`, variant B (entities + discovery). */
function evalHits(cohesion: number): number {
  return evalScore(cohesion).hits;
}

/** Hits plus over-merging: lowering cohesion buys recall, and over-merging is what it costs. */
function evalScore(cohesion: number): { hits: number; overMerged: number } {
  if (!evalEntities) return { hits: -1, overMerged: -1 };
  const discovered = tokenizeCorpus(evalCorpus, { discoverFreedom: false, discoverCohesion: cohesion }).discovered;
  const lex = new Set([...evalEntities.personNames, ...discovered]);
  let hits = 0, overMerged = 0;
  for (const it of evalItems) {
    const out: string[] = [];
    for (const chunk of segmentToChunks(it.sentence)) {
      let i = 0;
      while (i < chunk.length) {
        let merged: string | null = null; let end = i + 1;
        for (let j = Math.min(chunk.length, i + 4); j > i + 1; j--) {
          const s = chunk.slice(i, j).join('');
          if (lex.has(s)) { merged = s; end = j; break; }
        }
        out.push(merged ?? chunk[i]); i = end;
      }
    }
    const s = score(out, it);
    if (s.hit) hits++;
    overMerged += s.overMerged;
  }
  return { hits, overMerged };
}

/* ---------- Sweep 1: generic thresholds ---------- */

const DP_GRID = [0.30, 0.33, 0.35, 0.38, 0.40, 0.45];
const PER_MSG_GRID = [1.5, 1.8, 2.0, 2.3, 2.5];

interface GenericRow {
  dp: number; perMsg: number;
  generic: number;      // words tagged generic, summed over the logs
  filtered: number;     // of the TOP 60, how many the tag removes
  junkTop60: number;    // junk-list words left in the TOP 60 once generic is off
  junk40: number;       // the eval:junk metric (TOP 40, every kind on)
  hurt: string[];       // ground-truth proper nouns swallowed by the tag
  words: string[];      // everything the tag caught, so the extra catches can be read
}

function sweepGeneric(logs: { name: string; content: string }[]): void {
  console.log(`\n# T2 generic 阈值扫描（${logs.length} 份本机大日志，指标为各日志求和）\n`);
  const base: AnalyzeOptions = { ...DEFAULT_ANALYZE_OPTIONS, roles: ['user', 'char'] };
  const truth = new Set(GROUND_TRUTH.map((g) => g.word));
  const hits108 = evalHits(DISCOVER_COHESION);
  const rows: GenericRow[] = [];

  for (const dp of DP_GRID) {
    for (const perMsg of PER_MSG_GRID) {
      const row: GenericRow = { dp, perMsg, generic: 0, filtered: 0, junkTop60: 0, junk40: 0, hurt: [], words: [] };
      for (const f of logs) {
        const r = analyze([f], { ...base, genericTuning: { ...DEFAULT_GENERIC_TUNING, dp, perMessage: perMsg } });
        const isGeneric = (w: WordCount & { kind?: string }) => w.kind === 'generic';
        row.generic += r.allWords.filter(isGeneric).length;
        const top = r.words.slice(0, TOP);
        row.filtered += top.filter(isGeneric).length;
        row.junkTop60 += top.filter((w) => !isGeneric(w) && JUNK_SET.has(w.text)).length;
        row.junk40 += r.words.slice(0, 40).filter((w) => JUNK_SET.has(w.text)).length;
        for (const w of r.allWords) {
          if (!isGeneric(w)) continue;
          if (!row.words.includes(w.text)) row.words.push(w.text);
          if (truth.has(w.text) && !row.hurt.includes(w.text)) row.hurt.push(w.text);
        }
      }
      rows.push(row);
    }
  }

  console.log('  DP  每条  generic词数  TOP60滤掉  TOP60垃圾  junk(TOP40)  eval  误伤专名');
  for (const r of rows) {
    console.log(
      `  ${r.dp.toFixed(2)}  ${r.perMsg.toFixed(1)}  ${String(r.generic).padStart(9)}  ` +
      `${String(r.filtered).padStart(8)}  ${String(r.junkTop60).padStart(8)}  ` +
      `${String(r.junk40).padStart(10)}  ${String(hits108).padStart(4)}  ${r.hurt.join(' ') || '-'}`,
    );
  }
  console.log('\n  eval 命中在整张网格上恒为', hits108, '——generic 是分词之后打的标，改不了切分。');
  console.log('\n  每条 = 2.0 一列上，标成 generic 的词（只在终端打印，不写进仓库）：');
  let prev: string[] = [];
  for (const dp of DP_GRID) {
    const r = rows.find((x) => x.dp === dp && x.perMsg === 2.0)!;
    const added = r.words.filter((w) => !prev.includes(w));
    console.log(`    DP ${dp.toFixed(2)}  共 ${r.words.length}  新增: ${added.join(' ') || '-'}`);
    prev = r.words;
  }
  console.log('\n  DP = 0.45 一行上，每条阈值各自catch 的词：');
  let prevPm: string[] = [];
  for (const perMsg of PER_MSG_GRID) {
    const r = rows.find((x) => x.dp === 0.45 && x.perMsg === perMsg)!;
    console.log(`    每条 ${perMsg.toFixed(1)}  共 ${r.words.length}  新增: ${r.words.filter((w) => !prevPm.includes(w)).join(' ') || '-'}`);
    prevPm = r.words;
  }
  // Beyond the grid: where does the tag start eating story words? This is what sets the
  // safety margin, and it is measured rather than quoted from an older calibration note.
  console.log('\n  网格之外（只为看余量，不作为候选）：');
  for (const dp of [0.50, 0.55, 0.60]) {
    const words: string[] = [];
    for (const f of logs) {
      const r = analyze([f], { ...base, genericTuning: { ...DEFAULT_GENERIC_TUNING, dp, perMessage: 2.0 } });
      for (const w of r.allWords) if (w.kind === 'generic' && !words.includes(w.text)) words.push(w.text);
    }
    console.log(`    DP ${dp.toFixed(2)}  共 ${words.length}  新增: ${words.filter((w) => !prev.includes(w)).join(' ') || '-'}`);
    prev = words;
  }
}

/* ---------- Sweep 2: cohesion ---------- */

function sweepCohesion(logs: { name: string; content: string }[]): void {
  console.log('\n# T4 凝固度阈值扫描\n');
  const base: AnalyzeOptions = { ...DEFAULT_ANALYZE_OPTIONS, roles: ['user', 'char'] };
  let prevTop: string | null = null;
  console.log('  凝固度  新词数  eval  过度合并  junk(TOP40)  TOP60垃圾  TOP60 与上一档的差异');
  for (let c = 0.30; c <= 0.4001; c += 0.02) {
    const cohesion = Math.round(c * 100) / 100;
    let discovered = 0, junk40 = 0, junkTop60 = 0;
    const tops: string[] = [];
    for (const f of logs) {
      const r = analyze([f], {
        ...base,
        tokenize: { ...base.tokenize, discoverCohesion: cohesion },
      });
      discovered += r.discovered.length;
      junk40 += r.words.slice(0, 40).filter((w) => JUNK_SET.has(w.text)).length;
      const top = r.words.slice(0, TOP);
      junkTop60 += top.filter((w) => JUNK_SET.has(w.text)).length;
      tops.push(top.map((w) => w.text).join(','));
    }
    const key = tops.join('|');
    const diff = prevTop === null ? '（基准）' : prevTop === key ? '无变化' : topDiff(prevTop, key);
    const s = evalScore(cohesion);
    console.log(
      `  ${cohesion.toFixed(2)}  ${String(discovered).padStart(6)}  ${String(s.hits).padStart(4)}  ` +
      `${String(s.overMerged).padStart(8)}  ${String(junk40).padStart(10)}  ${String(junkTop60).padStart(8)}  ${diff}`,
    );
    prevTop = key;
  }
}

function topDiff(a: string, b: string): string {
  const sa = new Set(a.split(/[,|]/)), sb = new Set(b.split(/[,|]/));
  const gone = [...sa].filter((w) => !sb.has(w));
  const came = [...sb].filter((w) => !sa.has(w));
  return `−${gone.join(' ')}  +${came.join(' ')}`;
}

/* ---------- Sweep 3: English single-word names ---------- */

/**
 * Ground truth on `fixtures/ceo-en.jsonl`: people and places the log actually talks about,
 * and words the capitalization rule has produced that are not names.
 */
const EN_POSITIVE = [
  'Adrian', 'Nora', 'Eleanor', 'Dominic', 'Marcus', 'Priya', 'Elena', 'Cole',
  'Vance', 'Kestrel', 'Whitlock', 'Aurelian', 'Ravensmoor', 'Halcyon', 'Delgado',
];
const EN_NEGATIVE = ['Analysis', 'Saturday', 'Monday', 'Sunday', 'Level', 'Sat', 'Holdings', 'Group'];

function sweepEnglish(): void {
  console.log('\n# T3 英文单词名 SINGLE_MIN 扫描（fixtures/ceo-en.jsonl）\n');
  const texts = fixtureMessages('ceo-en.jsonl');
  if (!texts.length) { console.log('  fixtures/ceo-en.jsonl 不在，跳过'); return; }
  console.log(`  正例 ${EN_POSITIVE.length}  负例 ${EN_NEGATIVE.length}  语料 ${texts.length} 条`);
  console.log('\n  SINGLE_MIN  漏报  误报  漏掉的名字 / 误收的词');
  for (const min of [3, 4, 5]) {
    const got = new Set(detectEnglishNames(texts, min));
    const fn = EN_POSITIVE.filter((w) => !got.has(w));
    const fp = EN_NEGATIVE.filter((w) => got.has(w));
    console.log(
      `  ${String(min).padStart(10)}  ${String(fn.length).padStart(4)}  ${String(fp.length).padStart(4)}  ` +
      `漏: ${fn.join(' ') || '-'}   误: ${fp.join(' ') || '-'}`,
    );
  }
  console.log(`\n  现用 ENGLISH_SINGLE_MIN = ${ENGLISH_SINGLE_MIN}`);

  // Possessive and all-caps folding, on a synthetic text where both spellings occur.
  const shout = [
    'Nicole walked in. The room was cold and Nicole\'s coat was wet.',
    'Later Nicole\'s brother arrived. NICOLE shouted at him.',
    'Maya said hello to Nicole. Nicole\'s phone rang twice.',
    'NICOLE and Maya left. Nicole\'s keys were gone.',
    'It was Nicole who found them. Maya thanked Nicole.',
  ];
  const tok = tokenizeCorpus(shout, { dictionary: detectEnglishNames(shout) });
  console.log('  所有格/全大写归并：', tok.allWords.filter((w) => /nicole|maya/.test(w.text)));
}

/* ---------- Run ---------- */

const logs = realLogs();
if (which === 'all' || which === 'generic') {
  if (logs.length) sweepGeneric(logs);
  else console.log('\n# T2 generic 阈值扫描：本机语料（WC_LOCAL_CORPUS）没找到，跳过');
}
if (which === 'all' || which === 'cohesion') {
  if (logs.length) sweepCohesion(logs);
  else console.log('\n# T4 凝固度阈值扫描：本机语料（WC_LOCAL_CORPUS）没找到，跳过');
}
if (which === 'all' || which === 'english') sweepEnglish();

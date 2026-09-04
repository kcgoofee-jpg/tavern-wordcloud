/**
 * Minimal reproduction for the two known segmentation boundary errors (TODO A18).
 *
 *   npx vite-node tools/eval/boundary.ts
 *
 * 1. `见沈砚秋` — the entity layer's `subject` pattern is greedy to the left, so a
 *    single-character verb in front of a name (见/找/问/…) is captured as part of
 *    the name candidate. The candidate then wins maximal matching and the verb
 *    disappears into the person token.
 * 2. `通告单是A4纸` — new-word discovery scores `单是` as a word (it is frequent and
 *    cohesive inside the corpus), so `通告单` is split as `通告|单是`.
 *
 * Both are checked against the live local corpus, and both are also checked on a
 * synthetic corpus so the file still says something when the local SillyTavern
 * data directory is missing. Exit code is non-zero while either is unfixed.
 */
import { detectEntities } from '../../src/core/entities';
import { segmentToChunks, tokenizeCorpus } from '../../src/core/tokenize';
import { corpusSentences } from './run';

/** Same maximal-matching harness `tools/eval/cli.ts` scores with. */
function tokenize(sentence: string, lex: Set<string>): string[] {
  const out: string[] = [];
  for (const chunk of segmentToChunks(sentence)) {
    let i = 0;
    while (i < chunk.length) {
      let merged: string | null = null;
      let end = i + 1;
      for (let j = Math.min(chunk.length, i + 4); j > i + 1; j--) {
        const s = chunk.slice(i, j).join('');
        if (lex.has(s)) { merged = s; end = j; break; }
      }
      out.push(merged ?? chunk[i]);
      i = end;
    }
  }
  return out;
}

/** Verbs that must never be swallowed into the following person name. */
const VERB_HEADS = ['见', '看', '找', '问', '叫', '喊', '等', '送', '接', '陪', '跟', '带', '劝', '骂', '夸', '推', '拉', '抱'];

let bad = 0;
const check = (label: string, ok: boolean, detail: string) => {
  if (!ok) bad++;
  console.log(`${ok ? '✅' : '❌'} ${label}  ${detail}`);
};

/* ---------- 1. person-name left boundary ---------- */
const corpus = corpusSentences();
console.log(`语料句子 ${corpus.length}`);

const ents = detectEntities(corpus);
const personSet = new Set(ents.personNames);
const glued = ents.personNames.filter(
  (n) => n.length >= 3 && VERB_HEADS.includes(n[0]) && personSet.has(n.slice(1)),
);
check(
  '人名左边界不含单字动词',
  glued.length === 0,
  glued.length ? `实体层产出了 ${glued.join(' / ')}` : '（实体层没有动词开头的人名候选）',
);

// The specific case from the TODO, on a synthetic corpus so it reproduces without
// the local logs: 沈砚秋 is a name, 见沈砚秋 is a verb plus a name.
const NAME = '沈砚秋';
const synth: string[] = [];
for (let i = 0; i < 6; i++) {
  synth.push(`${NAME}说道，“今天先到这里。”`);
  synth.push(`${NAME}点了点头，转身走向门口。`);
  synth.push(`${NAME}的声音很轻，几乎听不见。`);
  synth.push(`他昨天见${NAME}的时候还好好的。`);
  synth.push(`我去见${NAME}，顺便把本子还了。`);
  synth.push(`剧组的人都想见${NAME}一面。`);
}
const synthEnts = detectEntities(synth);
const synthNames = new Set(synthEnts.personNames);
check(
  `合成语料：${NAME} 被识别为人名`,
  synthNames.has(NAME),
  `候选=${synthEnts.personNames.filter((n) => n.includes('沈') || n.includes('见')).join(' / ') || '（空）'}`,
);
check(
  `合成语料：见${NAME} 不被识别为人名`,
  !synthNames.has(`见${NAME}`),
  `见${NAME} ${synthNames.has(`见${NAME}`) ? '在' : '不在'} personNames 里`,
);
const synthTokens = tokenize(`我去见${NAME}，顺便把本子还了。`, synthNames);
check(
  `合成语料：切分保留「见」`,
  synthTokens.includes(NAME) && !synthTokens.some((t) => t === `见${NAME}`),
  synthTokens.join('|'),
);

/* ---------- 2. 通告单是A4纸 ---------- */
// Intl.Segmenter returns 单是 as one word-like segment, so the atom straddles the
// 通告单 | 是 boundary and no lexicon entry can match across it.
const SENT = '通告单是A4纸，每天一张，印着场次、场景、演员、时间。';
const atoms = segmentToChunks(SENT).flat();
check(
  '分词原子里没有跨界的 单是',
  !atoms.includes('单是'),
  atoms.join('|'),
);
// 通告单 is discovered from the rest of the corpus, where the atoms are 通告 | 单.
const discovered = new Set(tokenizeCorpus(corpus, { discoverFreedom: false }).discovered);
check(
  '新词发现产出 通告单',
  discovered.has('通告单'),
  discovered.has('通告单') ? '（在 discovered 里）' : '通告单 不在 discovered 里',
);
const toks2 = tokenize(SENT, new Set([...discovered, ...ents.personNames]));
check(
  '通告单是A4纸 切出完整的 通告单',
  toks2.includes('通告单') && !toks2.includes('单是'),
  toks2.join('|'),
);

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项未通过`);
process.exit(bad === 0 ? 0 : 1);

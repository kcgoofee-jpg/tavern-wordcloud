/**
 * Compare local tokenizer variants on the same sentences.
 *
 *   npx vite-node tools/eval/cli.ts            # 108 items
 *   npx vite-node tools/eval/cli.ts 60
 *
 * Variants differ only in the dictionary source; maximal matching is identical:
 *   A entity layer only
 *   B entity layer + discovery (cohesion, no function words)
 *   C entity layer + discovery + branching entropy
 * Reports McNemar tests of B and C against A.
 */
import { buildEvalSet, corpusSentences, report, score, type RunResult } from './run';
import { detectEntities } from '../../src/core/entities';
import { segmentToChunks, tokenizeCorpus } from '../../src/core/tokenize';

const n = Number(process.argv[2]) || 108;
const corpus = corpusSentences();
const items = buildEvalSet(n);
console.log(`语料句子 ${corpus.length}，评测 ${items.length} 题`);

function withLexicon(name: string, lex: Set<string>): RunResult {
  const t0 = Date.now();
  const tokens = items.map((it) => {
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
    return out;
  });
  const scores = items.map((it, i) => score(tokens[i], it));
  return {
    name, tokens, scores,
    hits: scores.filter((s) => s.hit).length,
    broken: scores.filter((s) => s.broken).length,
    overMerged: scores.reduce((a, s) => a + s.overMerged, 0),
    ms: Date.now() - t0,
  };
}

const ents = detectEntities(corpus);
const A = withLexicon('A 实体层', new Set(ents.personNames));
const oldDisc = tokenizeCorpus(corpus, { discoverFreedom: false }).discovered;
const newDisc = tokenizeCorpus(corpus, { discoverFreedom: true }).discovered;
const B = withLexicon('B 实体层+新词发现(凝固度)', new Set([...ents.personNames, ...oldDisc]));
const C = withLexicon('C 实体层+新词发现(凝固度+分支熵)', new Set([...ents.personNames, ...newDisc]));
console.log(`新词数：旧 ${oldDisc.length}  新 ${newDisc.length}`);
report([A, B, C], items.length);


// Items B hits and C misses
const lost = items.map((it, i) => ({ it, b: B.scores[i].hit, c: C.scores[i].hit }))
  .filter((x) => x.b && !x.c);
if (lost.length) {
  console.log(`\nC 比 B 少命中 ${lost.length} 题，目标词：` + [...new Set(lost.map((x) => x.it.target))].join(' / '));
  const oldSet = new Set(oldDisc), newSet = new Set(newDisc);
  for (const w of new Set(lost.map((x) => x.it.target))) console.log(`  ${w}: 旧发现=${oldSet.has(w)} 新发现=${newSet.has(w)}`);
}

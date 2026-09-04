/**
 * Junk-rate guard: filler words (demonstrative + classifier, degree adverbs, relative
 * position) must not reach the TOP 40. Deterministic part on the stop list and a synthetic
 * corpus; the real-corpus part runs only where the local SillyTavern data exists.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze, DEFAULT_ANALYZE_OPTIONS } from '../src/core/analyze';
import { buildStopwords } from '../src/core/stopwords';
import { JUNK, NOT_JUNK, junkRate } from '../tools/eval/junk';
import { localCorpusRoots } from '../tools/localCorpus';

const stop = buildStopwords([], true, true);

describe('junk list vs stop list', () => {
  it('every junk word is a stop word', () => {
    expect(JUNK.filter((w) => !stop.has(w))).toEqual([]);
  });
  it('content words that share a character with classifiers are not stop words', () => {
    expect(NOT_JUNK.filter((w) => stop.has(w))).toEqual([]);
  });
});

/** Build a chat file from message texts. */
const chatOf = (texts: string[]) => [
  JSON.stringify({ user_name: 'u', character_name: 'c' }),
  ...texts.map((t, i) => JSON.stringify({ name: i % 2 ? 'c' : 'u', is_user: i % 2 === 0, mes: t })),
].join('\n');

describe('generic words', () => {
  it('a word spread evenly over the messages is tagged generic; a clustered word stays plain', () => {
    // 20 messages; 咖啡 once in every message in varying contexts (filler; varied so phrase discovery
    // does not glue it to its neighbours); 冰箱 five times in each of three messages (story word).
    const cups = ['喝了口咖啡', '咖啡已经凉了', '顺手买了杯咖啡', '闻到咖啡的味道'];
    const tails = ['然后出门去了。', '雨还在下。', '手机响了两声。', '街上很安静。'];
    const texts = Array.from({ length: 20 }, (_, i) =>
      `第${i}天早上，${cups[i % 4]}，${i % 7 === 0 ? '冰箱坏了，冰箱里的牛奶全酸了，冰箱门关不上，冰箱嗡嗡响，冰箱要换。' : tails[i % 4]}`);
    // Every kind is on by default now; turn generic off to check the button hides it from the cloud
    const r = analyze([{ name: 'a.jsonl', content: chatOf(texts) }], { ...DEFAULT_ANALYZE_OPTIONS, roles: ['user', 'char'], kinds: ['plain', 'person', 'place', 'time'] });
    // A word can carry a construction tag as well as `generic` since the 60-kind
    // design (docs/33): 咖啡 is a 饮品 *and* filler here, 冰箱 is a 容器 and a story word.
    const kinds = (w: string) => r.allWords.find((x) => x.text === w)?.kinds?.map((k) => k.kind) ?? [];
    expect(kinds('咖啡')).toContain('generic');
    expect(kinds('冰箱')).not.toContain('generic');
    // Generic words leave the cloud when their kind is off but stay in the full table
    expect(r.words.some((w) => w.text === '咖啡')).toBe(false);
    expect(r.entities.byKind.find((k) => k.kind === 'generic')?.words).toBeGreaterThan(0);
  });

  it('short chats are not judged', () => {
    const texts = Array.from({ length: 5 }, () => '早上喝了口咖啡，然后出门去了。');
    const r = analyze([{ name: 'a.jsonl', content: chatOf(texts) }], { ...DEFAULT_ANALYZE_OPTIONS, roles: ['user', 'char'] });
    expect(r.allWords.every((w) => w.kind !== 'generic')).toBe(true);
  });
});

const FIXTURE = path.join(process.cwd(), 'fixtures', 'ceo-zh.jsonl');
describe.skipIf(!fs.existsSync(FIXTURE))('junk rate on the fixture corpus', () => {
  it('TOP 40 contains no junk word', () => {
    const r = analyze([{ name: 'ceo-zh.jsonl', content: fs.readFileSync(FIXTURE, 'utf8') }], { ...DEFAULT_ANALYZE_OPTIONS, roles: ['user', 'char'] });
    const { rate, hits } = junkRate(r.words);
    expect(hits).toEqual([]);
    expect(rate).toBe(0);
  });
});

/** Real logs, when the local SillyTavern data directory exists (same roots as test/corpus.test.ts). */
const ROOTS = localCorpusRoots();
const real: string[] = [];
for (const r of ROOTS) {
  const dir = path.join(r, 'default-user/chats');
  if (!fs.existsSync(dir)) continue;
  for (const card of fs.readdirSync(dir)) {
    const cd = path.join(dir, card);
    if (!fs.statSync(cd).isDirectory()) continue;
    for (const f of fs.readdirSync(cd)) if (f.endsWith('.jsonl') && fs.statSync(path.join(cd, f)).size > 200_000) real.push(path.join(cd, f));
  }
}
describe.skipIf(real.length === 0)('junk rate on real logs', () => {
  it('at most 2 of the TOP 40 are junk, on every large local log', () => {
    for (const f of real.slice(0, 6)) {
      const r = analyze([{ name: path.basename(f), content: fs.readFileSync(f, 'utf8') }], { ...DEFAULT_ANALYZE_OPTIONS, roles: ['user', 'char'] });
      const { hits } = junkRate(r.words);
      console.log(`${path.basename(f).slice(0, 24)}  junk ${hits.length}/40 ${hits.join(' ')}  generic=${r.entities.byKind.find((k) => k.kind === 'generic')?.words}`);
      expect(hits.length).toBeLessThanOrEqual(2);
    }
  }, 120_000);
});

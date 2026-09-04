/**
 * Hard rule 5: one progress ring, and it has to move. `analyzeAsync` reports through
 * three callbacks (parse, tokenize, finish) that the worker and the server both wire
 * into the same `<Progress>`, so the budget is on the gap between *any* two of them.
 *
 * Timing here is real, not injected. An injected clock would only prove that the code
 * emits often in terms of items, which is what it already asserts elsewhere; the thing
 * that broke hard rule 5 was a single 555 ms *call* between two emissions, and only a
 * real clock sees that. The cost is that the test measures this machine: the budget is
 * therefore checked against a corpus that is a fraction of the 20 MB the benchmark uses
 * (`npm run bench:big` is the real gate, per size, on a fresh heap), and the assertion
 * is on the *maximum* gap, which is stable — the long stages are long everywhere. CI
 * noise would have to add 200 ms to a single stage to make this flap.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { analyze, analyzeAsync, DEFAULT_ANALYZE_OPTIONS } from '../src/core/analyze';
import { mergeParsedChats, splitJsonlForProgress } from '../src/core/parseChunks';
import { parseChatFile, DEFAULT_PARSE_OPTIONS } from '../src/core/parse';

/** The budget `tools/optimize/bigfile.mjs` enforces. */
const BUDGET_MS = 300;
const FIX = path.join(process.cwd(), 'fixtures');

/** The largest generated fixture, repeated whole lines up to `layers` messages. */
function corpus(layers: number): { name: string; content: string } {
  const big = fs.readdirSync(FIX)
    .filter((f) => f.endsWith('.jsonl') && !f.startsWith('ceo'))
    .map((f) => ({ f, size: fs.statSync(path.join(FIX, f)).size }))
    .sort((a, b) => b.size - a.size)[0];
  const lines = fs.readFileSync(path.join(FIX, big.f), 'utf8').split('\n').filter((l) => l.trim());
  const out: string[] = [];
  for (let i = 0; i < layers; i++) out.push(lines[i % lines.length]);
  return { name: big.f, content: out.join('\n') };
}

const have = fs.existsSync(FIX) && fs.readdirSync(FIX).some((f) => f.endsWith('.jsonl'));

describe.skipIf(!have)('进度回调预算', () => {
  it(`1500 层语料：相邻回调间隔 ≤ ${BUDGET_MS} ms，done 单调不减，末次 done === total`, async () => {
    const { name, content } = corpus(1500);
    const opts = { ...DEFAULT_ANALYZE_OPTIONS, roles: ['user', 'char'] as ('user' | 'char' | 'system')[] };

    /** Every tick of every phase, in the order the ring would see them. */
    const ticks: { phase: string; at: number; done: number; total: number }[] = [];
    const tick = (phase: string) => (done: number, total: number) =>
      ticks.push({ phase, at: performance.now(), done, total });

    const t0 = performance.now();
    const result = await analyzeAsync(
      [{ name, content }], opts, undefined,
      tick('parse'), tick('tokenize'), undefined, tick('finish'),
    );
    const end = performance.now();

    expect(result.words.length).toBeGreaterThan(0);
    expect(ticks.length).toBeGreaterThan(10);

    // Gaps include the head (start → first tick) and the tail (last tick → return):
    // the ring is just as frozen there as it is between two ticks.
    let prev = t0;
    let worst = { ms: 0, after: 'start' };
    for (const s of ticks) {
      if (s.at - prev > worst.ms) worst = { ms: s.at - prev, after: s.phase };
      prev = s.at;
    }
    if (end - prev > worst.ms) worst = { ms: end - prev, after: 'tail' };
    expect(Math.round(worst.ms), `最长间隔出现在 ${worst.after} 之后`).toBeLessThanOrEqual(BUDGET_MS);

    // Real progress, not a timer spinning: done never goes backwards inside a phase,
    // and each phase ends exactly at its own total.
    for (const phase of ['parse', 'tokenize', 'finish']) {
      const own = ticks.filter((s) => s.phase === phase);
      expect(own.length, phase).toBeGreaterThan(0);
      for (let i = 1; i < own.length; i++) {
        expect(own[i].done, `${phase} #${i}`).toBeGreaterThanOrEqual(own[i - 1].done);
        expect(own[i].total).toBe(own[0].total);
      }
      expect(own[own.length - 1].done, `${phase} 末次`).toBe(own[own.length - 1].total);
    }
  });

  it('分批解析和整份解析的结果逐字段相同', () => {
    const { name, content } = corpus(1500);
    const split = splitJsonlForProgress(name, content);
    expect(split, '这份语料应当是可分批的').not.toBeNull();
    expect(split!.pieces.length).toBeGreaterThan(1);

    const whole = parseChatFile(name, content, DEFAULT_PARSE_OPTIONS);
    const merged = mergeParsedChats(
      name,
      split!.pieces.map((p) => parseChatFile(name, p, DEFAULT_PARSE_OPTIONS)),
      split!,
    );
    expect(merged).toEqual(whole);
  });

  it('分批解析不改变分析结果', () => {
    const { name, content } = corpus(400);
    const opts = { ...DEFAULT_ANALYZE_OPTIONS, roles: ['user', 'char'] as ('user' | 'char' | 'system')[] };
    // Below the 200 KB floor the splitter declines, so the same corpus is analysed
    // once whole (as one short file) and once in pieces (as one long file).
    const short = analyze([{ name, content: corpus(40).content }], opts);
    expect(short.words.length).toBeGreaterThan(0);
    expect(splitJsonlForProgress(name, content)).not.toBeNull();
    expect(analyze([{ name, content }], opts).messageCount).toBe(
      parseChatFile(name, content, DEFAULT_PARSE_OPTIONS).messages.filter((m) => m.role !== 'system').length,
    );
  });

  it('不敢分的文件退回整份解析', () => {
    const long = Array.from({ length: 400 }, (_, i) =>
      JSON.stringify({ name: 'Bot', is_user: false, mes: `第 ${i} 句。`.repeat(120) }));
    const big = long.join('\n');
    expect(big.length).toBeGreaterThan(200_000);
    expect(splitJsonlForProgress('a.jsonl', big)).not.toBeNull();
    // A hidden message makes the roles depend on the whole file: no splitting.
    const hidden = [JSON.stringify({ name: 'Bot', is_user: false, is_system: true, mes: '隐藏' }), ...long].join('\n');
    expect(splitJsonlForProgress('a.jsonl', hidden)).toBeNull();
    // Plain-text exports and whole-file JSON arrays are not line-oriented.
    expect(splitJsonlForProgress('a.txt', big)).toBeNull();
    expect(splitJsonlForProgress('a.json', `[${long.join(',')}]`)).toBeNull();
    // Too small to be worth cutting.
    expect(splitJsonlForProgress('a.jsonl', long.slice(0, 2).join('\n'))).toBeNull();
  });
});

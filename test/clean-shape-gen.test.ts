/**
 * Bounded seeded expansion of the finite shape catalog through the shipped
 * entry points. The generator is not the cleaner.
 */
import { describe, expect, it } from 'vitest';
import { analyze, DEFAULT_ANALYZE_OPTIONS } from '../src/core/analyze';
import { cleanMessageText, DEFAULT_CLEAN_OPTIONS } from '../src/core/clean';
import { parseChatFile } from '../src/core/parse';
import { generateBatch, generateShape, INSTANTIABLE_IDS } from './shapeGen';

const analyzeOpts = {
  ...DEFAULT_ANALYZE_OPTIONS,
  roles: ['user', 'char'] as ('user' | 'char')[],
  tokenize: { ...DEFAULT_ANALYZE_OPTIONS.tokenize, minCount: 1, minLength: 2 },
};

function assertSample(sample: ReturnType<typeof generateShape>): void {
  if (sample.format === 'mes') {
    const out = cleanMessageText(sample.text, {
      ...DEFAULT_CLEAN_OPTIONS,
      customRules: sample.rules,
    }, { placement: 2 });
    for (const k of sample.keep) expect(out, sample.id).toContain(k);
    for (const l of sample.leak) expect(out, sample.id).not.toContain(l);
    return;
  }
  const chat = parseChatFile('卡.jsonl', sample.text);
  const cleaned = chat.messages.map((m) => (sample.source === 'reasoning' ? (m.reasoning ?? '') : m.text)).join('\n');
  for (const k of sample.keep) expect(cleaned, sample.id).toContain(k);
  for (const l of sample.leak) expect(cleaned, sample.id).not.toContain(l);
  const r = analyze(
    [{ name: '测试卡 - 2026-08-31@20h00m08s527ms.jsonl', content: sample.text }],
    { ...analyzeOpts, source: sample.source ?? 'mes' },
  );
  const bag = r.words.map((w) => w.text).join(' ');
  for (const l of sample.leak) expect(bag, `${sample.id} cloud`).not.toContain(l);
}

describe('seeded generator over finite shapes', () => {
  it('each instantiable class, seed 1', () => {
    for (const id of INSTANTIABLE_IDS) assertSample(generateShape(id, 1));
  });

  it('20 seeds × all instantiable classes through shipped parse/clean/analyze', () => {
    const batch = generateBatch(100, 20);
    expect(batch.length).toBe(INSTANTIABLE_IDS.length * 20);
    for (const sample of batch) assertSample(sample);
  });
});

/** User-reported noise words with their context snippets; each must be cleaned away. */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { analyze, DEFAULT_ANALYZE_OPTIONS } from '../src/core/analyze';

const FILE = path.join(process.cwd(), 'test', 'feedback-samples.json');
const samples: { word: string; snippets: string[]; kind: string }[] = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : [];

describe.skipIf(samples.length === 0)('用户反馈的清洗漏网', () => {
  it.each(samples.map((s, i) => [i, s.word, s] as const))('#%i 「%s」清洗后不再出现', (_i, word, s) => {
    const content = s.snippets.map((t) => JSON.stringify({ name: 'x', is_user: true, mes: t })).join('\n');
    const r = analyze([{ name: 'fb.jsonl', content }], { ...DEFAULT_ANALYZE_OPTIONS, roles: ['user', 'char'], tokenize: { ...DEFAULT_ANALYZE_OPTIONS.tokenize, minCount: 1 } });
    expect(r.allWords.map((w) => w.text)).not.toContain(word);
  });
});

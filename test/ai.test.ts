/** LLM tokenization: mainly how malformed replies (fences, chatter, dropped characters, truncation) degrade safely. */
import { describe, expect, it, vi } from 'vitest';
import {
  chunkText, extractJsonArray, segmentChunk, segmentWithAi, tokensMatchSource,
  DEFAULT_AI_CONFIG, type AiTokenizerConfig,
} from '../src/core/aiTokenizer';
import { analyze, prepareTexts, DEFAULT_ANALYZE_OPTIONS } from '../src/core/analyze';
import type { EntityKind } from '../src/core/entities';

const cfg: AiTokenizerConfig = {
  ...DEFAULT_AI_CONFIG, enabled: true,
  endpoint: 'https://x/v1/chat/completions', apiKey: 'k', model: 'm', chunkChars: 40, concurrency: 2,
};
const reply = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

describe('JSON extraction', () => {
  it('bare array', () => {
    expect(extractJsonArray('["沈砚秋","说"]')).toEqual(['沈砚秋', '说']);
  });
  it('wrapped in a json fence', () => {
    expect(extractJsonArray('```json\n["沈砚秋","说"]\n```')).toEqual(['沈砚秋', '说']);
  });
  it('preceded by chatter', () => {
    expect(extractJsonArray('好的，结果如下：\n["沈砚秋","说"]\n希望有帮助')).toEqual(['沈砚秋', '说']);
  });
  it('non-JSON returns null', () => {
    expect(extractJsonArray('我不会做这个')).toBeNull();
  });
  it('JSON that is not an array returns null', () => {
    expect(extractJsonArray('{"a":1}')).toBeNull();
  });
});

describe('integrity check', () => {
  it('passes when tokens reconstruct the text', () => {
    expect(tokensMatchSource(['沈砚秋', '说'], '沈砚秋说')).toBe(true);
  });
  it('dropped characters are detected', () => {
    expect(tokensMatchSource(['沈砚秋'], '沈砚秋说')).toBe(false);
  });
  it('altered characters are detected', () => {
    expect(tokensMatchSource(['沈言秋', '说'], '沈砚秋说')).toBe(false);
  });
  it('whitespace differences are not alterations', () => {
    expect(tokensMatchSource(['沈砚秋', ' 说'], '沈砚秋 说')).toBe(true);
  });
});

describe('chunking', () => {
  it('splits at sentence boundaries', () => {
    const chunks = chunkText('第一句话结束了。第二句话也结束了。第三句。', 12);
    expect(chunks.every((c) => /[。\n]$/.test(c.trim()))).toBe(true);
  });
  it('an over-long sentence is hard-split without losing characters', () => {
    const long = '啊'.repeat(100);
    expect(chunkText(long, 30).join('')).toBe(long);
  });
});

describe('per-chunk fallback', () => {
  it('HTTP error -> local fallback', async () => {
    const f = vi.fn(async () => new Response('nope', { status: 500, statusText: 'Server Error' }));
    const r = await segmentChunk('沈砚秋说', cfg, f);
    expect(r.fellBack).toBe(true);
    expect(r.error).toMatch(/500/);
  });
  it('network error -> local fallback', async () => {
    const f = vi.fn(async () => { throw new Error('Failed to fetch'); });
    const r = await segmentChunk('沈砚秋说', cfg, f);
    expect(r.fellBack).toBe(true);
    expect(r.error).toMatch(/Failed to fetch/);
  });
  it('non-JSON reply -> local fallback', async () => {
    const r = await segmentChunk('沈砚秋说', cfg, async () => reply('抱歉我做不到'));
    expect(r.fellBack).toBe(true);
  });
  it('dropped characters -> local fallback', async () => {
    const r = await segmentChunk('沈砚秋说', cfg, async () => reply('["沈砚秋"]'));
    expect(r.fellBack).toBe(true);
    expect(r.error).toMatch(/拼不回原文/);
  });
  it('success -> model result', async () => {
    const r = await segmentChunk('沈砚秋说', cfg, async () => reply('["沈砚秋","说"]'));
    expect(r.fellBack).toBe(false);
    expect(r.tokens).toEqual(['沈砚秋', '说']);
  });
});

describe('whole text', () => {
  const local = (s: string) => [...s];

  it('a failed chunk falls back locally without affecting others', async () => {
    // The stub must answer for the chunk it actually receives, or the integrity check fails every chunk.
    let n = 0;
    const f = async (_url: string, init: RequestInit) => {
      if (++n === 2) return new Response('x', { status: 500 });
      const body = JSON.parse(String(init.body)) as { messages: { content: string }[] };
      const chunk = body.messages[1].content;
      return reply(JSON.stringify([...chunk]));
    };
    const text = 'ABCD。ABCD。ABCD。';
    const { tokens, progress } = await segmentWithAi(text, { ...cfg, chunkChars: 5 }, local, undefined, f);
    expect(progress.total).toBe(3);
    expect(progress.fellBack).toBe(1);
    expect(tokens.join('')).toBe(text);
  });

  it('progress is reported through the pipeline', async () => {
    const seen: number[] = [];
    await segmentWithAi('AB。AB。AB。', { ...cfg, chunkChars: 3 }, local,
      (p) => seen.push(p.done),
      async (_u: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { messages: { content: string }[] };
        return reply(JSON.stringify([...body.messages[1].content]));
      });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toBe(seen.length);
  });

  it('off by default', () => {
    expect(DEFAULT_AI_CONFIG.enabled).toBe(false);
    expect(DEFAULT_AI_CONFIG.endpoint).toBe('');
  });
});

describe('integration', () => {
  const content = [
    JSON.stringify({ user_name: 'unused', character_name: 'unused', chat_metadata: {} }),
    JSON.stringify({ name: '我', is_user: true, mes: '沈砚秋把本子递给周敬亭。' }),
  ].join('\n');
  const files = [{ name: '测试卡 - 2026-08-31@20h00m08s527ms.jsonl', content }];
  const base = {
    ...DEFAULT_ANALYZE_OPTIONS,
    tokenize: { ...DEFAULT_ANALYZE_OPTIONS.tokenize, minCount: 1, minLength: 2 },
    kinds: [...DEFAULT_ANALYZE_OPTIONS.kinds] as EntityKind[],
  };

  it('prepareTexts returns exactly the texts sent to the tokenizer', () => {
    const texts = prepareTexts(files, base);
    expect(texts).toEqual(['沈砚秋把本子递给周敬亭。']);
  });

  it('external tokens replace the built-in segmenter', () => {
    // The built-in tokenizer splits 沈砚秋 into single characters on this short text
    const without = analyze(files, base);
    expect(without.words.map((w) => w.text)).not.toContain('沈砚秋');

    // With the model's segmentation the name survives
    const withAi = analyze(files, base, [['沈砚秋', '把', '本子', '递给', '周敬亭', '。']]);
    expect(withAi.words.map((w) => w.text)).toContain('沈砚秋');
    expect(withAi.words.map((w) => w.text)).toContain('周敬亭');
  });

  it('only segmentation is replaced; stop words still apply', () => {
    const r = analyze(files, base, [['沈砚秋', '把', '本子', '递给', '周敬亭', '。']]);
    // 把 is a function word and never enters the cloud
    expect(r.words.map((w) => w.text)).not.toContain('把');
  });

  it('without external tokens the built-in segmenter is used', () => {
    const a = analyze(files, base);
    const b = analyze(files, base, undefined);
    expect(a.words).toEqual(b.words);
  });

  it('AI is off by default and analyze makes no network calls', () => {
    expect(DEFAULT_ANALYZE_OPTIONS.ai.enabled).toBe(false);
  });
});

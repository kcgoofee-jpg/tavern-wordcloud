/** Keyword curation, as distinct from tokenization. */
import { describe, expect, it } from 'vitest';
import { curateWords } from '../src/core/curate';
import { DEFAULT_AI_CONFIG, type AiTokenizerConfig } from '../src/core/aiTokenizer';

const cfg: AiTokenizerConfig = {
  ...DEFAULT_AI_CONFIG, enabled: true,
  endpoint: 'https://x/v1/chat/completions', apiKey: 'k', model: 'm',
};
const TEXT = '沈砚秋把补充条款递过去。第7条写着否决权。举牌线到了 4.87%。他说：稳住。';
const reply = (content: string, tokens = 100) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: tokens } }), { status: 200 });

describe('curation', () => {
  it('parses the word list and the rationale', async () => {
    const r = await curateWords(TEXT, 4, cfg, undefined,
      async () => reply('补充条款\n否决权\n举牌线\n稳住\n---\n挑的是构成情节转折的锚点词，没选通用词。'));
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.result.words).toEqual(['补充条款', '否决权', '举牌线', '稳住']);
    expect(r.result.rationale).toMatch(/锚点词/);
    expect(r.result.promptTokens).toBe(100);
  });

  it('paraphrased words absent from the text are dropped', async () => {
    // The cloud shows the chat's own words, not the model's paraphrase
    const r = await curateWords(TEXT, 4, cfg, undefined,
      async () => reply('补充条款\n资本运作\n否决权\n商业博弈\n---\n标准说明'));
    if ('error' in r) throw new Error('不该失败');
    expect(r.result.words).toEqual(['补充条款', '否决权']);
    expect(r.result.rationale).toMatch(/剔除了 2 个原文里查无此项的转述/);
  });

  it('strips numbering and extra punctuation', async () => {
    const r = await curateWords(TEXT, 2, cfg, undefined,
      async () => reply('1. 补充条款\n2) 否决权\n---\nx'));
    if ('error' in r) throw new Error('不该失败');
    expect(r.result.words).toEqual(['补充条款', '否决权']);
  });

  it('sizes use local counts', async () => {
    const counts = new Map([['补充条款', 42], ['否决权', 7]]);
    const r = await curateWords(TEXT, 2, cfg, counts,
      async () => reply('补充条款\n否决权\n---\nx'));
    if ('error' in r) throw new Error('不该失败');
    expect(r.words).toEqual([{ text: '补充条款', count: 42 }, { text: '否决权', count: 7 }]);
  });

  it('uncounted words get ordered weights below any real count', async () => {
    const counts = new Map([['补充条款', 100]]);
    const r = await curateWords(TEXT, 2, cfg, counts,
      async () => reply('补充条款\n否决权\n---\nx'));
    if ('error' in r) throw new Error('不该失败');
    const fake = r.words.find((w) => w.text === '否决权')!;
    expect(fake.count).toBeLessThan(100);
    expect(fake.count).toBeGreaterThan(0);
  });

  it('HTTP errors return a readable reason', async () => {
    const r = await curateWords(TEXT, 4, cfg, undefined,
      async () => new Response('x', { status: 401, statusText: 'Unauthorized' }));
    expect('error' in r && r.error).toMatch(/401/);
  });

  it('network errors do not throw', async () => {
    const r = await curateWords(TEXT, 4, cfg, undefined,
      async () => { throw new Error('Failed to fetch'); });
    expect('error' in r && r.error).toMatch(/Failed to fetch/);
  });

  /** Over-long items and paraphrases are counted separately. */
  it('over-long items and paraphrases are counted separately', async () => {
    const text = '否决权。他说了一句台词：我不走，我在这儿等我妈，然后就不说话了。';
    const r = await curateWords(text, 10, cfg, undefined,
      async () => reply('否决权\n我不走，我在这儿等我妈\n资本运作\n---\n说明'));
    if ('error' in r) throw new Error('不该失败');
    expect(r.result.words).toEqual(['否决权']);                      // Only the compliant item remains
    expect(r.result.rationale).toMatch(/1 个原文里查无此项的转述/);   // 资本运作
    expect(r.result.rationale).toMatch(/1 个超过 10 字排不进词云的/); // the quoted line
  });
});

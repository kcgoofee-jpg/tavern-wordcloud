/** Kind labelling: word list only (no chat text), batching, and strict parsing. */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_AI_CONFIG } from '../src/core/aiTokenizer';
import { labelKinds, LABEL_BATCH, LABEL_MAX_WORDS } from '../src/core/labelKinds';

const cfg = { ...DEFAULT_AI_CONFIG, endpoint: 'https://x.test/v1', model: 'm', apiKey: 'k' };

/** A fetch stub that answers every batch with `reply(words)`, keeping the request bodies. */
const stub = (reply: (words: string[]) => unknown) => {
  const bodies: string[] = [];
  const doFetch = vi.fn(async (_url: string, init: RequestInit) => {
    const body = String(init.body);
    bodies.push(body);
    const sent = JSON.parse(body) as { messages: { content: string }[] };
    const words = JSON.parse(sent.messages[1].content) as string[];
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(reply(words)) } }],
      usage: { prompt_tokens: 10 },
    }), { status: 200 });
  });
  return { doFetch, bodies };
};

const allPerson = (words: string[]) => Object.fromEntries(words.map((w) => [w, '人物']));

describe('labelKinds', () => {
  it('batches at 200 words and caps the run at 500', async () => {
    const words = Array.from({ length: 700 }, (_, i) => `词${i}`);
    const { doFetch } = stub(allPerson);
    const res = await labelKinds(words, cfg, doFetch);
    expect('kinds' in res).toBe(true);
    if (!('kinds' in res)) return;
    expect(doFetch).toHaveBeenCalledTimes(Math.ceil(LABEL_MAX_WORDS / LABEL_BATCH));
    expect(res.usage.words).toBe(LABEL_MAX_WORDS);
    expect(res.usage.batches).toBe(3);
    expect(res.usage.promptTokens).toBe(30);
    expect(Object.keys(res.kinds)).toHaveLength(LABEL_MAX_WORDS);
  });

  it('sends only the word list, never the chat text', async () => {
    const secret = '沈砚秋把通告单递给制片主任，然后关上了门。';
    const { doFetch, bodies } = stub(allPerson);
    await labelKinds(['沈砚秋', '通告单'], cfg, doFetch);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toContain(secret);
    const sent = JSON.parse(bodies[0]) as { messages: { role: string; content: string }[] };
    expect(JSON.parse(sent.messages[1].content)).toEqual(['沈砚秋', '通告单']);
  });

  it('drops labels outside the eight kinds', async () => {
    const { doFetch } = stub(() => ({ 沈砚秋: '人物', 通告单: '道具', 后厨: 'place' }));
    const res = await labelKinds(['沈砚秋', '通告单', '后厨'], cfg, doFetch);
    expect('kinds' in res && res.kinds).toEqual({ 沈砚秋: 'person' });
  });

  it('drops keys that were not in the word list', async () => {
    const { doFetch } = stub(() => ({ 沈砚秋: '人物', 凭空冒出来的词: '时间' }));
    const res = await labelKinds(['沈砚秋'], cfg, doFetch);
    expect('kinds' in res && res.kinds).toEqual({ 沈砚秋: 'person' });
  });

  it('reports HTTP failures through httpError', async () => {
    const doFetch = vi.fn(async () => new Response(
      JSON.stringify({ error: { code: 'security_audit_fail', message: '含有违规信息' } }),
      { status: 400 },
    ));
    const res = await labelKinds(['沈砚秋'], cfg, doFetch);
    expect('error' in res).toBe(true);
    if (!('error' in res)) return;
    expect(res.error).toContain('HTTP 400');
    expect(res.error).toContain('security_audit_fail');
  });
});

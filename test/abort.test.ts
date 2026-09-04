/** Stop must abort in-flight requests and prevent new ones; checked with a fake fetch that records aborts. */
import { describe, expect, it } from 'vitest';
import { segmentWithAi, DEFAULT_AI_CONFIG } from '../src/core/aiTokenizer';
import { curateWords } from '../src/core/curate';

const cfg = {
  ...DEFAULT_AI_CONFIG, enabled: true,
  endpoint: 'https://x/v1/chat/completions', apiKey: 'k', model: 'm',
  chunkChars: 40, concurrency: 2,
};

/** Slow fetch that honours the signal and counts calls and aborts */
function slowFetch(ms = 200) {
  const stat = { sent: 0, aborted: 0 };
  const fn = (_u: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    stat.sent++;
    const signal = init?.signal;
    const timer = setTimeout(() => resolve(new Response(JSON.stringify({
      choices: [{ message: { content: '["一","二"]' } }],
    }), { status: 200 })), ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      stat.aborted++;
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
  return { fn: fn as unknown as typeof fetch, stat };
}

describe('stop: LLM tokenization', () => {
  it('stop aborts in-flight requests and sends no more', async () => {
    const text = '一二三四五六七八九十'.repeat(40);   // 40 chars per chunk -> 10 chunks
    const { fn, stat } = slowFetch(150);
    const ac = new AbortController();

    const run = segmentWithAi(text, cfg, (s) => [...s], undefined, fn, ac.signal);
    await new Promise((r) => setTimeout(r, 60));   // Let the first two chunks go out
    const sentBefore = stat.sent;
    ac.abort();
    await run;

    expect(sentBefore).toBeGreaterThan(0);          // Started
    expect(stat.aborted).toBeGreaterThan(0);        // In-flight requests aborted; no new ones after stop (± concurrency already on the wire)
    expect(stat.sent).toBeLessThanOrEqual(sentBefore + cfg.concurrency);
  });

  it('a result is still returned after abort', async () => {
    const text = '一二三四五六七八九十'.repeat(40);
    const { fn } = slowFetch(120);
    const ac = new AbortController();
    const run = segmentWithAi(text, cfg, (s) => [...s], undefined, fn, ac.signal);
    await new Promise((r) => setTimeout(r, 200));
    ac.abort();
    const { tokens } = await run;
    expect(tokens.length).toBeGreaterThan(0);
  });
});

describe('stop: keyword curation', () => {
  it('a single long request can be stopped', async () => {
    const { fn, stat } = slowFetch(500);
    const ac = new AbortController();
    const run = curateWords('沈砚秋把通告单递给制片主任。', 10, cfg, undefined, fn, ac.signal);
    await new Promise((r) => setTimeout(r, 60));
    ac.abort();
    const r = await run;

    expect(stat.aborted).toBe(1);
    expect('error' in r).toBe(true);   // No fake success after abort
  });

  it('returns normally without stop', async () => {
    const { fn } = slowFetch(10);
    const r = await curateWords('沈砚秋把通告单递给制片主任。', 10, cfg, undefined, fn);
    expect('error' in r).toBe(false);
  });
});

describe('streaming', () => {
  /** Split an SSE stream into arbitrary chunks, as the network does */
  function sseFetch(chunks: string[]) {
    return (() => Promise.resolve(new Response(new ReadableStream({
      start(c) {
        const enc = new TextEncoder();
        for (const s of chunks) c.enqueue(enc.encode(s));
        c.close();
      },
    }), { status: 200 }))) as unknown as typeof fetch;
  }
  const sse = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
  const delta = (t: string) => sse({ choices: [{ delta: { content: t } }] });

  it('reports while streaming and assembles the full content', async () => {
    const seen: string[] = [];
    const r = await curateWords('否决权。补充条款。', 5, cfg, undefined,
      sseFetch([delta('否决权\n'), delta('补充条款\n'), delta('---\n说明'), 'data: [DONE]\n\n']),
      undefined, (s) => seen.push(s));
    if ('error' in r) throw new Error(r.error);
    expect(seen.length).toBeGreaterThan(1);            // Reported in several steps
    expect(seen[seen.length - 1]).toContain('补充条款'); // Cumulative, not per chunk
    expect(r.result.words).toEqual(['否决权', '补充条款']);
  });

  it('a partial JSON chunk must not break parsing', async () => {
    const whole = delta('否决权\n');
    const cut = Math.floor(whole.length / 2);
    const r = await curateWords('否决权。', 5, cfg, undefined,
      sseFetch([whole.slice(0, cut), whole.slice(cut), 'data: [DONE]\n\n']),
      undefined, () => {});
    if ('error' in r) throw new Error(r.error);
    expect(r.result.words).toEqual(['否决权']);
  });

  it('no streaming without onDelta', async () => {
    let body: string | undefined;
    const fn = ((_u: string, init?: RequestInit) => {
      body = init?.body as string;
      return Promise.resolve(new Response(JSON.stringify({
        choices: [{ message: { content: '否决权\n---\n说明' } }],
      }), { status: 200 }));
    }) as unknown as typeof fetch;
    await curateWords('否决权。', 5, cfg, undefined, fn);
    expect(JSON.parse(body!).stream).toBe(false);
  });
});

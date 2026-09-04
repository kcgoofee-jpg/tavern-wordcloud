import { chatEndpoint, httpError } from './aiTokenizer';
import type { WordCount } from './types';
import type { AiTokenizerConfig } from './aiTokenizer';
import { zh } from './zh';

/**
 * Keyword curation: the model reads the whole chat once and picks the words
 * specific to this story. One request, no frequencies; font sizes come from local counts.
 */

export interface CurateResult {
  words: string[];
  /** The model's stated selection criteria, shown to the user. */
  rationale: string;
  /** Input tokens used. */
  promptTokens?: number;
  ms: number;
}

/**
 * Prompt constraints:
 *   1. copy verbatim: models paraphrase, and paraphrased strings do not exist in the text
 *   2. ask for 40% more than needed, since verification removes some
 *   3. hard length cap: sentences do not fit in a word cloud
 */
const PROMPT = (n: number) => `你要为用户的酒馆（SillyTavern）聊天记录做**词云**展示。
请读完整段对话，挑出最值得展示的关键词。

**硬性要求（不满足的条目会被直接丢掉，等于白挑）：**

1. **逐字复制原文。** 每一条都必须是原文里**一模一样**出现过的字符串，
   连标点和用词都不能改。不要转述、不要概括、不要合并同义说法。
   反例：原文写「公司七我三」，你写成「合同七三开」——意思对，但这条会被丢掉。
2. **每条 1~10 个字。** 这是词云的物理限制，长句排不下。
   要表达一个长句的意思，就从里面截取最有力的那个短语。
3. 挑**这个故事独有的**：专名、行业术语、关键数字、反复出现的意象、
   构成转折的词。避开哪本小说都有的通用词（公司 手机 窗外 办公室 房间 时候）。
4. 允许单字，前提是这个字本身在故事里被反复赋予了含义。

**输出格式：**
先输出 ${Math.ceil(n * 1.4)} 行，一行一个词，只有词——不要序号、不要加粗、不要解释。
然后一行 \`---\`。
然后用 200 字以内说明：你按什么标准挑的、你**故意没选**哪一类词、为什么。`;

/**
 * @param text   cleaned text of the whole chat
 * @param counts local frequencies, used to size the curated words
 */
export async function curateWords(
  text: string,
  n: number,
  cfg: AiTokenizerConfig,
  counts?: Map<string, number>,
  doFetch: typeof fetch = fetch,
  /** Abort signal; curation can take minutes. */
  signal?: AbortSignal,
  /** Streaming progress so the UI can show the model is producing output. */
  onDelta?: (textSoFar: string, thinking?: string) => void,
): Promise<{ result: CurateResult; words: WordCount[] } | { error: string }> {
  const t0 = Date.now();
  try {
    const res = await doFetch(chatEndpoint(cfg.endpoint), {
      signal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.3,
        // Stream only when progress is requested.
        stream: !!onDelta,
        messages: [{ role: 'system', content: PROMPT(n) }, { role: 'user', content: text }],
      }),
    });
    if (!res.ok) return { error: await httpError(res) };

    let content: string | undefined;
    let promptTokens: number | undefined;

    if (onDelta && res.body) {
      /** SSE stream: `data: {...}` lines, terminated by `data: [DONE]`. Only complete lines are parsed. */
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let acc = '';
      /**
 * Reasoning models stream their thinking in `delta.reasoning_content` and the
 * answer in `delta.content`. Both are consumed. `content` can be '' or null
 * during reasoning, so emptiness is tested with `!= null`.
 */
      let think = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const payload = t.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const d = JSON.parse(payload) as {
              choices?: { delta?: { content?: string | null; reasoning_content?: string | null } }[];
              usage?: { prompt_tokens?: number };
            };
            const delta = d.choices?.[0]?.delta;
            const reason = delta?.reasoning_content;
            if (reason != null && reason !== '') { think += reason; onDelta(acc, think); }
            const piece = delta?.content;
            if (piece != null) { acc += piece; onDelta(acc, think); }
            if (d.usage?.prompt_tokens) promptTokens = d.usage.prompt_tokens;
          } catch { /* partial JSON; completed on the next chunk */ }
        }
      }
      content = acc;
    } else {
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number };
      };
      content = data.choices?.[0]?.message?.content;
      promptTokens = data.usage?.prompt_tokens;
    }

    if (typeof content !== 'string' || !content) return { error: zh('回复里没有内容') };

    const [listPart, ...rest] = content.split(/^\s*---+\s*$/m);
    const words = listPart
      .split('\n')
      .map((l) => l.replace(/^\s*[\d.、)\]]*\s*/, '').trim())
      .filter((w) => w.length > 0);

    // Two filters, counted separately: too long (format not followed) and not in the text (paraphrase).
    const tooLong = words.filter((w) => w.length > 10 || /[，。！？；]/.test(w));
    const fit = words.filter((w) => !tooLong.includes(w));
    // Keep only strings that occur verbatim in the text.
    const present = fit.filter((w) => text.includes(w)).slice(0, n);
    const paraphrased = fit.length - fit.filter((w) => text.includes(w)).length;

    const result: CurateResult = {
      words: present,
      rationale: (rest.join('---').trim() || '（模型没给说明）') +
        (paraphrased || tooLong.length
          ? `\n\n（剔除了 ${paraphrased} 个原文里查无此项的转述` +
            `${tooLong.length ? `、${tooLong.length} 个超过 10 字排不进词云的` : ''}）`
          : ''),
      promptTokens,
      ms: Date.now() - t0,
    };

    // Sizes use local counts; the model does not report frequencies.
    const max = counts ? Math.max(...[...counts.values()], 1) : 1;
    const out: WordCount[] = present.map((w, i) => ({
      text: w,
      // Words without a local count get decreasing weights in model order, never exceeding a real count.
      count: counts?.get(w) ?? Math.max(1, Math.round((max * 0.3 * (present.length - i)) / present.length)),
    }));
    return { result, words: out };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

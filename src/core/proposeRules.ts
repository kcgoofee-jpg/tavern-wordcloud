import { chatEndpoint, type AiTokenizerConfig, httpError } from './aiTokenizer';
import type { CleanRule } from './regexScripts';
import { zh } from './zh';

const PROMPT = [
  '下面是几条角色扮演聊天记录的原文。里面夹着插件或预设写进正文的非剧情内容：状态栏、变量块、自定义标签、选项列表、思维链、摘要、格式标题等。',
  '请写出用于删除这些非剧情块的 JavaScript 正则表达式。要求：',
  '1. 只删非剧情内容，不能删对话和叙述；',
  '2. 每条规则是一个 JSON 对象 {"find": "正则主体", "flags": "gi", "name": "说明"}，find 里不要带斜杠；',
  '3. 优先匹配成对标签、固定标题、整块结构，不要用能匹配任意文本的模式；',
  '4. 只输出一个 JSON 数组，不要解释。',
].join('\n');

function extractArray(text: string): unknown[] | null {
  const a = text.indexOf('[');
  const b = text.lastIndexOf(']');
  if (a < 0 || b <= a) return null;
  try {
    const v = JSON.parse(text.slice(a, b + 1)) as unknown;
    return Array.isArray(v) ? v : null;
  } catch { return null; }
}

/**
 * Ask the configured model for cleaning rules tailored to these samples. Each
 * proposed rule is compiled and tested: it must remove something from at least
 * one sample and never more than 70% of any sample.
 */
export async function proposeCleanRules(
  samples: string[], cfg: AiTokenizerConfig, doFetch: typeof fetch = fetch, signal?: AbortSignal,
): Promise<CleanRule[]> {
  const body = samples.slice(0, 5).map((s, i) => `--- 样本 ${i + 1} ---\n${s.slice(0, 2500)}`).join('\n\n');
  const res = await doFetch(chatEndpoint(cfg.endpoint), {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
    body: JSON.stringify({ model: cfg.model, temperature: 0, messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: body }] }),
  });
  if (!res.ok) throw new Error(await httpError(res));
  const json = await res.json() as { choices?: { message?: { content?: string } }[] };
  const arr = extractArray(json.choices?.[0]?.message?.content ?? '');
  if (!arr) throw new Error(zh('模型没有返回规则数组'));
  const out: CleanRule[] = [];
  for (const item of arr) {
    const o = item as { find?: string; flags?: string; name?: string };
    if (!o || typeof o.find !== 'string') continue;
    let flags = (o.flags ?? 'g').replace(/[^gimsuy]/g, '');
    if (!flags.includes('g')) flags += 'g';
    let re: RegExp;
    try { re = new RegExp(o.find, flags); } catch { continue; }
    let removedSomething = false;
    let safe = true;
    for (const s of samples) {
      re.lastIndex = 0;
      const after = s.replace(re, '');
      if (after.length < s.length) removedSomething = true;
      if (after.length < s.length * 0.3) { safe = false; break; }
    }
    if (removedSomething && safe) out.push({ find: o.find, flags, replace: '', name: o.name ?? 'AI' });
  }
  return out;
}

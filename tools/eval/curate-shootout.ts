/**
 * Keyword-mode model comparison: same chat, same prompt, N models, 100 keywords
 * each. The main metric is groundedness: whether the keyword occurs verbatim in
 * the text.
 *
 * Run: npx vite-node tools/eval/curate-shootout.ts (keys from .env.local)
 */
import fs from 'node:fs';
import path from 'node:path';
import { cleanMessageText, DEFAULT_CLEAN_OPTIONS } from '../../src/core/clean';

/** The user's own prompt, unchanged. */
const PROMPT = '这是我的酒馆聊天记录，你看完觉得这里面要展示 100个提示词应该选哪些，'
  + '可以是句子或短语或词汇或单字，说明详细理由。';

const MODELS = [
  'deepseek-ai/DeepSeek-V3.2',
  'Qwen/Qwen3.5-397B-A17B',
  'zai-org/GLM-5.2',
  'Pro/moonshotai/Kimi-K2.6',
  'MiniMaxAI/MiniMax-M2.5',
  'stepfun-ai/Step-3.5-Flash',
];

const OUT = process.env.KW_OUT ?? '/tmp/kwout';
const CHAT = process.env.KW_CHAT;

function env(key: string): string {
  const f = path.join(process.cwd(), '.env.local');
  const line = fs.readFileSync(f, 'utf8').split('\n').find((l) => l.startsWith(`${key}=`));
  if (!line) throw new Error(`.env.local 里没有 ${key}`);
  return line.slice(key.length + 1).trim();
}

/** Read a jsonl, clean it and join with speaker prefixes */
function loadChat(file: string): string {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
  const out: string[] = [];
  for (let i = 1; i < lines.length; i++) {   // Line 0 is metadata
    let o: { mes?: unknown; is_user?: boolean };
    try { o = JSON.parse(lines[i]) as typeof o; } catch { continue; }
    if (typeof o.mes !== 'string') continue;
    const t = cleanMessageText(o.mes, DEFAULT_CLEAN_OPTIONS).trim();
    if (t) out.push(`${o.is_user ? '【我】' : '【角色】'}${t}`);
  }
  return out.join('\n');
}

/** Normalized comparison: whitespace and paired punctuation are ignored. */
const norm = (s: string) => s.replace(/[\s"'“”‘’「」《》（）()【】,，.。!！?？:：;；—…·、*]/g, '');

/** Extract the 100 items from a markdown reply; two rules cover the formats seen */
export function extractPicks(md: string): string[] {
  const out: string[] = [];
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    // The number may be outside (`1. **词**`) or inside (`**1. 词**`) the bold markers;
    // `^[-*]\s+` must require whitespace or it eats the first star of `**词**`
    const s = line.replace(/^[-*]\s+/, '').replace(/^\d+[.、)]\s*/, '');
    let w: string | null = null;
    const bold = /^\*\*\s*(?:\d+[.、)]\s*)?(.+?)\s*\*\*/.exec(s);
    if (bold) w = bold[1];
    else {
      const m = /^(.+?)\s*(?:——|—|–|\s-\s|[:：])\s*\S/.exec(s);
      if (m && /^\d+[.、)]/.test(line.replace(/^[-*]\s+/, ''))) w = m[1];
    }
    if (!w) continue;
    w = w.replace(/^[“”"'‘’「『]+|[“”"'‘’」』]+$/g, '').replace(/^\d+[.、)]\s*/, '').trim();
    if (w.length >= 1 && w.length <= 80 && !/^[一二三四五六七八九十]、/.test(w)) out.push(w);
  }
  return [...new Set(out)];
}

async function ask(model: string, text: string, key: string) {
  const t0 = Date.now();
  const res = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model, temperature: 0.3,
      messages: [{ role: 'user', content: `${PROMPT}\n\n${text}` }],
    }),
  });
  const sec = ((Date.now() - t0) / 1000).toFixed(0);
  if (!res.ok) return { model, sec, error: `${res.status} ${res.statusText}` };
  const d = await res.json() as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return { model, sec, content: d.choices?.[0]?.message?.content ?? '', usage: d.usage };
}

async function main() {
  if (!CHAT) throw new Error('用 KW_CHAT=<聊天文件路径> 指定要测的记录');
  const key = env('SILICONFLOW_KEY');
  const text = loadChat(CHAT);
  const TN = norm(text);
  fs.mkdirSync(OUT, { recursive: true });
  console.log(`语料 ${(text.length / 1e4).toFixed(1)} 万字，${MODELS.length} 个模型\n`);

  // Run models concurrently
  const results = await Promise.all(MODELS.map((m) => ask(m, text, key)));

  console.log('模型'.padEnd(28) + '条数   原文里有  落地率   平均长度  耗时');
  console.log('-'.repeat(76));
  for (const r of results) {
    if (!('content' in r) || !r.content) { console.log(`${r.model.padEnd(27)} ❌ ${'error' in r ? r.error : '空回复'}`); continue; }
    fs.writeFileSync(path.join(OUT, `${r.model.replace(/\//g, '_')}.txt`), r.content);
    const picks = extractPicks(r.content);
    const ok = picks.filter((w) => TN.includes(norm(w)));
    const avg = ok.reduce((a, w) => a + w.length, 0) / Math.max(1, ok.length);
    console.log(
      `${r.model.padEnd(27)} ${String(picks.length).padEnd(6)}${String(ok.length).padEnd(9)}`
      + `${`${((ok.length / Math.max(1, picks.length)) * 100).toFixed(0)}%`.padEnd(8)}`
      + `${avg.toFixed(1)} 字`.padEnd(10) + `${r.sec}s`,
    );
  }
  console.log(`\n原始回复在 ${OUT}/`);
}

void main();

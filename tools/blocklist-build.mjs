#!/usr/bin/env node
/**
 * `npm run blocklist [--tags] [files or dirs...]` -> src/core/blocklist/auto.ts
 *
 * Presets do not enter chat logs; the output templates they prescribe do. So the
 * extractor does not tokenize prompt text. It collects, from preset prompts and
 * regex scripts:
 *   - markup tags the model is told to emit (reported with --tags; the cleaner's
 *     allowlist already removes any non-HTML tag with its content)
 *   - field labels inside output templates (text within custom tag pairs, and the
 *     literal labels regex scripts match in model output) that appear in at least
 *     two files; these become auto blocklist candidates
 * plus words from user feedback samples (test/feedback-samples.json).
 *
 * The generated file records word, source category and count only; no file names.
 * Default input directory: data-clean/presets (not in git).
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const tagsOnly = args.includes('--tags');
const inputs = args.filter((a) => !a.startsWith('--'));
if (inputs.length === 0 && existsSync('data-clean/presets')) inputs.push('data-clean/presets');

/** Common words that also occur as template labels; never blocked. */
const ALLOW = new Set(`
角色 用户 故事 剧情 场景 对话 描写 内容 世界 时间 地点 人物 情节 回复 语言 格式 输出 要求 规则 设定 背景 性格
关系 动作 表情 心理 环境 细节 风格 名字 身份 目标 结果 状态 变量 系统 消息 玩家 主角 感情 情绪 氛围 示例 例子
描述 类型 注意 正确 错误 原理 写法 天气 名称 步骤 触发 条件 姓名 年龄 职业 外貌 声音 气味 视觉 听觉 嗅觉 触觉
`.trim().split(/\s+/));

const HTML = new Set('a abbr b bdi bdo big blockquote br caption center cite code col colgroup dd del details dfn div dl dt em figcaption figure font h1 h2 h3 h4 h5 h6 hr i img ins kbd label li mark ol p pre q rp rt ruby s samp section small span strike strong sub summary sup table tbody td tfoot th thead time tr tt u ul var wbr html head body style script meta link title svg path g rect circle line polyline polygon text button input form select option textarea iframe canvas video audio source'.split(' '));

const files = [];
const walk = (p) => {
  if (!existsSync(p)) return;
  if (statSync(p).isDirectory()) { for (const f of readdirSync(p)) walk(path.join(p, f)); return; }
  if (/\.json$/i.test(p)) files.push(p);
};
for (const p of inputs) walk(p);

const LABEL = /^[-*•▪◆●\s]*[「【[]?([一-鿿A-Za-z_]{1,10})[」】\]]?\s*[:：]\s*.{0,40}$/;
const HEAD = /^[【[]([一-鿿A-Za-z_ ]{1,10})[】\]]\s*$/;
const TAG = /<\\?\/?([A-Za-z_][\w:-]{1,30})\b/g;

const tags = new Map();
const labelFiles = new Map();   /* plain text */
const bumpTag = (t) => { t = t.toLowerCase(); if (!HTML.has(t)) tags.set(t, (tags.get(t) ?? 0) + 1); };

files.forEach((f, idx) => {
  let doc;
  try { doc = JSON.parse(readFileSync(f, 'utf8')); } catch { return; }
  const texts = [];
  if (Array.isArray(doc) && doc.every((x) => x && typeof x === 'object' && 'findRegex' in x)) {
    for (const r of doc) {
      const re = String(r.findRegex ?? '');
      for (const m of re.matchAll(TAG)) bumpTag(m[1]);
      // Literal labels the script expects in model output, e.g. 姓名[:：] / 时间[：:]
      for (const m of re.matchAll(/([一-鿿]{2,8})\s*(?:\[[:：]+\]|[:：])/g)) {
        const w = m[1]; if (ALLOW.has(w)) continue;
        if (!labelFiles.has(w)) labelFiles.set(w, new Set());
        labelFiles.get(w).add(idx);
      }
    }
    return;
  }
  for (const p of doc?.prompts ?? []) if (typeof p?.content === 'string') texts.push(p.content);
  for (const c of texts) {
    for (const m of c.matchAll(TAG)) bumpTag(m[1]);
    // Labels are collected only from output templates: text inside custom (non-HTML) tag pairs.
    const templates = [];
    for (const m of c.matchAll(/<([A-Za-z_][\w:-]*)\b[^>]*>([\s\S]*?)<\/\1\s*>/g)) if (!HTML.has(m[1].toLowerCase())) templates.push(m[2]);
    for (const line of templates.join('\n').split('\n')) {
      const s = line.trim();
      if (s.length > 60) continue;
      const m = LABEL.exec(s) ?? HEAD.exec(s);
      if (!m) continue;
      const w = m[1].trim();
      if (w.length < 2 || ALLOW.has(w) || !/[一-鿿]/.test(w)) continue;
      if (!labelFiles.has(w)) labelFiles.set(w, new Set());
      labelFiles.get(w).add(idx);
    }
  }
});

if (tagsOnly) {
  console.log([...tags].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join('\n'));
  process.exit(0);
}

const auto = new Map();
const bump = (word, source, n = 1) => {
  const e = auto.get(word) ?? { sources: new Set(), n: 0 };
  e.n += n; e.sources.add(source); auto.set(word, e);
};
const fb = 'test/feedback-samples.json';
if (existsSync(fb)) for (const s of JSON.parse(readFileSync(fb, 'utf8'))) bump(s.word, 'feedback');
for (const [w, set] of labelFiles) if (set.size >= 2) bump(w, 'preset', set.size);

// Applied at runtime only when the label is unlikely to be plot text: feedback words always,
// preset labels of 4+ characters seen in 2+ files. Shorter labels stay in the file for review.
const applies = (word, sources, n) => sources.has('feedback') || (word.length >= 4 && n >= 2);
const entries = [...auto].map(([word, e]) => ({ word, source: [...e.sources].sort().join('+'), n: e.n, apply: applies(word, e.sources, e.n) })).sort((a, b) => Number(b.apply) - Number(a.apply) || b.n - a.n || a.word.localeCompare(b.word));
const body = entries.map((e) => `  { word: ${JSON.stringify(e.word)}, source: ${JSON.stringify(e.source)}, n: ${e.n}, apply: ${e.apply} },`).join('\n');
writeFileSync('src/core/blocklist/auto.ts', `/**
 * Auto blocklist, generated by tools/blocklist-build.mjs. Do not edit by hand.
 * Sources: user feedback samples and output-template labels found in preset files.
 */
export interface AutoEntry { word: string; source: string; n: number; apply: boolean }
export const AUTO_BLOCKLIST: readonly AutoEntry[] = [
${body}
];
`);
console.log(`auto.ts: ${entries.length} entries, ${entries.filter((e) => e.apply).length} applied (feedback ${entries.filter((e) => e.source.includes('feedback')).length}, preset ${entries.filter((e) => e.source.includes('preset')).length}) from ${files.length} files`);

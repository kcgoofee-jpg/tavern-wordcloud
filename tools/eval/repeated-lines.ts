/**
 * Repeated-line removal audit (backlog C2).
 *
 *   npx vite-node tools/eval/repeated-lines.ts   # or: npm run eval:repeated
 *
 * `stripRepeatedLines` (src/core/clean.ts, read-only here) drops any line that recurs across
 * a large-enough share of a file's messages, on the theory that a line every turn repeats is
 * UI chrome / a status template rather than story text. This harness runs it, unread, against
 * the local SillyTavern export and reports every line it removed, classified by shape:
 * lines that look like a tag, a symbol/rule line, a key-value pair, or a numeric table are
 * expected template noise; anything else is a suspected wrongly-deleted narrative line.
 *
 * Never prints real corpus content — only shapes (length, character-class ratios) — because
 * this repo is mirrored publicly and the corpus is private chat logs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseChatFile } from '../../src/core/parse';
import { stripRepeatedLines } from '../../src/core/clean';
import { DEFAULT_ANALYZE_OPTIONS } from '../../src/core/analyzeOptions';
import { localCorpusRoots } from '../localCorpus';

/* ---------- Corpus ---------- */

function walkJsonl(dir: string): string[] {
  const out: string[] = [];
  const rec = (d: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) rec(p);
      else if (e.name.endsWith('.jsonl')) out.push(p);
    }
  };
  rec(dir);
  return out;
}

const roots = localCorpusRoots();
if (roots.length === 0) {
  console.log('WC_LOCAL_CORPUS 未设置或目录不存在，跳过（见 tools/localCorpus.ts 顶部注释）。');
  process.exit(0);
}

const files: string[] = [];
for (const r of roots) files.push(...walkJsonl(path.join(r, 'default-user/chats')));
if (files.length === 0) {
  console.log('本机语料目录存在，但没找到任何 .jsonl 记录，跳过。');
  process.exit(0);
}

/* ---------- Shape judges ---------- */

/** A short line entirely wrapped by a matching bracket/marker pair, e.g. 【场景】 [状态] **提示**. */
function isTag(line: string): boolean {
  if (line.length > 24) return false;
  return /^([[【(（{<*_~]{1,3}).{1,20}([\]】)）}>*_~]{1,3})$/.test(line);
}

/** Mostly punctuation/symbols — dividers, rules, decorative lines. */
function isSymbolLine(line: string): boolean {
  const noSpace = line.replace(/\s/g, '');
  if (!noSpace) return true;
  const nonSymbol = noSpace.replace(/[\p{L}\p{N}]/gu, '');
  return nonSymbol.length / noSpace.length >= 0.6;
}

/** `键：值` / `key: value` — a single short label before a colon, no sentence-final punctuation. */
function isKeyValue(line: string): boolean {
  if (!/[:：]/.test(line)) return false;
  const [key, ...rest] = line.split(/[:：]/);
  const value = rest.join(':');
  if (!key || key.length > 12 || key.length === 0) return false;
  if (/[。！？.!?]$/.test(value.trim())) return false;
  return value.length <= 60;
}

/** Digits, separators and unit-ish characters only — a stat/table row. */
function isNumericTable(line: string): boolean {
  const noSpace = line.replace(/\s/g, '');
  if (noSpace.length < 2) return false;
  return /^[\d|｜/\\.,，%％\-—+一二三四五六七八九十百千万零]+$/.test(noSpace);
}

function shapeHit(line: string): string | null {
  if (isTag(line)) return 'tag';
  if (isSymbolLine(line)) return 'symbol';
  if (isKeyValue(line)) return 'kv';
  if (isNumericTable(line)) return 'numeric';
  return null;
}

/** Describe a line's shape without ever printing its content. */
function describeShape(line: string): string {
  const chars = [...line];
  const han = chars.filter((c) => /\p{Script=Han}/u.test(c)).length;
  const latin = chars.filter((c) => /[a-zA-Z]/.test(c)).length;
  const digit = chars.filter((c) => /[0-9]/.test(c)).length;
  const punct = chars.filter((c) => /[\p{P}\p{S}]/u.test(c)).length;
  const hasColon = /[:：]/.test(line);
  const wrapped = /^[[【(（{<*_~"'"'']/.test(line) && /[\]】)）}>*_~"'"']$/.test(line);
  return `长度${chars.length}（汉字${han}/拉丁${latin}/数字${digit}/标点符号${punct}）` +
    `${hasColon ? '、含冒号' : ''}${wrapped ? '、首尾成对包裹' : ''}`;
}

/* ---------- Run ---------- */

interface Dropped { line: string; shape: string | null }

let totalDropped = 0;
const suspects: Dropped[] = [];
const shapeCounts: Record<string, number> = { tag: 0, symbol: 0, kv: 0, numeric: 0 };
let filesUsed = 0;

for (const f of files) {
  let content: string;
  try { content = fs.readFileSync(f, 'utf8'); } catch { continue; }
  const chat = parseChatFile(path.basename(f), content, {
    clean: DEFAULT_ANALYZE_OPTIONS.clean,
    includeAllSwipes: false,
  });
  const roleSet = new Set(['user', 'char']);
  const texts = chat.messages.filter((m) => roleSet.has(m.role)).map((m) => m.text);
  if (texts.length < 5) continue; // stripRepeatedLines' own `min`; nothing would be dropped anyway
  filesUsed++;

  const after = stripRepeatedLines(texts);
  for (let i = 0; i < texts.length; i++) {
    const beforeLines = texts[i].split('\n');
    const afterLines = after[i].split('\n');
    let j = 0;
    for (const raw of beforeLines) {
      if (j < afterLines.length && raw === afterLines[j]) { j++; continue; }
      const line = raw.trim();
      if (!line) continue; // blank lines are never counted as "dropped narrative"
      totalDropped++;
      const shape = shapeHit(line);
      if (shape) { shapeCounts[shape]++; continue; }
      suspects.push({ line, shape: null });
    }
  }
}

if (filesUsed === 0) {
  console.log('本机语料里没有任何一个文件有 ≥5 条消息（stripRepeatedLines 的 min），跳过。');
  process.exit(0);
}

const suspectCount = suspects.length;
const ratio = totalDropped === 0 ? 0 : suspectCount / totalDropped;

console.log(`记录数：${filesUsed} 份（${files.length - filesUsed} 份消息数 <5，跳过）`);
console.log(`被 stripRepeatedLines 删掉的行：${totalDropped} 条`);
console.log(`  命中形状判据：标签 ${shapeCounts.tag}　符号/分隔线 ${shapeCounts.symbol}　键值 ${shapeCounts.kv}　纯数字表格 ${shapeCounts.numeric}`);
console.log(`疑似误删（不命中任何形状判据）：${suspectCount} 条，占比 ${(ratio * 100).toFixed(2)}%`);

// Most typical suspects: longest ones first (short bracket/punctuation-heavy lines that slip
// past the judges are usually still template noise; long ones are more likely real narrative).
const typical = [...suspects].sort((a, b) => b.line.length - a.line.length).slice(0, 5);
if (typical.length) {
  console.log('\n最典型的 5 条疑似误删行（只写形状，不贴内容）：');
  for (const s of typical) console.log('  - ' + describeShape(s.line));
}

if (ratio > 0.02) {
  console.log(`\n⚠️ 误删率 ${(ratio * 100).toFixed(2)}% 超过 2% 阈值：stripRepeatedLines 疑似把叙事行当模板行删了，需要复核形状判据或提高阈值/min。`);
  process.exit(1);
}
console.log('\n✅ 误删率 ≤ 2%。');

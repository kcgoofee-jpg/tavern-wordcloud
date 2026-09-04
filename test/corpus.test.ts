/** Regression on real logs from the local SillyTavern data directory. Skipped when absent. */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseChatFile, collectNames } from '../src/core/parse';
import { tokenizeCorpus } from '../src/core/tokenize';
import { localCorpusRoots } from '../tools/localCorpus';

const ROOTS = localCorpusRoots();

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.jsonl') || e.name.endsWith('.json')) out.push(p);
  }
  return out;
}

const files: string[] = [];
for (const r of ROOTS) walk(path.join(r, 'default-user/chats'), files);

describe.skipIf(files.length === 0)('真实语料', () => {
  it('runs end to end with readable top words', () => {
    const t0 = Date.now();
    const chats = files.map((f) => parseChatFile(path.basename(f), fs.readFileSync(f, 'utf8')));
    const tParse = Date.now() - t0;

    const messages = chats.flatMap((c) => c.messages).filter((m) => m.role !== 'system');
    const rawChars = chats.reduce((a, c) => a + c.rawChars, 0);
    const cleanChars = chats.reduce((a, c) => a + c.cleanChars, 0);

    const t1 = Date.now();
    const res = tokenizeCorpus(messages.map((m) => m.text), {
      dictionary: collectNames(chats),
      maxWords: 60,
    });
    const tTok = Date.now() - t1;

    console.log(`\n文件 ${files.length} / 消息 ${messages.length} / 原文 ${rawChars} 字 -> 清洗 ${cleanChars} 字 (去噪 ${((1 - cleanChars / rawChars) * 100).toFixed(1)}%)`);
    console.log(`解析 ${tParse}ms  分词 ${tTok}ms  总词次 ${res.totalTokens}  去重 ${res.uniqueTokens}`);
    console.log(`新词发现 ${res.discovered.length} 个: ${res.discovered.slice(0, 40).join(' ')}`);
    console.log('=== TOP 60 ===\n' + res.words.map((w, i) => `${String(i + 1).padStart(2)}. ${w.text} ${w.count}`).join('\n'));

    expect(messages.length).toBeGreaterThan(100);
    expect(res.words.length).toBeGreaterThan(20);
    // Cleaning must remove a substantial share
    expect(cleanChars).toBeLessThan(rawChars * 0.8);
    // No plugin identifiers may leak into the cloud
    const leaked = res.words.filter((w) => /fate|updatevariable|statusplaceholder|jsonpatch|analysis/i.test(w.text));
    expect(leaked).toEqual([]);

    // CSS property names and JS identifiers from HTML status panels must not appear
    const codeWords = [
      'custom', 'notice', 'status', 'mes', 'div', 'span', 'html', 'body', 'color',
      'padding', 'margin', 'background', 'border', 'font', 'width', 'height',
      'function', 'const', 'return', 'render', 'root', 'container', 'wrapper',
      'opacity', 'transform', 'translate', 'keyframes', 'doctype',
    ];
    const found = res.words.filter((w) => codeWords.includes(w.text.toLowerCase()));
    expect(found.map((w) => `${w.text}×${w.count}`)).toEqual([]);
  });
});

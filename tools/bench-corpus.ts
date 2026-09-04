/**
 * Corpus benchmark: noise ratio, parse and tokenize time, TOP N, and a
 * contamination check for code fragments and plugin identifiers in the cloud.
 *
 * Usage: npx vite-node tools/bench-corpus.ts fixtures/ceo-en.jsonl [more.jsonl ...]
 */
import { toZh } from '../src/core/zh';
import fs from 'node:fs';
import path from 'node:path';
import { analyze, DEFAULT_ANALYZE_OPTIONS } from '../src/core/analyze';
import { parseChatFile, DEFAULT_PARSE_OPTIONS } from '../src/core/parse';

/** Strings that must never appear in the cloud. Any hit fails the run. */
const CONTAMINANTS: { name: string; re: RegExp }[] = [
  { name: '插件标识串', re: /^(fate_?ui|updatevariable|statusplaceholder\w*|jsonpatch|analysis|thinking|mvu|inputvar|outputvar)$/i },
  // Only tokens that never occur in English prose; `let`, `class`, `return` etc. are ordinary words
  { name: '代码关键字', re: /^(typeof|undefined|nullptr|elif|elsif|func|def|println|printf|console|stdout|stderr|json|util|api_key|localhost)$/i },
  { name: 'HTML/CSS 残片', re: /^(div|span|href|src|px|rgba?|font-\w+|background|border|margin|padding|width|height|display|flex)$/i },
  { name: '尖括号或花括号', re: /[<>{}]/ },
  { name: '看起来像标识符', re: /^[a-z]+_[a-z_]+$/i },
  { name: '纯标点或纯符号', re: /^[^\p{L}\p{N}]+$/u },
];

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('用法: npx vite-node tools/bench-corpus.ts <chat.jsonl> [...]');
  process.exit(1);
}

let bad = 0;

for (const f of files) {
  const content = fs.readFileSync(f, 'utf8');
  const name = path.basename(f);

  // Parse time measured separately from tokenization
  const t0 = performance.now();
  const parsed = parseChatFile(name, content, DEFAULT_PARSE_OPTIONS);
  const parseMs = performance.now() - t0;

  const rawChars = parsed.messages.reduce((a, m) => a + m.raw.length, 0);
  const cleanChars = parsed.messages.reduce((a, m) => a + m.text.length, 0);

  const t1 = performance.now();
  const r = analyze([{ name, content }], {
    ...DEFAULT_ANALYZE_OPTIONS,
    roles: ['user', 'char'],
    kinds: ['plain', 'person', 'place', 'time'],
    tokenize: { ...DEFAULT_ANALYZE_OPTIONS.tokenize, maxWords: 60, minCount: 2 },
  });
  const totalMs = performance.now() - t1;

  console.log(`\n═══ ${name} ═══`);
  console.log(`消息      ${parsed.messages.length} 条`);
  console.log(`字数      原文 ${rawChars} → 清洗后 ${cleanChars}`
    + `（去噪 ${(((rawChars - cleanChars) / Math.max(1, rawChars)) * 100).toFixed(1)}%）`);
  console.log(`解析      ${parseMs.toFixed(1)} ms`);
  console.log(`解析+分词 ${totalMs.toFixed(1)} ms   （分词约 ${(totalMs - parseMs).toFixed(1)} ms）`);
  console.log(`词        ${r.uniqueTokens} 个不重复 / ${r.totalTokens} 个词元`);
  if (r.warnings.length) console.log(`⚠️  ${r.warnings.map(toZh).join(' | ')}`);

  console.log(`\nTOP 60：`);
  const top = r.words.slice(0, 60);
  for (let i = 0; i < top.length; i += 6) {
    console.log('  ' + top.slice(i, i + 6).map((w) => `${w.text}(${w.count})`.padEnd(20)).join(''));
  }

  // The main check: nothing unexpected in the TOP 60
  const hits: string[] = [];
  for (const w of top) {
    for (const c of CONTAMINANTS) {
      if (c.re.test(w.text)) hits.push(`${w.text} ← ${c.name}`);
    }
  }
  if (hits.length) {
    console.log(`\n❌ TOP 60 里有 ${hits.length} 个污染项：`);
    for (const h of hits) console.log(`   ${h}`);
    bad += hits.length;
  } else {
    console.log(`\n✅ TOP 60 干净：没有代码词、插件标识串、标签残片`);
  }

  if (r.discovered.length) {
    console.log(`\n自动发现的新词（前 20）：${r.discovered.slice(0, 20).join(' / ')}`);
  }
}

process.exit(bad > 0 ? 1 : 0);

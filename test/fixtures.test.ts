/**
 * End-to-end checks on generated corpora (100 to 1500 turns).
 * Generated fixtures carry plugin noise and assert a noise ratio > 25%;
 * the hand-written ceo-*.jsonl fixtures carry none and assert verbatim presence instead.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { collectNames, parseChatFile } from '../src/core/parse';
import { tokenizeCorpus } from '../src/core/tokenize';

const DIR = path.join(process.cwd(), 'fixtures');
const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.jsonl')) : [];

describe.skipIf(files.length === 0)('生成语料', () => {
  it('all sizes run, noise is removed, timing is acceptable', () => {
    const rows: string[] = [];
    for (const f of files.sort()) {
      const raw = fs.readFileSync(path.join(DIR, f), 'utf8');
      const t0 = Date.now();
      const chat = parseChatFile(f, raw);
      const tParse = Date.now() - t0;
      const msgs = chat.messages.filter((m) => m.role !== 'system');
      const t1 = Date.now();
      const res = tokenizeCorpus(msgs.map((m) => m.text), { dictionary: collectNames([chat]), maxWords: 120 });
      const tTok = Date.now() - t1;
      const noise = 1 - chat.cleanChars / Math.max(1, chat.rawChars);
      // Plugin blocks appear only in character messages, so the noise ratio is measured there
      const charMsgs = chat.messages.filter((m) => m.role === 'char');
      const charRaw = charMsgs.reduce((a, m) => a + m.raw.length, 0);
      const charClean = charMsgs.reduce((a, m) => a + m.text.length, 0);
      const charNoise = 1 - charClean / Math.max(1, charRaw);
      rows.push(
        `${String(chat.messages.length).padStart(5)} 条  ${(chat.rawChars / 1000).toFixed(0).padStart(5)}k字 ` +
        `-> ${(chat.cleanChars / 1000).toFixed(0).padStart(4)}k  去噪 ${(noise * 100).toFixed(1)}%（角色发言 ${(charNoise * 100).toFixed(1)}%）  ` +
        `解析 ${String(tParse).padStart(4)}ms  分词 ${String(tTok).padStart(4)}ms  ` +
        `词 ${String(res.uniqueTokens).padStart(5)}  TOP5 ${res.words.slice(0, 5).map((w) => w.text).join('/')}`,
      );

      expect(chat.warnings).toEqual([]);
      // Only generated noisy fixtures have a noise ratio
      if (!f.startsWith('ceo-')) expect(charNoise).toBeGreaterThan(0.25);
      // No plugin noise in the cloud
      const bad = res.words.filter((w) =>
        /^(fate|ui|updatevariable|analysis|jsonpatch|status|custom|notice|render|root|html|body|div|span|opacity|padding|color|keyframes|slideup|linear|gradient|doctype|iv|qf)$/i.test(w.text));
      expect(bad.map((w) => w.text)).toEqual([]);
      // Base64 must not be tokenized. The test describes base64 by shape (mixed case, digits, +/), not by length, because long English words such as `conversation` are 12+ letters.
      const looksBase64 = (t: string) =>
        t.length >= 12 && /^[A-Za-z0-9+/=]+$/.test(t)
        && (/[0-9+/=]/.test(t) || (/[a-z]/.test(t) && /[A-Z]/.test(t)));
      expect(res.words.filter((w) => looksBase64(w.text)).map((w) => w.text)).toEqual([]);

      // Hand-written fixtures: every cloud word must occur verbatim in the text
      if (f.startsWith('ceo-')) {
        // Latin words match whole words; `includes` would let `walke` match `walked`
        const corpus = msgs.map((m) => m.text).join('\n').toLowerCase();
        const inCorpus = (w: string) => (/^[a-z][a-z' -]*$/.test(w)
          ? new RegExp(`(?<![a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`).test(corpus)
          : corpus.includes(w));
        const ghosts = res.words.filter((w) => !inCorpus(w.text.toLowerCase()));
        expect(ghosts.map((w) => w.text)).toEqual([]);
      }
    }
    console.log('\n' + rows.join('\n'));
  }, 120_000);
});

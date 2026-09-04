/** Input formats: .jsonl / .json / .txt / .zip, with no conversion required. */
import { toZh } from '../src/core/zh';
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { detectFormat } from '../src/core/formats';
import { parseChatFile } from '../src/core/parse';
import { readDataBundle } from '../src/core/bundle';
import { localSample } from '../tools/localCorpus';

// Real exports stay on the machine that has them: WC_LOCAL_SAMPLE_* point at them, and the
// cases below skip themselves when unset. Hard-coding the paths published the chat file names.
const TXT = localSample('WC_LOCAL_SAMPLE_TXT') ?? '';
const JSONL = localSample('WC_LOCAL_SAMPLE_JSONL') ?? '';
const ZIP = localSample('WC_LOCAL_SAMPLE_ZIP') ?? '';

describe('format detection', () => {
  it('jsonl: the first line is complete JSON', () => {
    expect(detectFormat('a.jsonl', '{"name":"x","mes":"y"}')).toBe('jsonl');
  });
  it('json: the first line is incomplete, the whole file is one document', () => {
    expect(detectFormat('a.json', '[\n  {"name":"x"}\n]')).toBe('json');
  });
  it('txt: speaker prefix', () => {
    expect(detectFormat('a.txt', '角色: 他走了。')).toBe('txt');
  });
  it('zip by extension', () => {
    expect(detectFormat('x.zip', 'PK')).toBe('zip');
  });
  it('content wins over extension', () => {
    expect(detectFormat('a.txt', '{"name":"x","mes":"y"}')).toBe('jsonl');
  });

  // Some Android/Chrome file pickers report the wrong MIME type for extension-only
  // accept filters (notes/docs/29) — e.g. a .jsonl selected as application/octet-stream.
  // detectFormat never looks at File.type, only the name and sniffed content, so this
  // is a no-op in practice; the test pins that invariant down.
  it('ignores File.type entirely — a mislabeled MIME does not change detection', () => {
    const file = new File(['{"name":"x","mes":"y"}\n'], 'chat.jsonl', { type: 'application/octet-stream' });
    expect(detectFormat(file.name, '{"name":"x","mes":"y"}')).toBe('jsonl');
    expect('type' in file).toBe(true); // File.type exists but detectFormat's signature never takes it
  });
});

describe.skipIf(!fs.existsSync(TXT))('真实的 .txt 导出', () => {
  it('parses messages and warns about the reduced format', () => {
    const chat = parseChatFile(
      'AMERICA v1.3.1 - 2026-09-02@18h56m55s069ms.txt',
      fs.readFileSync(TXT, 'utf8'),
    );
    expect(chat.messages.length).toBeGreaterThan(3);
    expect(chat.charName).toBe('AMERICA v1.3.1');
    expect(chat.userName).toBe('User');
    expect(chat.warnings.map(toZh).join()).toMatch(/纯文本导出/);
    expect(chat.cleanChars).toBeGreaterThan(1000);
  });

  it('message count matches the same .jsonl', () => {
    if (!fs.existsSync(JSONL)) return;
    const a = parseChatFile('x.txt', fs.readFileSync(TXT, 'utf8'));
    const b = parseChatFile('x.jsonl', fs.readFileSync(JSONL, 'utf8'));
    // Matches the real file: 7 messages of lengths 5268/20/2814/6/5185/39/1556
    expect(a.messages.length).toBe(b.messages.length);
    expect(a.messages.map((m) => m.role)).toEqual(b.messages.map((m) => m.role));
  });
});

describe.skipIf(!fs.existsSync(ZIP))('真实的整包 .zip', () => {
  it('reads chats, world-info keywords and the preset name', () => {
    const seen: string[] = [];
    const b = readDataBundle(new Uint8Array(fs.readFileSync(ZIP)), (p) => seen.push(p.phase));
    console.log(
      `\n整包：${b.chats.length} 份聊天 · ${b.worlds.length} 本世界书` +
      `（${b.worldKeywords.length} 个可用关键词） · ${b.characterCards} 张角色卡`,
    );
    console.log(`  预设：${b.presetName}`);
    console.log(`  系统提示词：${b.sysPromptName}`);
    console.log(`  当前角色卡：${b.activeCharacter}`);
    console.log(`  关键词样例：${b.worldKeywords.slice(0, 16).join(' / ')}`);
    expect(b.chats.length).toBeGreaterThan(0);
    expect(b.worldKeywords.length).toBeGreaterThan(20);
    // Not available from a single chat file
    expect(b.presetName).toBeTruthy();
    expect(seen.length).toBeGreaterThan(0);
  }, 120_000);

  it('prompt fragments are filtered from world-info keys', () => {
    const b = readDataBundle(new Uint8Array(fs.readFileSync(ZIP)));
    expect(b.worldKeywords).not.toContain('必须在每次回');
    expect(b.worldKeywords).not.toContain('复的最后一行');
    // Lower-case ASCII trigger words are not names
    expect(b.worldKeywords).not.toContain('forest');
  }, 120_000);

  it('chats carry the zip directory name', () => {
    const b = readDataBundle(new Uint8Array(fs.readFileSync(ZIP)));
    expect(b.chats.some((c) => c.character)).toBe(true);
  }, 120_000);
});

/** Import robustness: broken lines are skipped, the rest is used (truncation, BOM, CRLF). */
import { toZh } from '../src/core/zh';
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseChatFile } from '../src/core/parse';
import { analyze, DEFAULT_ANALYZE_OPTIONS } from '../src/core/analyze';

const FIX = path.join(process.cwd(), 'fixtures', 'ceo-zh.jsonl');
const base = fs.existsSync(FIX) ? fs.readFileSync(FIX, 'utf8') : '';
const opts = { clean: DEFAULT_ANALYZE_OPTIONS.clean, includeAllSwipes: false };
const good = () => parseChatFile('a.jsonl', base, opts).messages.length;

describe.skipIf(!base)('导入容错', () => {
  it('baseline: the corpus parses into messages', () => { expect(good()).toBeGreaterThan(50); });

  it('BOM, CRLF, truncated tail: message count unchanged or minus one', () => {
    const n = good();
    expect(parseChatFile('a.jsonl', '﻿' + base, opts).messages.length).toBe(n);
    expect(parseChatFile('a.jsonl', base.replace(/\n/g, '\r\n'), opts).messages.length).toBe(n);
    const cut = base.slice(0, Math.floor(base.length * 0.97));   // Truncated transfer, last line incomplete
    const complete = cut.split('\n').length - 2;                  // Complete lines (excluding metadata and the truncated tail)
    const r = parseChatFile('a.jsonl', cut, opts);
    expect(r.messages.length).toBe(complete);
    expect(r.messages.length).toBeLessThan(n);
    expect(r.warnings.map(toZh).join(' ')).toMatch(/跳过/);
  });

  it('broken lines, non-string mes, missing metadata: the rest parses', () => {
    const lines = base.split('\n').filter(Boolean);
    const n = good();
    lines[3] = '{"name":"x","mes":null}';
    lines[4] = '{"name":"x","mes":123,"is_user":true}';
    lines[5] = '{broken';
    lines[6] = '';
    const r = parseChatFile('a.jsonl', lines.join('\n'), opts);
    expect(r.messages.length).toBeGreaterThanOrEqual(n - 4);
    expect(r.warnings.length).toBeLessThanOrEqual(2);
    const noHeader = parseChatFile('a.jsonl', lines.slice(1).join('\n'), opts);
    expect(noHeader.messages.length).toBeGreaterThanOrEqual(n - 4);
  });

  it('one unrecognized file warns; the others still produce a cloud', () => {
    const r = analyze([
      { name: 'ok.jsonl', content: base },
      { name: 'bad.jsonl', content: 'this is not a chat file at all\n<html></html>' },
      { name: 'empty.jsonl', content: '' },
    ], { ...DEFAULT_ANALYZE_OPTIONS, roles: ['user', 'char'] });
    expect(r.words.length).toBeGreaterThan(20);
    expect(r.warnings.map(toZh).some((w) => w.includes('bad.jsonl'))).toBe(true);
    expect(r.warnings.map(toZh).some((w) => w.includes('empty.jsonl'))).toBe(true);
  });

  it('accepts .json arrays and {chat:[...]}', () => {
    const recs = base.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const n = good();
    expect(parseChatFile('a.json', JSON.stringify(recs), opts).messages.length).toBe(n);
    expect(parseChatFile('a.json', JSON.stringify({ chat: recs }), opts).messages.length).toBe(n);
  });
});

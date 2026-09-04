import { cleanMessageText } from './clean';
import type { ChatMessage, ParsedChat } from './types';
import type { ParseOptions } from './parse';
import { zh } from './zh';

/**
 * Input formats, all produced by SillyTavern's own export functions:
 *   .jsonl  one JSON object per line
 *   .json   an array, or { chat: [...] }
 *   .txt    "speaker: text", continuation lines follow
 *   .zip    full data export
 * Users upload whatever they have; no conversion is required.
 */
export type ChatFormat = 'jsonl' | 'json' | 'txt' | 'zip' | 'unknown';

export function detectFormat(name: string, head: string): ChatFormat {
  const lower = name.toLowerCase();
  if (lower.endsWith('.zip')) return 'zip';

  const trimmed = head.replace(/^﻿/, '').trimStart();
  // Content first, extension second: files are sometimes saved with the wrong extension.
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const firstLine = trimmed.split('\n', 1)[0];
    try {
      JSON.parse(firstLine);
      return 'jsonl';   // First line is complete JSON = JSONL
    } catch {
      return 'json';    // First line incomplete = one large JSON document
    }
  }
  if (lower.endsWith('.txt')) return 'txt';
  if (lower.endsWith('.jsonl')) return 'jsonl';
  if (lower.endsWith('.json')) return 'json';
  // Lines of the form "speaker: " = plain-text chat export
  if (/^[^\n:：]{1,40}[:：]\s/m.test(trimmed)) return 'txt';
  return 'unknown';
}

/**
 * A line starting with `speaker: `. Three constraints keep structured plugin
 * output (indented fields, JSON punctuation) from being read as speakers:
 *   (1) no leading whitespace, (2) no JSON punctuation in the name, (3) no whitespace around the name.
 */
const SPEAKER_LINE = /^(\S[^\n:：]{0,38}\S|\S)[:：]\s(.*)$/;
const NAME_JUNK = /[{}[\]"'`<>|\\]/;

/**
 * Parse SillyTavern's plain-text export: each message starts with `speaker: ` and
 * runs until the next such line. This format carries no timestamps, models,
 * swipes or is_user flags.
 */
export function parseTxtChat(
  source: string,
  content: string,
  opts: ParseOptions,
  charNameHint?: string,
): ParsedChat {
  const chat: ParsedChat = { source, messages: [], warnings: [], rawChars: 0, cleanChars: 0 };
  const lines = content.replace(/^﻿/, '').split('\n');

  // First pass: which names look like speakers. Candidates have no indentation,
  // no JSON punctuation and do not start with a list marker.
  const candidates = new Set<string>();
  for (const l of lines) {
    const m = SPEAKER_LINE.exec(l);
    if (!m) continue;
    const n = m[1].trim();
    if (!n || NAME_JUNK.test(n) || /^[-*#>|+]/.test(n)) continue;
    candidates.add(n);
  }

  /** Split into blocks assuming every candidate is a speaker; average block length is only known afterwards. */
  const cut = (accept: Set<string>) => {
    const out: { name: string; lines: string[] }[] = [];
    for (const l of lines) {
      const m = SPEAKER_LINE.exec(l);
      const n = m?.[1].trim();
      if (m && n && accept.has(n)) out.push({ name: n, lines: [m[2]] });
      else if (out.length) out[out.length - 1].lines.push(l);
    }
    return out;
  };

  // The structural criteria are usually sufficient. Length is deliberately not used:
  // user messages are short and a length threshold would drop quiet speakers.
  let speakers = new Set(candidates);

  // Escalate only when the structural criteria clearly failed (too many candidates):
  // then filter again by block length.
  if (speakers.size > 6) {
    const probe = cut(candidates);
    const size = new Map<string, { n: number; chars: number }>();
    for (const c of probe) {
      const e = size.get(c.name) ?? { n: 0, chars: 0 };
      e.n++; e.chars += c.lines.join('\n').trim().length;
      size.set(c.name, e);
    }
    speakers = new Set([...size].filter(([, e]) => e.chars / e.n >= 40).map(([n]) => n));
    if (charNameHint && candidates.has(charNameHint)) speakers.add(charNameHint);
    if (speakers.size === 0) speakers = new Set(candidates);
  }

  // Leading lines without a speaker (usually the export header) are dropped.
  const chunks = cut(speakers);

  if (chunks.length === 0) {
    chat.warnings.push({ src: source, key: zh('认不出纯文本聊天记录的格式（应该是「说话人: 正文」）') });
    return chat;
  }

  // Which speaker is the user: the file name gives the card name, so the other one is the user.
  // Otherwise the speaker with the shorter average message.
  const avgLen = new Map<string, number[]>();
  for (const c of chunks) {
    const arr = avgLen.get(c.name) ?? [];
    arr.push(c.lines.join('\n').length);
    avgLen.set(c.name, arr);
  }
  const mean = (a: number[]) => a.reduce((p, c) => p + c, 0) / a.length;
  let charName = charNameHint && speakers.has(charNameHint) ? charNameHint : '';
  if (!charName) {
    let best = ''; let bestLen = -1;
    for (const [n, arr] of avgLen) {
      const m = mean(arr);
      if (m > bestLen) { bestLen = m; best = n; }
    }
    charName = best;
  }
  chat.charName = charName;
  const others = [...speakers].filter((n) => n !== charName);
  if (others.length === 1) chat.userName = others[0];

  const messages: ChatMessage[] = [];
  chunks.forEach((c, i) => {
    const raw = c.lines.join('\n').trim();
    if (!raw) return;
    messages.push({
      index: i,
      name: c.name,
      role: c.name === charName ? 'char' : 'user',
      raw,
      text: cleanMessageText(raw, opts.clean, {
        placement: c.name === charName ? 2 : 1,
      }),
      swipeCount: 1,
    });
  });
  chat.messages = messages;
  for (const m of messages) { chat.rawChars += m.raw.length; chat.cleanChars += m.text.length; }

  chat.warnings.push({
    src: source,
    key: zh('这是纯文本导出，只有正文——没有时间、模型、重生记录，发言人身份是猜的。想要完整统计请导出 .jsonl'),
  });
  return chat;
}

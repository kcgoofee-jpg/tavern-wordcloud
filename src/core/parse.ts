import type { ChatMessage, ParsedChat, RawMessage, Role, CleanOptions } from './types';
import { cleanMessageText, DEFAULT_CLEAN_OPTIONS } from './clean';
import { detectFormat, parseTxtChat } from './formats';
import { zh } from './zh';

/**
 * SillyTavern `extra.type` values that are UI / narrator / comments, not story speech.
 * `/sys` writes `narrator` with `is_system: false`; `/comment` writes `comment`.
 * `/hide` only flips `is_system` and does not set `type`.
 */
const SYSTEM_EXTRA_TYPES = new Set([
  'narrator', 'comment', 'help', 'welcome', 'empty', 'generic',
  'slash_commands', 'formatting', 'hotkeys', 'macros',
  'welcome_prompt', 'assistant_note', 'assistant_message',
]);

function extraOf(m: RawMessage): Record<string, unknown> {
  const e = m.extra;
  return e && !Array.isArray(e) ? (e as Record<string, unknown>) : {};
}

/** SillyTavern's small system-message marker. */
function isSmallSys(m: RawMessage): boolean {
  return extraOf(m).isSmallSys === true;
}

function isSystemNotice(m: RawMessage): boolean {
  if (isSmallSys(m)) return true;
  const t = extraOf(m).type;
  return typeof t === 'string' && SYSTEM_EXTRA_TYPES.has(t);
}

/**
 * `is_system` is set both by real system notices and by `/hide` (a message hidden from the
 * model but still part of the story). `/hide` keeps the original speaker (`is_user` / `name`)
 * and does not set `extra.type`. Group-chat members who also have visible lines stay `char`
 * even when their name is not the file's primary card name.
 */
function roleOf(m: RawMessage, charName: string | undefined, storySpeakers: ReadonlySet<string>): Role {
  if (isSystemNotice(m)) return 'system';
  if (m.is_user === true) return 'user';
  if (m.is_system === true) {
    if (typeof m.name === 'string' && (m.name === charName || storySpeakers.has(m.name))) return 'char';
    return 'system';
  }
  return 'char';
}

/**
 * Current swipe body. SillyTavern writes `mes = swipes[swipe_id]` on swipe
 * (`slash-commands.js` addSwipeCallback / script.js syncMesToSwipe). If a file
 * was saved mid-edit they can diverge; the selector is `swipe_id`.
 */
function currentMes(m: RawMessage): string {
  const id = m.swipe_id;
  let body = m.mes ?? '';
  if (
    typeof id === 'number' && Number.isInteger(id) && id >= 0
    && Array.isArray(m.swipes) && typeof m.swipes[id] === 'string'
  ) {
    body = m.swipes[id];
  }
  // chats.js appendFileContent prepends attachment text and stores its length.
  // Only applied on the raw mes/swipe path: display_text is what the UI showed.
  const fl = extraOf(m).fileLength;
  if (typeof fl === 'number' && Number.isInteger(fl) && fl > 0 && fl <= body.length) {
    return body.slice(fl);
  }
  return body;
}

/** What the user saw: regex display output, else the selected swipe / `mes`. */
function messageBody(m: RawMessage): string {
  const display = extraOf(m).display_text;
  if (typeof display === 'string' && display.trim()) return display;
  return currentMes(m);
}

/** Same rule as `display_text` vs `mes`: the regex-processed trace if present (`reasoning.js`). */
function extraReasoning(ex: Record<string, unknown>): string | undefined {
  for (const key of ['reasoning_display_text', 'reasoning'] as const) {
    const v = ex[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return undefined;
}

/** Metadata line: has chat_metadata / user_name but no mes. */
function isMetadataLine(o: unknown): o is { user_name?: string; character_name?: string; chat_metadata?: Record<string, unknown> } {
  if (!o || typeof o !== 'object') return false;
  const r = o as Record<string, unknown>;
  return typeof r.mes !== 'string' && ('chat_metadata' in r || 'user_name' in r || 'character_name' in r);
}

function looksLikeMessage(o: unknown): o is RawMessage {
  return !!o && typeof o === 'object' && typeof (o as RawMessage).mes === 'string';
}

export interface ParseOptions {
  clean: CleanOptions;
  /** Include unselected swipes. Off by default to avoid double counting. */
  includeAllSwipes: boolean;
}

export const DEFAULT_PARSE_OPTIONS: ParseOptions = {
  clean: DEFAULT_CLEAN_OPTIONS,
  includeAllSwipes: false,
};

function genSeconds(m: RawMessage): number | undefined {
  const a = Date.parse(String((m as Record<string, unknown>).gen_started ?? ''));
  const b = Date.parse(String((m as Record<string, unknown>).gen_finished ?? ''));
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return undefined;
  return (b - a) / 1000;
}

function pushMessage(
  out: ChatMessage[],
  m: RawMessage,
  index: number,
  opts: ParseOptions,
  charName: string | undefined,
  storySpeakers: ReadonlySet<string>,
): void {
  const texts: string[] = [];
  if (opts.includeAllSwipes && Array.isArray(m.swipes) && m.swipes.length > 1) {
    for (const s of m.swipes) if (typeof s === 'string') texts.push(s);
  } else {
    texts.push(messageBody(m));
  }
  const raw = texts.join('\n');
  const ex = extraOf(m);
  const role = roleOf(m, charName, storySpeakers);
  out.push({
    index,
    name: typeof m.name === 'string' ? m.name : zh('(未知)'),
    role,
    raw,
    text: cleanMessageText(raw, opts.clean, {
      placement: role === 'user' ? 1 : role === 'char' ? 2 : undefined,
    }),
    date: m.send_date != null ? String(m.send_date) : undefined,
    // Reasoning is passed through raw; it has its own cleaning path (cot.ts).
    reasoning: extraReasoning(ex),
    model: typeof ex.model === 'string' ? ex.model : undefined,
    api: typeof ex.api === 'string' ? ex.api : undefined,
    genSeconds: genSeconds(m),
    swipeCount: Array.isArray(m.swipes) ? Math.max(1, m.swipes.length) : 1,
  });
}

/**
 * Parse one chat file. Accepts:
 *  1. SillyTavern .jsonl: metadata line, then one message per line
 *  2. exported .json array: [metadata?, message, ...]
 *  3. wrapped .json object: { chat: [...] } / { messages: [...] } / { history: [...] }
 * A broken line only produces a warning; the rest of the file is still used.
 */
export function parseChatFile(
  source: string,
  content: string,
  opts: ParseOptions = DEFAULT_PARSE_OPTIONS,
): ParsedChat {
  const chat: ParsedChat = {
    source, messages: [], warnings: [], rawChars: 0, cleanChars: 0,
  };

  const trimmed = content.replace(/^﻿/, '').trim();
  if (!trimmed) {
    chat.warnings.push({ src: source, key: zh('文件是空的') });
    return chat;
  }

  // Plain-text exports use a separate parser.
  if (detectFormat(source, trimmed.slice(0, 400)) === 'txt') {
    const m = /^(.*?)\s+-\s+\d{4}-\d{2}-\d{2}@/.exec(source);
    return parseTxtChat(source, content, opts, m?.[1]?.trim());
  }

  let records: unknown[] | null = null;

  // Try the whole file as JSON first, then line by line.
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const whole = JSON.parse(trimmed);
      if (Array.isArray(whole)) {
        records = whole;
      } else if (whole && typeof whole === 'object') {
        const o = whole as Record<string, unknown>;
        for (const key of ['chat', 'messages', 'history', 'data']) {
          if (Array.isArray(o[key])) { records = o[key] as unknown[]; break; }
        }
        if (!records && typeof o.mes === 'string') records = [whole];
      }
    } catch {
      records = null; // Probably JSONL; parse per line.
    }
  }

  if (!records) {
    records = [];
    const lines = trimmed.split('\n');
    let bad = 0;
    for (const line of lines) {
      const s = line.trim();
      if (!s) continue;
      try {
        records.push(JSON.parse(s));
      } catch {
        bad++;
      }
    }
    if (records.length === 0) {
      // Nothing parsed: report the format as unrecognized without per-line noise.
      chat.warnings.push({ src: source, key: zh('认不出格式，既不是 JSON 也不是 JSONL。确认这是聊天记录文件？') });
      return chat;
    }
    if (bad > 0) chat.warnings.push({ src: source, key: zh('有 {n} 行不是合法 JSON，已跳过'), params: { n: bad } });
  }

  /** Character name known before the messages: the metadata line or the file name ("<card> - <timestamp>.jsonl"). */
  const preName = (() => {
    for (const rec of records) if (isMetadataLine(rec) && rec.character_name && rec.character_name !== 'unused') return rec.character_name;
    const m = /^(.*?)\s+-\s+\d{4}-\d{2}-\d{2}@/.exec(source);
    if (m?.[1].trim()) return m[1].trim();
    // Neither: the most frequent non-user speaker
    const tally = new Map<string, number>();
    // Only visible character lines vote: a speaker who exists solely as is_system lines is a system notice, not the character.
    // `/sys` narrator lines have is_system false but extra.type=narrator — they must not win the card name.
    for (const rec of records) {
      if (!looksLikeMessage(rec) || rec.is_user === true || rec.is_system === true || isSystemNotice(rec) || typeof rec.name !== 'string') continue;
      tally.set(rec.name, (tally.get(rec.name) ?? 0) + 1);
    }
    let best: string | undefined; let bestN = 0;
    for (const [k, v] of tally) if (v > bestN) { best = k; bestN = v; }
    return best;
  })();
  const storySpeakers = new Set<string>();
  for (const rec of records) {
    if (!looksLikeMessage(rec) || isSystemNotice(rec) || typeof rec.name !== 'string') continue;
    if (rec.is_user === true) continue;
    if (rec.is_system === true) continue;
    storySpeakers.add(rec.name);
  }
  let index = 0;
  for (const rec of records) {
    if (isMetadataLine(rec)) {
      const meta = rec as { user_name?: string; character_name?: string };
      // SillyTavern sometimes writes the placeholder "unused" in these fields.
      if (meta.user_name && meta.user_name !== 'unused') chat.userName = meta.user_name;
      if (meta.character_name && meta.character_name !== 'unused') chat.charName = meta.character_name;
      const cm = (rec as { chat_metadata?: Record<string, unknown> }).chat_metadata;
      if (cm) {
        if (typeof cm.world_info === 'string' && cm.world_info) chat.worldInfo = cm.world_info;
        if (typeof cm.note_prompt === 'string' && cm.note_prompt.trim()) chat.authorNote = cm.note_prompt.trim();
        if (typeof cm.lastInContextMessageId === 'number' && Number.isFinite(cm.lastInContextMessageId)) {
          chat.lastInContextMessageId = cm.lastInContextMessageId;
        }
      }
      continue;
    }
    if (!looksLikeMessage(rec)) continue;
    pushMessage(chat.messages, rec, index++, opts, preName, storySpeakers);
  }

  if (chat.messages.length === 0) {
    chat.warnings.push({ src: source, key: zh('解析成功但一条消息都没有（确认这是聊天记录，不是角色卡或世界书？）') });
  }

  for (const m of chat.messages) {
    chat.rawChars += m.raw.length;
    chat.cleanChars += m.text.length;
  }

  // Character name: metadata, then the file name ("<card> - <timestamp>.jsonl"), then the most frequent non-user speaker.
  if (!chat.charName) {
    const m = /^(.*?)\s+-\s+\d{4}-\d{2}-\d{2}@/.exec(source);
    if (m && m[1].trim()) chat.charName = m[1].trim();
  }
  if (!chat.charName) {
    const tally = new Map<string, number>();
    for (const m of chat.messages) {
      if (m.role === 'char') tally.set(m.name, (tally.get(m.name) ?? 0) + 1);
    }
    let best = ''; let bestN = 0;
    for (const [k, v] of tally) if (v > bestN) { best = k; bestN = v; }
    if (best) chat.charName = best;
  }
  if (!chat.userName) {
    const tally = new Map<string, number>();
    for (const m of chat.messages) {
      if (m.role === 'user') tally.set(m.name, (tally.get(m.name) ?? 0) + 1);
    }
    let best = ''; let bestN = 0;
    for (const [k, v] of tally) if (v > bestN) { best = k; bestN = v; }
    if (best) chat.userName = best;
  }

  return chat;
}

/** Collect proper nouns (character name, user name, group speakers) as a tokenizer dictionary. */
export function collectNames(chats: ParsedChat[]): string[] {
  const names = new Set<string>();
  for (const c of chats) {
    if (c.charName) names.add(c.charName);
    if (c.userName) names.add(c.userName);
    for (const m of c.messages) if (m.name && m.name !== '(未知)') names.add(m.name);
  }
  // Strip version suffixes: "逐梦演艺圈4.2" -> "逐梦演艺圈"
  const out = new Set<string>();
  for (const n of names) {
    out.add(n);
    const base = n.replace(/[\d.\s（）()【】[\]·-]+$/g, '').trim();
    if (base.length >= 2 && base !== n) out.add(base);
  }
  return [...out].filter((n) => n.length >= 2 && n.length <= 12);
}

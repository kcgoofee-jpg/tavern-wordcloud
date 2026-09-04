/**
 * Chunked parsing, for the progress ring only.
 *
 * `parseChatFile` takes a whole file and returns when it is done: a 20 MB export is
 * one 390 ms call with a single progress callback at the end, which is most of the
 * 555 ms freeze AGENTS.md hard rule 5 forbids. This module cuts a JSONL file into
 * small pieces, parses each piece with the *unmodified* `parseChatFile`, and glues
 * the results back together, so the ring gets an update every ~200 KB.
 *
 * Splitting is only safe when the pieces cannot see less than the whole file does.
 * `splitJsonlForProgress` returns `null` — i.e. "parse this in one go, as before" —
 * unless every piece of global state `parseChatFile` derives is provably
 * chunk-independent. See `splitJsonlForProgress` for the three conditions.
 */
import { parseChatFile, type ParseOptions } from './parse';
import type { ChatMessage, ParsedChat } from './types';
import { zh, type UserText } from './zh';

/** A piece ends at whichever cap comes first — the same shape as the tokenizer's batches. */
export const PARSE_CHUNK_CHARS = 200_000;
export const PARSE_CHUNK_LINES = 40;

/** `<card> - 2026-08-24@14h04m04s104ms.jsonl` — the file-name rule `parseChatFile` uses. */
const NAME_FROM_FILE = /^(.*?)\s+-\s+\d{4}-\d{2}-\d{2}@/;
/** A record line: `looksLikeMessage` is `typeof mes === 'string'`. */
const HAS_MES = /"mes"\s*:/;
/** Only consulted for `is_system: true` records — see the condition list below. */
const HAS_SYSTEM_FLAG = /"is_system"\s*:\s*true/;

/** Chat-level fields the metadata lines carry; `parseChatFile` applies them last-wins. */
export interface JsonlMeta {
  metaChar?: string;
  metaUser?: string;
  worldInfo?: string;
  authorNote?: string;
  lastInContextMessageId?: number;
}

export interface JsonlChunks extends JsonlMeta {
  /** Piece contents, in file order; concatenating them with `\n` rebuilds the input. */
  pieces: string[];
}

/** A file with more metadata lines than this is not the shape we think it is. */
const MAX_META_LINES = 64;

/**
 * Cut `content` into pieces that `parseChatFile` can read independently, or `null`
 * when that would not be equivalent to parsing the whole file at once.
 *
 * The three things `parseChatFile` derives from the *whole* record list are
 * `preName`, `storySpeakers` and the chat-level names, so a piece is safe only when:
 *
 * 1. **No `is_system: true` record.** `preName` and `storySpeakers` are read by
 *    `roleOf` inside that branch and nowhere else, so without such a record no role
 *    depends on what the other pieces contain. (A file that has them is parsed whole:
 *    correctness first, the ring just gets one tick for it as before.)
 * 2. **Every non-message line is a readable metadata line, and there are few of them.**
 *    They are parsed here instead, so `mergeParsedChats` can apply them last-wins over
 *    the whole file exactly as `parseChatFile` does, no matter which piece they land in.
 * 3. **It is really JSONL** — not a `.txt` export, not one pretty-printed JSON array,
 *    and long enough that splitting buys anything.
 */
export function splitJsonlForProgress(
  source: string,
  content: string,
  chunkChars = PARSE_CHUNK_CHARS,
  chunkLines = PARSE_CHUNK_LINES,
): JsonlChunks | null {
  if (content.length <= chunkChars) return null;
  if (/\.txt$/i.test(source)) return null;
  const trimmed = content.replace(/^﻿/, '').trim();
  if (!trimmed.startsWith('{')) return null;
  if (HAS_SYSTEM_FLAG.test(trimmed)) return null;              // condition 1
  const lines = trimmed.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return null;
  // A whole-file JSON object is handled by the JSON branch of `parseChatFile`; only
  // a file where that parse fails goes line by line, and only that is chunkable.
  try { JSON.parse(trimmed); return null; } catch { /* JSONL, keep going */ }

  // Metadata lines are the only records that are not messages, and there are a handful
  // of them at most; parsing just those (they have no `"mes"`) is cheap and lets the
  // merge reproduce `parseChatFile`'s last-wins application of them, wherever they sit.
  const meta: JsonlMeta = {};
  let metaLines = 0;
  for (const line of lines) {
    if (HAS_MES.test(line)) continue;
    if (++metaLines > MAX_META_LINES) return null;              // condition 2
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return null;                     // an unparseable non-message line: parse it whole
    }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    // `isMetadataLine`: no `mes`, and at least one of the three metadata keys.
    if (!('chat_metadata' in o || 'user_name' in o || 'character_name' in o)) return null;
    if (typeof o.character_name === 'string' && o.character_name !== 'unused') meta.metaChar = o.character_name;
    if (typeof o.user_name === 'string' && o.user_name !== 'unused') meta.metaUser = o.user_name;
    const cm = o.chat_metadata as Record<string, unknown> | undefined;
    if (cm) {
      if (typeof cm.world_info === 'string' && cm.world_info) meta.worldInfo = cm.world_info;
      if (typeof cm.note_prompt === 'string' && cm.note_prompt.trim()) meta.authorNote = cm.note_prompt.trim();
      if (typeof cm.lastInContextMessageId === 'number' && Number.isFinite(cm.lastInContextMessageId)) {
        meta.lastInContextMessageId = cm.lastInContextMessageId;
      }
    }
  }

  const pieces: string[] = [];
  let from = 0;
  while (from < lines.length) {
    let to = from;
    let chars = 0;
    while (to < lines.length && to - from < chunkLines && (chars === 0 || chars < chunkChars)) {
      chars += lines[to].length + 1;
      to++;
    }
    pieces.push(lines.slice(from, to).join('\n'));
    from = to;
  }
  return pieces.length > 1 ? { pieces, ...meta } : null;
}

/** The most frequent speaker of a role — `parseChatFile`'s own name fallback. */
function tally(messages: ChatMessage[], role: 'char' | 'user'): string | undefined {
  const n = new Map<string, number>();
  for (const m of messages) if (m.role === role) n.set(m.name, (n.get(m.name) ?? 0) + 1);
  let best: string | undefined;
  let bestN = 0;
  for (const [k, v] of n) if (v > bestN) { best = k; bestN = v; }
  return best;
}

/** Warnings that only make sense for a whole file, not for one 200 KB slice of it. */
const PER_FILE_ONLY = new Set<string>([
  zh('文件是空的'),
  zh('解析成功但一条消息都没有（确认这是聊天记录，不是角色卡或世界书？）'),
  zh('认不出格式，既不是 JSON 也不是 JSONL。确认这是聊天记录文件？'),
]);
const BAD_LINES = zh('有 {n} 行不是合法 JSON，已跳过');

/**
 * Glue the per-piece results back into the `ParsedChat` a whole-file parse produces:
 * messages renumbered in file order, per-piece warnings folded into one, and the
 * chat-level names re-derived with `parseChatFile`'s own precedence
 * (metadata line > file name > most frequent speaker) over *all* the messages.
 */
export function mergeParsedChats(source: string, parts: ParsedChat[], meta: JsonlMeta): ParsedChat {
  const messages: ChatMessage[] = [];
  for (const p of parts) for (const m of p.messages) messages.push({ ...m, index: messages.length });

  let badLines = 0;
  const warnings: UserText[] = [];
  const keyOf = (w: UserText): string => (typeof w === 'string' ? w : w.key);
  for (const p of parts) {
    for (const w of p.warnings) {
      const key = keyOf(w);
      if (key === BAD_LINES) {
        badLines += typeof w === 'string' ? 0 : Number(w.params?.n ?? 0);
        continue;
      }
      if (PER_FILE_ONLY.has(key)) continue;
      if (!warnings.some((x) => keyOf(x) === key)) warnings.push(w);
    }
  }
  if (badLines > 0) warnings.unshift({ key: BAD_LINES, params: { n: badLines } });
  if (messages.length === 0) {
    warnings.push({ key: zh('解析成功但一条消息都没有（确认这是聊天记录，不是角色卡或世界书？）'), src: source });
  }

  const fileName = NAME_FROM_FILE.exec(source)?.[1]?.trim() || undefined;
  return {
    source,
    messages,
    warnings,
    rawChars: parts.reduce((a, p) => a + p.rawChars, 0),
    cleanChars: parts.reduce((a, p) => a + p.cleanChars, 0),
    // `parseChatFile`'s precedence: metadata line, then the file name, then the most
    // frequent speaker — the last of which has to see every message, hence the merge.
    charName: meta.metaChar ?? fileName ?? tally(messages, 'char'),
    userName: meta.metaUser ?? tally(messages, 'user'),
    worldInfo: meta.worldInfo,
    authorNote: meta.authorNote,
    lastInContextMessageId: meta.lastInContextMessageId,
  };
}

/**
 * Parse one file, yielding the characters consumed so far after every piece.
 * Falls back to a single `parseChatFile` call (one yield, at the end) whenever
 * `splitJsonlForProgress` says the file is not safely divisible.
 */
export function* parseFileInChunks(
  source: string,
  content: string,
  opts: ParseOptions,
): Generator<number, ParsedChat, void> {
  const split = splitJsonlForProgress(source, content);
  if (!split) {
    const chat = parseChatFile(source, content, opts);
    yield content.length;
    return chat;
  }
  const parts: ParsedChat[] = [];
  let done = 0;
  for (let i = 0; i < split.pieces.length; i++) {
    parts.push(parseChatFile(source, split.pieces[i], opts));
    done = Math.min(content.length, done + split.pieces[i].length + 1);
    // Blank lines and the BOM were dropped by the splitter, so the pieces are a little
    // shorter than the file; the last tick reports the file's real length regardless.
    yield i === split.pieces.length - 1 ? content.length : done;
  }
  return mergeParsedChats(source, parts, split);
}

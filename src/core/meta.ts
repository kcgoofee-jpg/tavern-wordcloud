import type { ChatMessage, ParsedChat } from './types';
import { zh } from './zh';

/**
 * Metadata available from an export file:
 *   file name      "<card> - <timestamp>.jsonl": card name, chat start time
 *   chat_metadata  world_info, note_prompt, lastInContextMessageId
 *   per message    name / is_user / is_system, mes, send_date, extra.model, extra.api,
 *                  extra.reasoning, gen_started / gen_finished, swipes / swipe_id
 * The preset name is not stored in chat files.
 */
export interface ChatMeta {
  /** Card name: file name, then world-info name, then the most frequent non-user speaker. */
  character: string;
  /** Chat start time, from the file name or the first send_date. */
  startedAt: string | null;
  endedAt: string | null;
  worldInfo: string | null;
  authorNote: string | null;
  /** Models used (a chat may switch models). */
  models: string[];
  apis: string[];
  messages: number;
  userMessages: number;
  charMessages: number;
  /** Share of messages with more than one swipe. */
  swipeRate: number;
  /** Average generation time in seconds, or null. */
  avgGenSeconds: number | null;
  rawChars: number;
  cleanChars: number;
  /**
   * Last message index still in the model context. Null when the file did not
   * record it — do not treat missing as 0 (notes/docs/01 §9).
   */
  lastInContextMessageId: number | null;
}

/** SillyTavern file names look like "<card> - 2026-08-31@20h00m08s527ms.jsonl". */
const FILENAME = /^(.*?)\s+-\s+(\d{4}-\d{2}-\d{2})@(\d{2})h(\d{2})m(\d{2})s(\d+)ms\.jsonl$/i;

export function parseFileName(name: string): { character: string; startedAt: string | null } {
  const m = FILENAME.exec(name);
  if (!m) return { character: name.replace(/\.(jsonl|json|txt)$/i, ''), startedAt: null };
  return { character: m[1], startedAt: `${m[2]}T${m[3]}:${m[4]}:${m[5]}` };
}

function pickDate(messages: ChatMessage[], first: boolean): string | null {
  const src = first ? messages : [...messages].reverse();
  for (const m of src) if (m.date) return m.date;
  return null;
}

export function describeChat(chat: ParsedChat): ChatMeta {
  const fromName = parseFileName(chat.source);
  const models = new Set<string>();
  const apis = new Set<string>();
  let withSwipes = 0;
  let genTotal = 0;
  let genCount = 0;

  for (const m of chat.messages) {
    if (m.model) models.add(m.model);
    if (m.api) apis.add(m.api);
    if (m.swipeCount > 1) withSwipes++;
    if (m.genSeconds != null) { genTotal += m.genSeconds; genCount++; }
  }

  return {
    character: chat.charName || fromName.character || zh('(未知角色卡)'),
    startedAt: fromName.startedAt ?? pickDate(chat.messages, true),
    endedAt: pickDate(chat.messages, false),
    worldInfo: chat.worldInfo ?? null,
    authorNote: chat.authorNote ?? null,
    models: [...models],
    apis: [...apis],
    messages: chat.messages.length,
    userMessages: chat.messages.filter((m) => m.role === 'user').length,
    charMessages: chat.messages.filter((m) => m.role === 'char').length,
    swipeRate: chat.messages.length ? withSwipes / chat.messages.length : 0,
    avgGenSeconds: genCount ? genTotal / genCount : null,
    rawChars: chat.rawChars,
    cleanChars: chat.cleanChars,
    lastInContextMessageId: chat.lastInContextMessageId ?? null,
  };
}

export interface CharacterGroup {
  /** Card name */
  character: string;
  /** Files belonging to this card */
  files: string[];
  meta: ChatMeta;
}

/**
 * Group files by character card. Several chats of one card are merged; several
 * cards offer a per-card switch or a merged view.
 */
export function groupByCharacter(chats: ParsedChat[]): CharacterGroup[] {
  const byChar = new Map<string, ParsedChat[]>();
  for (const c of chats) {
    const key = c.charName || parseFileName(c.source).character;
    const list = byChar.get(key);
    if (list) list.push(c);
    else byChar.set(key, [c]);
  }

  return [...byChar.entries()]
    .map(([character, list]) => {
      const merged: ParsedChat = {
        source: character,
        charName: character,
        userName: list.find((c) => c.userName)?.userName,
        worldInfo: list.find((c) => c.worldInfo)?.worldInfo,
        authorNote: list.find((c) => c.authorNote)?.authorNote,
        messages: list.flatMap((c) => c.messages),
        warnings: list.flatMap((c) => c.warnings),
        rawChars: list.reduce((a, c) => a + c.rawChars, 0),
        cleanChars: list.reduce((a, c) => a + c.cleanChars, 0),
        lastInContextMessageId: list.length === 1 ? list[0].lastInContextMessageId : undefined,
      };
      return { character, files: list.map((c) => c.source), meta: describeChat(merged) };
    })
    .sort((a, b) => b.meta.messages - a.meta.messages);
}

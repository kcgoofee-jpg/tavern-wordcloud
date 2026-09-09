import { unzipSync, strFromU8 } from 'fflate';
import { readText } from '../share/png';
import { parseRegexScripts, mergeRules, type CleanRule } from './regexScripts';
import { DEFAULT_STOPWORDS } from './stopwords';
import { zh, type UserText } from './zh';

/**
 * Full data export (.zip) from SillyTavern. Only these paths are inflated:
 *   chats/<card>/*.jsonl        all chats
 *   group chats/*.jsonl         group chats
 *   backups/*.jsonl             SillyTavern's rolling chat backups — fallback only, see BACKUP_NAME
 *   worlds/*.json               world info; `entries[].key` is a curated proper-noun list
 *   settings.json               global settings (exact name — the settings.json.bak* copies are not)
 *   characters/*.png            character cards (not parsed)
 *
 * Everything else is skipped before it is decompressed. The filter used to keep any
 * `.json`/`.jsonl` anywhere in the archive and cap the running total at 256 MB in
 * *archive order*; a real 119 MB export (2026-09-09) holds 345 MB of JSON, and the
 * irrelevant part — `baibaoku/` caches, dozens of `settings.json.bak*`, `instruct/`,
 * `context/`, `NovelAI Settings/`, `themes/`, `user/` — spent the whole budget at
 * archive entry 374 of 665, before `characters/` (430), `chats/` (466) and `worlds/`
 * (658) were reached. The import then reported 0 chats, 0 cards, 0 world-info files
 * and pushed one over-budget warning per skipped file (218 of them).
 */

export interface BundleChat {
  /** Original SillyTavern file name; the card name is parsed from it. */
  name: string;
  content: string;
  /** Directory name inside the zip. */
  character?: string;
}

export interface DataBundle {
  chats: BundleChat[];
  /** World-info keywords, used as a dictionary. */
  worldKeywords: string[];
  /** World-info name -> keyword count. */
  worlds: { name: string; keywords: number }[];
  /** Current preset name (full export only). */
  presetName?: string;
  /** System prompt name. */
  sysPromptName?: string;
  /** Current character card. */
  activeCharacter?: string;
  /** Main API type, e.g. openai. */
  mainApi?: string;
  /** Number of character-card PNGs. */
  characterCards: number;
  /** Regex scripts from settings.json and character cards, as cleaning rules. */
  regexScripts: CleanRule[];
  /**
   * Where `chats` came from. `backups` means `chats/` held no .jsonl at all and the
   * rolling snapshots under `backups/` were used instead — the UI says so, because
   * a snapshot can be older than the live chat.
   */
  source: 'chats' | 'backups';
  /** Only meaningful for `source: 'backups'`: snapshots kept (one per chat) and older ones dropped. */
  backupsDeduped: { kept: number; dropped: number };
  warnings: UserText[];
}

/**
 * A character card's identity fields, handed to `readDataBundle`'s `onCard` callback while the
 * card PNG is being parsed. `firstMes`/`description` are the card's own narrative text: they exist
 * only for the caller to hash into a strong fingerprint (`core/cardRules.ts`) and must be dropped
 * immediately afterwards. They are deliberately NOT part of `DataBundle` — nothing that leaves this
 * function (export JSON, share links, `/api/contribute`) may ever carry them (notes/docs/23 §3).
 */
export interface CardIdentity {
  /** The card's own `data.name`, falling back to the PNG file name. */
  name: string;
  /** PNG file name without the extension — the zip's `chats/<dir>/` name, which may differ from `name`. */
  fileName: string;
  /** Transient: hash it, then drop it. */
  firstMes: string;
  /** Transient: hash it, then drop it. */
  description: string;
}

export interface BundleProgress {
  phase: 'unzip' | 'scan' | 'read';
  /** Elapsed / speed / estimated remaining time for large archives. */
  detail?: UserText;
  /** Notable events during import. */
  note?: UserText;
  done: number;
  total: number;
  label: UserText;
}

const norm = (p: string) => p.replace(/\\/g, '/');

/** A chat where SillyTavern normally writes it. Same shape the reading loop below matches. */
const CHAT_RE = /(?:^|\/)chats\/[^/]+\/[^/]+\.jsonl$/i;
const GROUP_CHAT_RE = /(?:^|\/)group chats\/[^/]+\.jsonl$/i;
const BACKUP_RE = /(?:^|\/)backups\/(?:[^/]+\/)*[^/]+\.jsonl$/i;
const WORLD_RE = /(?:^|\/)worlds\/[^/]+\.json$/i;
/** Exact file name: `settings.json.bak3` and `backups/settings_default-user_…json` are not settings. */
const SETTINGS_RE = /(?:^|\/)settings\.json$/i;
const CARD_RE = /(?:^|\/)characters\/[^/]+\.png$/i;

/** Everything the importer can actually use. Anything else is never decompressed. */
function relevant(name: string): boolean {
  const n = norm(name);
  return CHAT_RE.test(n) || GROUP_CHAT_RE.test(n) || BACKUP_RE.test(n)
    || WORLD_RE.test(n) || SETTINGS_RE.test(n) || CARD_RE.test(n);
}

/** Zip-bomb limits, applied to the selected files only. */
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;

/**
 * SillyTavern's rolling chat backups. `backupChat()` writes
 *   backups/chat_<sanitized chat folder>_<YYYYMMDD>-<HHMMSS>.jsonl
 * where the sanitizer lowercases and replaces every character outside [a-z0-9] with
 * `_`, one for one: `AMERICA v2.0` → `america_v2_0`, a five-hanzi folder → `_____`.
 *
 * Measured on the real export (2026-09-09): 246 backup .jsonl in 7 groups of at most 50
 * (a rolling cap), 6 of the 7 group keys equal `sanitizeCardName()` of a `chats/` folder
 * or a `characters/*.png` file name — the seventh belongs to a card that is no longer in
 * the export — and 1 of the 247 files (`wiped-empty-chat-21h20.bak.jsonl`) does not follow
 * the scheme at all, so a non-matching name becomes its own group with no timestamp.
 * The name carries no chat id, so a group is one character, not one chat: keeping the
 * newest timestamp per group keeps that character's newest snapshot, which is what the
 * fallback promises.
 */
const BACKUP_NAME = /^chat_(.+)_(\d{8}-\d{6})\.jsonl$/i;

/** The transform SillyTavern applies to a folder name before putting it in a backup file name. */
const sanitizeCardName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '_');

/** World-info keys contain prompt fragments; keep only plausible proper nouns. */
function usableKeyword(k: string): boolean {
  const t = k.trim();
  if (t.length < 2 || t.length > 12) return false;
  // Lower-case ASCII keys are usually trigger words, not names.
  if (/^[a-z][a-z\s]*$/.test(t)) return false;
  // Punctuation, digits and braces mark template fragments.
  if (/[{}<>|\\/*+=`"']/.test(t)) return false;
  // Prompt fragments used as triggers contain function words; proper nouns do not.
  if (/[的了着地得在是和与或被把将不没]/.test(t)) return false;
  for (const w of DEFAULT_STOPWORDS) {
    if (w.length >= 2 && t.includes(w)) return false;
  }
  return true;
}

/**
 * Read a full-export zip.
 *
 * @param onProgress per-file progress
 * @param onCard called once per readable character card with its identity fields, including the
 *   transient `firstMes`/`description`. Callers use them to compute a strong card fingerprint and
 *   must not keep them: they never appear on the returned `DataBundle`.
 */
export function readDataBundle(
  data: Uint8Array,
  onProgress?: (p: BundleProgress) => void,
  onCard?: (card: CardIdentity) => void,
): DataBundle {
  const out: DataBundle = {
    chats: [], worldKeywords: [], worlds: [], characterCards: 0, regexScripts: [],
    source: 'chats', backupsDeduped: { kept: 0, dropped: 0 }, warnings: [],
  };

  /** `total: 0` means indeterminate: the UI shows a spinner instead of 0%. Unzipping reports no progress. */
  const t0 = Date.now();
  const el = (): UserText => ({ key: zh('已用 {s} 秒'), params: { s: ((Date.now() - t0) / 1000).toFixed(0) } });
  onProgress?.({
    phase: 'unzip', done: 0, total: 0, label: zh('正在解压'),
    detail: `${(data.length / 1048576).toFixed(1)} MB`,
    note: { key: zh('开始解压 {mb} MB'), params: { mb: (data.length / 1048576).toFixed(1) } },
  });
  let files: Record<string, Uint8Array>;
  /** True when the archive holds real chats, so `backups/` is not needed. Decided before inflating. */
  let hasLiveChats = false;
  try {
    /*
     * Pass 1 lists the archive without decompressing anything (the filter always says no):
     * only then is it known whether `chats/` has content, and only then can the budget be
     * spent on files that will actually be read. Deciding while inflating — what this used
     * to do — let 250 MB of unrelated JSON eat the budget before the chats were reached.
     */
    const entries: { name: string; size: number }[] = [];
    unzipSync(data, {
      filter: (f) => {
        if (relevant(f.name)) entries.push({ name: f.name, size: f.originalSize });
        return false;
      },
    });
    hasLiveChats = entries.some((e) => CHAT_RE.test(norm(e.name)) || GROUP_CHAT_RE.test(norm(e.name)));

    let total = 0;
    let oversized = 0;
    let skipped = 0;
    let skippedBytes = 0;
    const pick = new Set<string>();
    for (const e of entries) {
      // The rolling snapshots are only read when there is nothing live to read; skipping
      // them here keeps 250 MB out of memory in the common case.
      if (hasLiveChats && BACKUP_RE.test(norm(e.name))) continue;
      if (e.size > MAX_FILE_BYTES) { oversized++; continue; }
      if (total + e.size > MAX_TOTAL_BYTES) { skipped++; skippedBytes += e.size; continue; }
      total += e.size;
      pick.add(e.name);
    }
    // One warning each, with the counts: the old code pushed one per skipped file.
    if (oversized) out.warnings.push({ key: zh('有 {n} 个文件单个超过 64 MB，跳过'), params: { n: oversized } });
    if (skipped) {
      out.warnings.push({
        key: zh('要读的文件加起来超过 512 MB：跳过了 {n} 个文件、共 {mb} MB'),
        params: { n: skipped, mb: (skippedBytes / 1048576).toFixed(0) },
      });
    }

    files = unzipSync(data, { filter: (f) => pick.has(f.name) });
  } catch (e) {
    out.warnings.push({ key: zh('解压失败：{msg}'), params: { msg: e instanceof Error ? e.message : String(e) } });
    return out;
  }

  const names = Object.keys(files);
  onProgress?.({
    phase: 'scan', done: 0, total: names.length, label: zh('正在归类'),
    detail: el(), note: { key: zh('解压出 {n} 个文件'), params: { n: names.length } },
  });

  /** Rolling snapshots, read only after the loop: the newest per chat, and only if `chats/` was empty. */
  const backups: { path: string; base: string; key: string; ts: string }[] = [];
  /** PNG file names (no extension), so a backup's sanitized key can be turned back into a card name. */
  const cardFileNames: string[] = [];

  let i = 0;
  for (const path of names) {
    i++;
    if (i % 20 === 0) {
      onProgress?.({ phase: 'read', done: i, total: names.length, label: zh('正在读取'), detail: el() });
    }

    const n = norm(path);
    const base = n.split('/').pop() ?? n;

    if (CARD_RE.test(n)) {
      out.characterCards++;
      cardFileNames.push(base.replace(/\.png$/i, ''));
      // Card JSON lives in the `chara` tEXt chunk (base64). Its world info keys and regex scripts are used too.
      try {
        const b64 = readText(files[path], 'chara');
        if (b64) {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          type CardFields = { name?: string; first_mes?: string; description?: string };
          const card = JSON.parse(new TextDecoder().decode(bytes)) as CardFields & { data?: CardFields & { character_book?: { entries?: { keys?: string[]; key?: string[] }[] }; extensions?: { regex_scripts?: unknown } } };
          const d = card.data;
          if (onCard) {
            // V2 cards keep everything under `data`; V1 cards have it at the top level.
            const fileName = base.replace(/\.png$/i, '');
            const str = (v: unknown) => (typeof v === 'string' ? v : '');
            onCard({
              name: str(d?.name ?? card.name).trim() || fileName,
              fileName,
              firstMes: str(d?.first_mes ?? card.first_mes),
              description: str(d?.description ?? card.description),
            });
          }
          const keys: string[] = [];
          for (const e of d?.character_book?.entries ?? []) for (const k of e.keys ?? e.key ?? []) if (usableKeyword(k)) keys.push(k.trim());
          if (keys.length) { out.worlds.push({ name: base.replace(/\.png$/i, ''), keywords: keys.length }); out.worldKeywords.push(...keys); }
          out.regexScripts = mergeRules(out.regexScripts, parseRegexScripts(d?.extensions?.regex_scripts));
        }
      } catch { /* a broken card does not affect the others */ }
      continue;
    }

    // Chats: chats/<card>/<file>.jsonl
    const chatMatch = /(?:^|\/)chats\/([^/]+)\/([^/]+\.jsonl)$/i.exec(n);
    if (chatMatch) {
      out.chats.push({
        name: chatMatch[2],
        character: chatMatch[1],
        content: strFromU8(files[path]),
      });
      continue;
    }
    // Group chats
    if (GROUP_CHAT_RE.test(n)) {
      out.chats.push({ name: base, content: strFromU8(files[path]) });
      continue;
    }

    // Rolling snapshots: only read after the loop, and only if nothing live was found.
    if (BACKUP_RE.test(n)) {
      const m = BACKUP_NAME.exec(base);
      // A file that does not follow the naming scheme is its own group and has no timestamp.
      backups.push({ path, base, key: m ? m[1].toLowerCase() : base, ts: m ? m[2] : '' });
      continue;
    }

    // World info
    if (WORLD_RE.test(n)) {
      try {
        const w = JSON.parse(strFromU8(files[path])) as { entries?: Record<string, { key?: string[] }> };
        const keys: string[] = [];
        for (const e of Object.values(w.entries ?? {})) {
          for (const k of e.key ?? []) if (usableKeyword(k)) keys.push(k.trim());
        }
        if (keys.length) {
          out.worlds.push({ name: base.replace(/\.json$/i, ''), keywords: keys.length });
          out.worldKeywords.push(...keys);
        }
      } catch { /* a broken world-info file does not affect the others */ }
      continue;
    }

    // Global settings: preset name
    if (SETTINGS_RE.test(n)) {
      try {
        const s = JSON.parse(strFromU8(files[path])) as {
          extension_settings?: { regex?: unknown };
          oai_settings?: { preset_settings_openai?: string };
          power_user?: { sysprompt?: { name?: string } };
          active_character?: string;
          main_api?: string;
        };
        out.presetName = s.oai_settings?.preset_settings_openai;
        out.sysPromptName = s.power_user?.sysprompt?.name;
        out.activeCharacter = s.active_character?.replace(/\.png$/i, '');
        out.mainApi = s.main_api;
        out.regexScripts = mergeRules(parseRegexScripts(s.extension_settings?.regex), out.regexScripts);
      } catch { out.warnings.push({ key: zh('settings.json 解析失败，拿不到预设名') }); }
    }
  }

  /*
   * Fallback: an export whose `chats/` holds only folders (the site owner's, 2026-09-09)
   * still has every conversation under `backups/`. One group is one chat folder, so keep
   * the newest timestamp per group and drop the older snapshots of the same chat.
   */
  if (out.chats.length === 0 && backups.length) {
    const newest = new Map<string, typeof backups[number]>();
    for (const b of backups) {
      const prev = newest.get(b.key);
      if (!prev || b.ts > prev.ts) newest.set(b.key, b);
    }
    // A backup name only carries the sanitized folder name; map it back to a real card name when one matches.
    const bySanitized = new Map(cardFileNames.map((f) => [sanitizeCardName(f), f]));
    for (const b of newest.values()) {
      out.chats.push({ name: b.base, character: bySanitized.get(b.key) ?? b.key, content: strFromU8(files[b.path]) });
    }
    out.source = 'backups';
    out.backupsDeduped = { kept: newest.size, dropped: backups.length - newest.size };
    out.warnings.push({
      key: zh('chats/ 里没有聊天记录，改用 backups/ 里最新的 {kept} 份快照（去掉了 {dropped} 份旧快照）'),
      params: out.backupsDeduped,
    });
  }

  out.worldKeywords = [...new Set(out.worldKeywords)];
  onProgress?.({
    phase: 'read', done: names.length, total: names.length, label: zh('读取完成'),
    detail: el(),
    note: {
      key: zh('{chats} 份聊天 · {worlds} 本世界书 · {cards} 张角色卡'),
      params: { chats: out.chats.length, worlds: out.worlds.length, cards: out.characterCards },
    },
  });

  if (out.chats.length === 0) {
    out.warnings.push({ key: zh('这个压缩包里没找到聊天记录（应该在 chats/<角色卡名>/ 下）') });
  }
  return out;
}

import { unzipSync, strFromU8 } from 'fflate';
import { readText } from '../share/png';
import { parseRegexScripts, mergeRules, type CleanRule } from './regexScripts';
import { DEFAULT_STOPWORDS } from './stopwords';
import { zh, type UserText } from './zh';

/**
 * Full data export (.zip) from SillyTavern:
 *   chats/<card>/*.jsonl        all chats
 *   worlds/*.json               world info; `entries[].key` is a curated proper-noun list
 *   settings.json               global settings, including the current preset name
 *   OpenAI Settings/*.json      preset files
 *   characters/*.png            character cards (not parsed)
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
    chats: [], worldKeywords: [], worlds: [], characterCards: 0, regexScripts: [], warnings: [],
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
  try {
    // Only extract what is needed. Zip-bomb limits: 64 MB per file, 256 MB total.
    let total = 0;
    files = unzipSync(data, {
      filter: (f) => {
        if (!(/\.(jsonl|json)$/i.test(f.name) || /characters\/.*\.png$/i.test(f.name))) return false;
        if (f.originalSize > 64 * 1024 * 1024) { out.warnings.push({ src: f.name, key: zh('单个文件超过 64 MB，跳过') }); return false; }
        total += f.originalSize;
        if (total > 256 * 1024 * 1024) { out.warnings.push({ key: zh('包里的文件加起来超过 256 MB，后面的跳过') }); return false; }
        return true;
      },
    });
  } catch (e) {
    out.warnings.push({ key: zh('解压失败：{msg}'), params: { msg: e instanceof Error ? e.message : String(e) } });
    return out;
  }

  const names = Object.keys(files);
  onProgress?.({
    phase: 'scan', done: 0, total: names.length, label: zh('正在归类'),
    detail: el(), note: { key: zh('解压出 {n} 个文件'), params: { n: names.length } },
  });

  let i = 0;
  for (const path of names) {
    i++;
    if (i % 20 === 0) {
      onProgress?.({ phase: 'read', done: i, total: names.length, label: zh('正在读取'), detail: el() });
    }

    const norm = path.replace(/\\/g, '/');
    const base = norm.split('/').pop() ?? norm;

    if (/characters\/[^/]+\.png$/i.test(norm)) {
      out.characterCards++;
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
    const chatMatch = /(?:^|\/)chats\/([^/]+)\/([^/]+\.jsonl)$/i.exec(norm);
    if (chatMatch) {
      out.chats.push({
        name: chatMatch[2],
        character: chatMatch[1],
        content: strFromU8(files[path]),
      });
      continue;
    }
    // Group chats
    if (/(?:^|\/)group chats\/[^/]+\.jsonl$/i.test(norm)) {
      out.chats.push({ name: base, content: strFromU8(files[path]) });
      continue;
    }

    // World info
    if (/(?:^|\/)worlds\/[^/]+\.json$/i.test(norm)) {
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
    if (/(?:^|\/)settings\.json$/i.test(norm)) {
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

/**
 * Full-export zip reading (src/core/bundle.ts).
 *
 * The bug these pin down (site owner's 119 MB export, 2026-09-09): the filter kept every
 * `.json`/`.jsonl` in the archive and spent a 256 MB budget in archive order, so caches and
 * settings backups exhausted it before `characters/`, `chats/` and `worlds/` were reached —
 * the import reported 0 chats / 0 cards / 0 world-info files with dozens of identical toasts.
 *
 * Every archive here is synthesized with `zipSync`; no real export is read. The big ones are
 * built inside the test bodies, not at collection time, so only one lives at a time.
 */
import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { PNG } from 'pngjs';
import { readDataBundle, type BundleProgress, type DataBundle } from '../src/core/bundle';
import { embedText } from '../src/share/png';
import { toZh } from '../src/core/zh';

const MB = 1024 * 1024;
/** Big enough to matter, cheap to build: stored (level 0), so the archive really is this big. */
const filler = (mb: number) => new Uint8Array(mb * MB).fill(0x61);

function cardPng(name: string): Uint8Array {
  const png = new PNG({ width: 2, height: 2 });
  png.data.fill(200);
  const card = { spec: 'chara_card_v2', data: { name, first_mes: '开场白', description: '设定' } };
  return embedText(new Uint8Array(PNG.sync.write(png)), 'chara', Buffer.from(JSON.stringify(card), 'utf8').toString('base64'));
}

const chatLine = (who: string) => [
  JSON.stringify({ user_name: '我', character_name: who }),
  JSON.stringify({ name: '我', is_user: true, mes: '通告单递给制片主任。' }),
].join('\n');

/** Warnings as plain Chinese, the way the UI shows them. */
const warns = (b: DataBundle) => b.warnings.map(toZh);

/** Reads the `解压出 N 个文件` note: how many entries were actually inflated. */
function readCounting(zip: Uint8Array): { bundle: DataBundle; unzipped: number } {
  let unzipped = -1;
  const onProgress = (p: BundleProgress) => {
    if (p.phase === 'scan' && typeof p.note === 'object' && p.note.params && 'n' in p.note.params) {
      unzipped = Number(p.note.params.n);
    }
  };
  return { bundle: readDataBundle(zip, onProgress), unzipped };
}

/** A full export whose irrelevant part alone is 300 MB — the shape that broke the import. */
function bloatedExport(): Uint8Array {
  const cache = filler(100);
  return zipSync({
    'default-user/baibaoku/cache/a.json': cache,
    'default-user/baibaoku/cache/b.json': cache,
    'default-user/baibaoku/databases/c.json': cache,
    'default-user/settings.json.bak3': strToU8('{"oai_settings":{"preset_settings_openai":"陈年备份"}}'),
    'default-user/instruct/x.json': strToU8('{"name":"instruct"}'),
    'default-user/context/y.json': strToU8('{"name":"context"}'),
    'default-user/NovelAI Settings/z.json': strToU8('{"name":"novelai"}'),
    'default-user/characters/小雨.png': cardPng('小雨'),
    'default-user/chats/小雨/聊天 - 2026-01-01@00h00m00s000ms.jsonl': strToU8(chatLine('小雨')),
    'default-user/worlds/雨巷.json': strToU8(JSON.stringify({ entries: { 0: { key: ['青石巷'] } } })),
    'default-user/settings.json': strToU8('{"oai_settings":{"preset_settings_openai":"当前预设"}}'),
  }, { level: 0 });
}

describe('irrelevant files never touch the budget', () => {
  it('reads the card, chat, world info and preset that 300 MB of cache used to starve out', () => {
    const { bundle, unzipped } = readCounting(bloatedExport());
    expect(bundle.characterCards).toBe(1);
    expect(bundle.chats).toHaveLength(1);
    expect(bundle.worlds.map((w) => w.name)).toEqual(['雨巷']);
    expect(bundle.presetName).toBe('当前预设');
    // No over-budget warning: the caches were never counted.
    expect(warns(bundle)).toEqual([]);
    // card + chat + world + settings.json. The caches, the .bak, instruct/, context/ and
    // NovelAI Settings/ are not in the archive's decompressed output at all.
    expect(unzipped).toBe(4);
  }, 300_000);

  it('takes the preset from settings.json, not from a settings.json.bak copy', () => {
    expect(readDataBundle(bloatedExport()).presetName).not.toBe('陈年备份');
  }, 300_000);
});

describe('backups/ fallback when chats/ has no .jsonl', () => {
  /**
   * SillyTavern names its rolling snapshots `chat_<sanitized folder>_<YYYYMMDD>-<HHMMSS>.jsonl`
   * (BACKUP_NAME in bundle.ts): three snapshots of one chat here, plus one of another.
   */
  const zip = () => zipSync({
    'default-user/chats/小雨/': new Uint8Array(0),
    'default-user/backups/chat_xiao_yu_20260901-101500.jsonl': strToU8(chatLine('小雨')),
    'default-user/backups/chat_xiao_yu_20260903-081200.jsonl': strToU8(chatLine('小雨')),
    'default-user/backups/chat_xiao_yu_20260902-235959.jsonl': strToU8(chatLine('小雨')),
    'default-user/backups/chat_lin_20260820-090000.jsonl': strToU8(chatLine('林')),
  });

  it('keeps the newest snapshot per chat and drops the older ones', () => {
    const b = readDataBundle(zip());
    expect(b.source).toBe('backups');
    expect(b.backupsDeduped).toEqual({ kept: 2, dropped: 2 });
    expect(b.chats.map((c) => c.name).sort()).toEqual([
      'chat_lin_20260820-090000.jsonl',
      'chat_xiao_yu_20260903-081200.jsonl',
    ]);
    // The character comes out of the file name.
    expect(b.chats.map((c) => c.character).sort()).toEqual(['lin', 'xiao_yu']);
  });

  it('says so in one warning with both counts, instead of "no chats found"', () => {
    expect(warns(readDataBundle(zip()))).toEqual([
      'chats/ 里没有聊天记录，改用 backups/ 里最新的 2 份快照（去掉了 2 份旧快照）',
    ]);
  });

  it('maps the sanitized name back to a character card when one matches', () => {
    const b = readDataBundle(zipSync({
      'default-user/characters/Xiao Yu.png': cardPng('Xiao Yu'),
      'default-user/backups/chat_xiao_yu_20260903-081200.jsonl': strToU8(chatLine('小雨')),
    }));
    expect(b.chats.map((c) => c.character)).toEqual(['Xiao Yu']);
  });
});

describe('chats/ wins over backups/', () => {
  const zip = () => zipSync({
    'default-user/chats/小雨/聊天 - 2026-01-01@00h00m00s000ms.jsonl': strToU8(chatLine('小雨')),
    'default-user/backups/chat_xiao_yu_20260903-081200.jsonl': strToU8(chatLine('小雨')),
    'default-user/backups/chat_xiao_yu_20260901-101500.jsonl': strToU8(chatLine('小雨')),
  });

  it('reads the live chat only, and does not even decompress the snapshots', () => {
    const { bundle, unzipped } = readCounting(zip());
    expect(bundle.source).toBe('chats');
    expect(bundle.backupsDeduped).toEqual({ kept: 0, dropped: 0 });
    expect(bundle.chats).toHaveLength(1);
    expect(bundle.chats[0].character).toBe('小雨');
    expect(unzipped).toBe(1);
  });
});

describe('size limits', () => {
  it('one warning with the counts when the selected files pass 512 MB in total', () => {
    // Nine 60 MB snapshots, each under the per-file limit: eight fit, the ninth does not.
    const big = filler(60);
    const files: Record<string, Uint8Array> = {};
    for (let i = 1; i <= 9; i++) files[`default-user/backups/chat_big_2026090${i}-101500.jsonl`] = big;
    const b = readDataBundle(zipSync(files, { level: 0 }));
    const over = warns(b).filter((w) => w.includes('512 MB'));
    expect(over).toEqual(['要读的文件加起来超过 512 MB：跳过了 1 个文件、共 60 MB']);
    expect(b.chats).toHaveLength(1); // the eight kept snapshots are one chat, deduplicated
  }, 300_000);

  it('skips a file over 64 MB and still reads the rest, with one warning', () => {
    const b = readDataBundle(zipSync({
      'default-user/backups/chat_huge_20260901-101500.jsonl': filler(65),
      'default-user/backups/chat_small_20260902-101500.jsonl': strToU8(chatLine('小雨')),
    }, { level: 0 }));
    expect(b.chats.map((c) => c.name)).toEqual(['chat_small_20260902-101500.jsonl']);
    expect(warns(b)).toContain('有 1 个文件单个超过 64 MB，跳过');
  }, 300_000);
});

describe('an archive with nothing to read', () => {
  it('still says where chats were expected', () => {
    const b = readDataBundle(zipSync({ 'default-user/themes/x.json': strToU8('{}') }));
    expect(b.chats).toEqual([]);
    expect(b.source).toBe('chats');
    expect(warns(b)).toEqual(['这个压缩包里没找到聊天记录（应该在 chats/<角色卡名>/ 下）']);
  });
});

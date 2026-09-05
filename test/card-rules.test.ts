import { describe, expect, it } from 'vitest';
import {
  applyCardRule, cardFingerprint, normalizeCardName, resolveCardRules, revertCardRule, saveCardRule,
  strongFingerprint, weakFingerprint, type CardRules,
} from '../src/core/cardRules';
import { readDataBundle, type CardIdentity } from '../src/core/bundle';
import { createHandler, type WorkerResponse } from '../src/worker/handler';
import { embedText } from '../src/share/png';
import { wordsToJson } from '../src/ui/export';
import { encodeSharePayload } from '../src/share/share';
import { zipSync, strToU8 } from 'fflate';
import { PNG } from 'pngjs';

describe('card fingerprint (notes/docs/23)', () => {
  it('normalizes name: full-width -> half-width, trims, drops a trailing version suffix', () => {
    expect(normalizeCardName('  排练厅的下午 v2.1 ')).toBe('排练厅的下午');
    expect(normalizeCardName('排练厅的下午')).toBe('排练厅的下午');
    expect(normalizeCardName('Ｎｉｃｏｌｅ　ｖ３')).toBe('Nicole');
  });

  it('same card, different chats -> same strong fingerprint', async () => {
    const a = await strongFingerprint('排练厅的下午', '你好，欢迎', '一个安静的下午茶馆');
    const b = await strongFingerprint('排练厅的下午', '你好，欢迎', '一个安静的下午茶馆');
    expect(a).toBe(b);
  });

  it('a trailing version bump alone does not change the fingerprint', async () => {
    const v1 = await strongFingerprint('排练厅的下午 v1', '你好，欢迎', '一个安静的下午茶馆');
    const v2 = await strongFingerprint('排练厅的下午 v2', '你好，欢迎', '一个安静的下午茶馆');
    expect(v1).toBe(v2);
  });

  it('a different card produces a different fingerprint', async () => {
    const a = await strongFingerprint('排练厅的下午', '你好，欢迎', '一个安静的下午茶馆');
    const b = await strongFingerprint('图书馆的深夜', '你好，欢迎', '一个安静的下午茶馆');
    const c = await strongFingerprint('排练厅的下午', '你好，欢迎', '完全不同的设定');
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it('weak fingerprint is name-only, so two cards that only share a name collide (by design — see design doc §11)', async () => {
    const weak1 = await weakFingerprint('小明');
    const weak2 = await weakFingerprint('小明');
    expect(weak1).toBe(weak2);
    // Different content, same name: the weak form cannot tell them apart.
    const strong1 = await strongFingerprint('小明', '第一种设定', '');
    const strong2 = await strongFingerprint('小明', '第二种设定', '');
    expect(strong1).not.toBe(strong2);
  });

  it('cardFingerprint degrades to the weak form when no card data is available (.jsonl-only import)', async () => {
    const noData = await cardFingerprint('排练厅的下午');
    expect(noData.weak).toBe(true);
    expect(noData.fp).toBe(await weakFingerprint('排练厅的下午'));

    const withData = await cardFingerprint('排练厅的下午', '你好，欢迎', '一个安静的下午茶馆');
    expect(withData.weak).toBe(false);
    expect(withData.fp).toBe(await strongFingerprint('排练厅的下午', '你好，欢迎', '一个安静的下午茶馆'));
    expect(withData.fp).not.toBe(noData.fp);
  });
});

describe('saveCardRule: incremental, per-card storage', () => {
  it('creates a new entry and merges later patches without dropping earlier keys', () => {
    let rules: CardRules | undefined;
    rules = saveCardRule(rules, 'fp1', { overrides: { 老王: { kind: 'person' } } });
    rules = saveCardRule(rules, 'fp1', { extraStopwords: ['嗯'] });
    rules = saveCardRule(rules, 'fp1', { overrides: { 茶馆: { kind: 'place' } } });
    expect(rules.fp1).toEqual({
      overrides: { 老王: { kind: 'person' }, 茶馆: { kind: 'place' } },
      extraStopwords: ['嗯'],
    });
  });

  it('keeps different cards separate', () => {
    let rules: CardRules | undefined;
    rules = saveCardRule(rules, 'fp1', { overrides: { 老王: { kind: 'person' } } });
    rules = saveCardRule(rules, 'fp2', { overrides: { 小李: { kind: 'person' } } });
    expect(Object.keys(rules).sort()).toEqual(['fp1', 'fp2']);
    expect(rules.fp1.overrides).toEqual({ 老王: { kind: 'person' } });
    expect(rules.fp2.overrides).toEqual({ 小李: { kind: 'person' } });
  });

  it('deduplicates stopwords', () => {
    let rules: CardRules | undefined;
    rules = saveCardRule(rules, 'fp1', { extraStopwords: ['嗯', '啊'] });
    rules = saveCardRule(rules, 'fp1', { extraStopwords: ['啊', '哦'] });
    expect(rules.fp1.extraStopwords.sort()).toEqual(['哦', '啊', '嗯'].sort());
  });
});

describe('applyCardRule: auto-apply on import, session always wins', () => {
  const rules: CardRules = {
    fp1: { overrides: { 老王: { kind: 'person' }, 茶馆: { display: 'Tea House' } }, extraStopwords: ['嗯', '啊'] },
  };

  it('applies a saved pack onto an empty session', () => {
    const r = applyCardRule(rules, 'fp1', {}, []);
    expect(r.overrides).toEqual(rules.fp1.overrides);
    expect(r.extraStopwords.sort()).toEqual(['嗯', '啊'].sort());
    expect(r.appliedOverrideKeys.sort()).toEqual(['老王', '茶馆'].sort());
    expect(r.appliedStopwords.sort()).toEqual(['嗯', '啊'].sort());
  });

  it("the current session's own edits are never overwritten by the saved pack", () => {
    const sessionOverrides = { 老王: { kind: 'place' as const } };   // user just re-filed 老王 this session
    const r = applyCardRule(rules, 'fp1', sessionOverrides, ['嗯']);
    expect(r.overrides.老王).toEqual({ kind: 'place' });   // session value kept, not clobbered
    expect(r.overrides.茶馆).toEqual({ display: 'Tea House' });   // still applied: no session conflict
    expect(r.appliedOverrideKeys).toEqual(['茶馆']);   // 老王 was already present, so it is not "applied"
    expect(r.appliedStopwords).toEqual(['啊']);   // 嗯 was already present
    expect(r.extraStopwords.sort()).toEqual(['嗯', '啊'].sort());
  });

  it('no fingerprint or no saved entry: a no-op that returns the session state unchanged', () => {
    const noFp = applyCardRule(rules, undefined, { x: { kind: 'person' } }, ['w']);
    expect(noFp).toEqual({ overrides: { x: { kind: 'person' } }, extraStopwords: ['w'], appliedOverrideKeys: [], appliedStopwords: [] });

    const noEntry = applyCardRule(rules, 'unknown-fp', { x: { kind: 'person' } }, ['w']);
    expect(noEntry).toEqual({ overrides: { x: { kind: 'person' } }, extraStopwords: ['w'], appliedOverrideKeys: [], appliedStopwords: [] });
  });

  it('no card rules stored at all (fresh install / weak-fp degrade) applies nothing', () => {
    const r = applyCardRule(undefined, 'fp1', {}, []);
    expect(r).toEqual({ overrides: {}, extraStopwords: [], appliedOverrideKeys: [], appliedStopwords: [] });
  });
});

describe('revertCardRule: one-click undo', () => {
  it('removes exactly the keys/words one apply call contributed', () => {
    const rules: CardRules = { fp1: { overrides: { 老王: { kind: 'person' }, 茶馆: { display: 'Tea House' } }, extraStopwords: ['嗯'] } };
    const applied = applyCardRule(rules, 'fp1', {}, []);
    const reverted = revertCardRule(applied.overrides, applied.extraStopwords, applied);
    expect(reverted.overrides).toEqual({});
    expect(reverted.extraStopwords).toEqual([]);
  });

  it('a key added independently after the apply is untouched by the undo', () => {
    const rules: CardRules = { fp1: { overrides: { 老王: { kind: 'person' } }, extraStopwords: [] } };
    const applied = applyCardRule(rules, 'fp1', {}, []);
    // The user separately overrides an unrelated word this session.
    const overridesAfterEdit = { ...applied.overrides, 茶馆: { display: 'edited by user' } };
    const reverted = revertCardRule(overridesAfterEdit, applied.extraStopwords, applied);
    expect(reverted.overrides).toEqual({ 茶馆: { display: 'edited by user' } });
  });

  it('is a no-op when nothing was applied', () => {
    const reverted = revertCardRule({ a: { kind: 'person' } }, ['x'], { appliedOverrideKeys: [], appliedStopwords: [] });
    expect(reverted).toEqual({ overrides: { a: { kind: 'person' } }, extraStopwords: ['x'] });
  });
});

describe('resolveCardRules: strong fingerprint first, weak only as a fallback', () => {
  const weak = 'weak-fp';
  const strong = 'strong-fp';
  const entry = (word: string) => ({ overrides: { [word]: { kind: 'person' as const } }, extraStopwords: [word] });

  it('prefers the strong entry when both are stored', () => {
    const rules: CardRules = { [weak]: entry('弱'), [strong]: entry('强') };
    const m = resolveCardRules(rules, strong, weak);
    expect(m).toEqual({ fp: strong, via: 'strong', rules });
    // The weak pack must not bleed in: only this card's own fixes are applied.
    expect(applyCardRule(m.rules, m.fp, {}, []).appliedOverrideKeys).toEqual(['强']);
  });

  it('two different cards sharing a name do not share a pack', async () => {
    const a = await strongFingerprint('小明', '第一种设定', '');
    const b = await strongFingerprint('小明', '第二种设定', '');
    const weakFp = await weakFingerprint('小明');
    // Card A's fixes were saved under its own strong fingerprint; nothing was ever saved weakly.
    const m = resolveCardRules({ [a]: entry('A的修正') }, b, weakFp);
    expect(m.via).toBe('none');
    expect(m.fp).toBe(b);
    expect(applyCardRule(m.rules, m.fp, {}, []).appliedOverrideKeys).toEqual([]);
  });

  it('migrates an old weak-only entry onto the strong fingerprint and keeps the weak one', () => {
    const m = resolveCardRules({ [weak]: entry('老王') }, strong, weak);
    expect(m.fp).toBe(strong);
    // Hedged: a same-name match is not proof it is the same card.
    expect(m.via).toBe('weak');
    expect(m.rules[strong]).toEqual(entry('老王'));
    // The weak entry survives, so a later name-only (.jsonl) import still finds it.
    expect(m.rules[weak]).toEqual(entry('老王'));
    // Copied by value: editing one entry must not edit the other.
    expect(m.rules[strong]).not.toBe(m.rules[weak]);
    expect(applyCardRule(m.rules, m.fp, {}, []).appliedOverrideKeys).toEqual(['老王']);
  });

  it('a migrated card saves later edits under the strong fingerprint only', () => {
    const migrated = resolveCardRules({ [weak]: entry('老王') }, strong, weak);
    const after = saveCardRule(migrated.rules, migrated.fp, { overrides: { 茶馆: { kind: 'place' } } });
    expect(Object.keys(after[strong].overrides).sort()).toEqual(['老王', '茶馆'].sort());
    expect(Object.keys(after[weak].overrides)).toEqual(['老王']);
  });

  it('with no card data the weak fingerprint is still used', () => {
    const rules: CardRules = { [weak]: entry('老王') };
    const m = resolveCardRules(rules, undefined, weak);
    expect(m).toEqual({ fp: weak, via: 'weak', rules });
    expect(applyCardRule(m.rules, m.fp, {}, []).appliedOverrideKeys).toEqual(['老王']);
  });

  it('nothing saved: reports no match and still names the fingerprint to save under', () => {
    expect(resolveCardRules({}, strong, weak)).toEqual({ fp: strong, via: 'none', rules: {} });
    expect(resolveCardRules(undefined, undefined, weak)).toEqual({ fp: weak, via: 'none', rules: {} });
  });
});

/**
 * The strong fingerprint needs `first_mes`/`description`, which are the card author's narrative
 * text. They may be read into memory to be hashed and nothing else: notes/docs/23 §3 lists them
 * as never-transmitted, so they must not reach `DataBundle`, the worker reply, the contribute
 * payload (which reads only counts off `DataBundle`), a share link, or an exported JSON.
 */
describe('card text is hashed and dropped, never carried', () => {
  const FIRST_MES = '开场白独有句子甲';
  const DESCRIPTION = '角色设定独有句子乙';

  function cardPng(name: string, firstMes: string, description: string): Uint8Array {
    const png = new PNG({ width: 2, height: 2 });
    png.data.fill(200);
    const card = {
      spec: 'chara_card_v2',
      data: { name, first_mes: firstMes, description, character_book: { entries: [{ keys: ['排练厅'] }] } },
    };
    const b64 = Buffer.from(JSON.stringify(card), 'utf8').toString('base64');
    return embedText(new Uint8Array(PNG.sync.write(png)), 'chara', b64);
  }

  const zip = () => zipSync({
    'default-user/characters/排练厅的下午.png': cardPng('排练厅的下午', FIRST_MES, DESCRIPTION),
    'default-user/chats/排练厅的下午/聊天 - 2026-01-01@00h00m00s000ms.jsonl': strToU8(
      [JSON.stringify({ user_name: '我', character_name: '排练厅的下午' }),
        JSON.stringify({ name: '我', is_user: true, mes: '通告单递给制片主任。' })].join('\n'),
    ),
  });

  it('readDataBundle hands the fields to the callback but keeps them off the bundle', () => {
    const seen: CardIdentity[] = [];
    const bundle = readDataBundle(zip(), undefined, (c) => seen.push(c));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ name: '排练厅的下午', fileName: '排练厅的下午', firstMes: FIRST_MES, description: DESCRIPTION });
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain(FIRST_MES);
    expect(serialized).not.toContain(DESCRIPTION);
    expect(bundle.characterCards).toBe(1);
  });

  it('the worker reply carries the hash only — no card text in any posted message', async () => {
    const posted: WorkerResponse[] = [];
    const handle = createHandler((m) => posted.push(m));
    const data = zip();
    await handle({ id: 1, kind: 'loadBundle', name: 'export.zip', data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer });
    const reply = posted.find((m) => !m.progress && m.ok && m.kind === 'bundle');
    expect(reply).toBeTruthy();
    const fps = (reply as Extract<WorkerResponse, { kind: 'bundle' }>).cardFingerprints;
    expect(fps[normalizeCardName('排练厅的下午')]).toBe(await strongFingerprint('排练厅的下午', FIRST_MES, DESCRIPTION));
    // Not the weak, name-only form: same-name cards must land on different fingerprints.
    expect(fps[normalizeCardName('排练厅的下午')]).not.toBe(await weakFingerprint('排练厅的下午'));
    const everything = JSON.stringify(posted);
    expect(everything).not.toContain(FIRST_MES);
    expect(everything).not.toContain(DESCRIPTION);
  });

  it('share links and exported JSON never see the card text', async () => {
    const words = [{ text: '排练厅', count: 12 }];
    const share = await encodeSharePayload({ theme: 'sunset', words });
    expect(share).not.toContain(FIRST_MES);
    expect(share).not.toContain(DESCRIPTION);
    const json = await wordsToJson(words, { card: '排练厅的下午', mode: 'freq', total: 1 }).text();
    expect(json).not.toContain(FIRST_MES);
    expect(json).not.toContain(DESCRIPTION);
    // The card *name* is legitimately part of an export the user asked for; the text behind the hash is not.
    expect(JSON.parse(json).card).toBe('排练厅的下午');
  });
});

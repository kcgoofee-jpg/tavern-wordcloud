import { describe, expect, it } from 'vitest';
import {
  applyCardRule, cardFingerprint, normalizeCardName, revertCardRule, saveCardRule,
  strongFingerprint, weakFingerprint, type CardRules,
} from '../src/core/cardRules';

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

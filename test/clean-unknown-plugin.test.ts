/**
 * Structural unknown-plugin cases. Plugin tag *names* are not part of the
 * allowlist; a CJK / colon-prefixed wrapper must die the same way as ASCII.
 * Independent file so clean.test.ts stays frozen (2026-09-05).
 */
import { describe, expect, it } from 'vitest';
import { analyze, DEFAULT_ANALYZE_OPTIONS } from '../src/core/analyze';
import { cleanMessageText, DEFAULT_CLEAN_OPTIONS } from '../src/core/clean';

const clean = (s: string) => cleanMessageText(s, DEFAULT_CLEAN_OPTIONS);

function jsonl(mes: string): string {
  return [
    JSON.stringify({ user_name: 'unused', character_name: 'unused', chat_metadata: {} }),
    JSON.stringify({ name: '沈砚秋', is_user: false, mes }),
  ].join('\n');
}

describe('CJK / non-ASCII custom tags (unknown-plugin round 1)', () => {
  it('paired CJK tags drop inner status words, keep prose', () => {
    const out = clean('<状态栏>好感 99 地点 排练厅 金币 5000</状态栏>她推开门。');
    expect(out).toContain('她推开门');
    expect(out).not.toContain('好感');
    expect(out).not.toContain('排练厅');
    expect(out).not.toContain('金币');
    expect(out).not.toContain('状态栏');
  });

  it('an unclosed CJK tag is cut to the end', () => {
    const out = clean('她推开门。<状态栏>好感 99 金币 5000');
    expect(out).toContain('她推开门');
    expect(out).not.toContain('好感');
    expect(out).not.toContain('金币');
  });

  it('an orphan CJK closing tag cuts the prefix', () => {
    const out = clean('好感 99 地点 排练厅</状态栏>她推开门。');
    expect(out).toContain('她推开门');
    expect(out).not.toContain('好感');
    expect(out).not.toContain('排练厅');
  });

  it('a malformed CJK open (fullwidth colon in the name) still yields to the orphan close', () => {
    const out = clean('<沉浸模块：显示电视画面</沉浸模块>奥运会开幕式还没放完。');
    expect(out).toContain('奥运会开幕式还没放完');
    expect(out).not.toContain('沉浸模块');
    expect(out).not.toContain('电视画面');
  });

  it('CJK self-closing tags are removed', () => {
    const out = clean('她推开门。<状态栏/>屋里没人。');
    expect(out).toContain('她推开门');
    expect(out).toContain('屋里没人');
    expect(out).not.toContain('状态栏');
  });

  it('colon-prefixed tags are custom, not HTML', () => {
    const out = clean('对话。<:面板>好感 99 金币 5000</:面板>还是对话。');
    expect(out).toContain('对话');
    expect(out).toContain('还是对话');
    expect(out).not.toContain('好感');
    expect(out).not.toContain('金币');
  });

  it('standard HTML still keeps inner text; CJK prose without tags is kept', () => {
    expect(clean('他<b>很快</b>就走了')).toContain('很快');
    expect(clean('她推开门。好感这种事以后再说。')).toContain('好感');
  });

  it('a comparison is not a tag', () => {
    expect(clean('人数 3 < 5 才走。')).toContain('才走');
    expect(clean('人数 3 < 5 才走。')).toContain('3');
  });

  it('analyze() does not put CJK plugin fields in the cloud', () => {
    const mes = '<状态栏>好感 99 地点 排练厅 金币 5000</状态栏>沈砚秋推开门，周敬亭坐在沙发上。';
    const r = analyze(
      [{ name: '测试卡 - 2026-08-31@20h00m08s527ms.jsonl', content: jsonl(mes) }],
      {
        ...DEFAULT_ANALYZE_OPTIONS,
        roles: ['user', 'char'],
        tokenize: { ...DEFAULT_ANALYZE_OPTIONS.tokenize, minCount: 1, minLength: 2 },
      },
    );
    const bag = r.words.map((w) => w.text).join(' ');
    expect(bag).toMatch(/开门|沙发/);
    expect(bag).not.toMatch(/好感|排练厅|金币|状态栏/);
  });

  it('a wall of incomplete CJK openers returns in well under 200 ms', () => {
    const wall = '<状'.repeat(50_000);
    const t0 = Date.now();
    const out = clean(wall);
    expect(Date.now() - t0).toBeLessThan(200);
    expect(out.length).toBeGreaterThan(0);
  });
});

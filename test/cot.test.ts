/** Reasoning-trace cloud: the two extra cleaning rules. */
import { describe, expect, it } from 'vitest';
import { cleanMessageText, DEFAULT_CLEAN_OPTIONS } from '../src/core/clean';
import { cleanReasoning, findBoilerplate, stripJsonLines, COT_SCHEMA_STOPWORDS } from '../src/core/cot';
import { analyze, DEFAULT_ANALYZE_OPTIONS } from '../src/core/analyze';

describe('JSON residue', () => {
  it('consecutive JSON key/value lines are removed', () => {
    const t = '他在想这件事。\n"type": "string",\n"value": 42,\n"check": true,\n然后继续想。';
    const out = stripJsonLines(t);
    expect(out).toContain('他在想这件事');
    expect(out).toContain('然后继续想');
    expect(out).not.toContain('"type"');
    expect(out).not.toContain('"check"');
  });

  it('an isolated line is kept', () => {
    const t = '他在想这件事。\n原因: 他走了\n然后继续想。';
    expect(stripJsonLines(t)).toContain('原因');
  });

  it('lines with Chinese are not JSON', () => {
    const t = '"标题": "待定",\n"引言": "待定",\n"备注": "待定",';
    expect(stripJsonLines(t)).toContain('标题');
  });

  it('schema keywords are stop words', () => {
    expect(COT_SCHEMA_STOPWORDS).toContain('string');
    expect(COT_SCHEMA_STOPWORDS).toContain('value');
  });
});

describe('cross-trace template detection', () => {
  it('sentences present in every trace are detected', () => {
    const texts = Array.from({ length: 10 }, (_, i) =>
      `你现在是一个娱乐圈新人，处于一个模拟真实世界的环境里。\n这一轮我要处理第 ${i} 件事。`);
    const bp = findBoilerplate(texts);
    expect([...bp].some((s) => s.includes('你现在是一个'))).toBe(true);
    expect([...bp].some((s) => s.includes('第 0 件事'))).toBe(false);
  });

  it('too few traces: no template decision', () => {
    expect(findBoilerplate(['一样的话。', '一样的话。', '别的话。']).size).toBe(0);
  });

  it('paraphrased prompts are not detected (known limit)', () => {
    // Real logs had 0 template hits; the rule stays for plugins that inject identical blocks every turn.
    const texts = Array.from({ length: 10 }, (_, i) =>
      `第 ${i} 轮：世界书说要收录作品，我把它记下来。`);
    expect(findBoilerplate(texts).size).toBe(0);
  });
});

describe('batch cleaning', () => {
  it('reuses the base cleaner plus the two CoT rules', () => {
    const raw = [
      '<fate_ui>状态块</fate_ui>他在想剧情该怎么走。\n"type": "string",\n"value": 1,\n"check": true,',
      '<fate_ui>状态块</fate_ui>他在想角色的动机。\n"type": "string",\n"value": 2,\n"check": true,',
    ];
    const r = cleanReasoning(raw, (t) => cleanMessageText(t, DEFAULT_CLEAN_OPTIONS));
    expect(r.texts.join('')).toContain('剧情该怎么走');
    expect(r.texts.join('')).not.toContain('状态块');
    expect(r.texts.join('')).not.toContain('"type"');
    expect(r.cleanChars).toBeLessThan(r.rawChars);
  });
});

describe('cloud source switch', () => {
  const mk = (mes: string, reasoning: string, model: string) =>
    JSON.stringify({ name: '角色', is_user: false, mes, extra: { reasoning, model, api: 'custom' } });
  const content = [
    JSON.stringify({ user_name: 'unused', character_name: 'unused', chat_metadata: {} }),
    mk('他推开门走了进去。', '我要让他推开门，这样才能引出下一段。先更新地点状态。', 'model-a'),
    mk('她合上本子。', '她合上本子这个动作要呼应前面。再更新一次状态。', 'model-a'),
    mk('窗外下起了雨。', '下雨是为了压气氛。状态里的天气也要跟着更新。', 'model-b'),
  ].join('\n');
  const files = [{ name: '测试卡 - 2026-08-31@20h00m08s527ms.jsonl', content }];
  const base = {
    ...DEFAULT_ANALYZE_OPTIONS,
    roles: ['char'] as ('char')[],
    tokenize: { ...DEFAULT_ANALYZE_OPTIONS.tokenize, minCount: 1, minLength: 2 },
  };

  it('message text by default', () => {
    const r = analyze(files, base);
    expect(r.words.map((w) => w.text)).toContain('本子');
    // 状态 occurs only in reasoning traces
    expect(r.words.map((w) => w.text)).not.toContain('状态');
  });

  it('reasoning source counts reasoning traces', () => {
    const r = analyze(files, { ...base, source: 'reasoning' });
    // 更新状态 occurs only in reasoning traces
    expect(r.words.map((w) => w.text)).toContain('状态');
  });

  it('reports trace count and models', () => {
    const r = analyze(files, base);
    expect(r.cot.available).toBe(3);
    expect(r.cot.models.sort()).toEqual(['model-a', 'model-b']);
  });

  it('can restrict reasoning traces to one model', () => {
    const all = analyze(files, { ...base, source: 'reasoning' });
    const one = analyze(files, { ...base, source: 'reasoning', onlyModel: 'model-b' });
    expect(one.totalTokens).toBeLessThan(all.totalTokens);
    expect(one.words.map((w) => w.text)).toContain('天气');
  });

  it('reports 0 when there are no reasoning traces', () => {
    const plain = [{
      name: 'x - 2026-08-31@20h00m08s527ms.jsonl',
      content: JSON.stringify({ name: '角色', is_user: false, mes: '他走了。' }),
    }];
    expect(analyze(plain, base).cot.available).toBe(0);
  });
});

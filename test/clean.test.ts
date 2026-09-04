import { describe, expect, it } from 'vitest';
import { cleanMessageText, DEFAULT_CLEAN_OPTIONS, stripRepeatedLines } from '../src/core/clean';

const clean = (s: string) => cleanMessageText(s, DEFAULT_CLEAN_OPTIONS);

describe('cleaning', () => {
  it('removes custom tag blocks, keeps text', () => {
    const out = clean('他推开门。\n<fate_ui>\n:::schedule\n{程|08-09|试戏}\n:::\n</fate_ui>\n屋里没人。');
    expect(out).toContain('他推开门');
    expect(out).toContain('屋里没人');
    expect(out).not.toContain('schedule');
    expect(out).not.toContain('试戏');
  });

  it('removes self-closing plugin placeholders', () => {
    expect(clean('[通告单]\n\n<StatusPlaceHolderImpl/>\n正文')).not.toContain('StatusPlaceHolder');
  });

  it('removes reasoning blocks', () => {
    const out = clean('<thinking>我该怎么回</thinking>他说：好。');
    expect(out).not.toContain('我该怎么回');
    expect(out).toContain('他说');
  });

  it('standard HTML tags are stripped, text kept', () => {
    expect(clean('他<b>很快</b>就走了')).toContain('很快');
    expect(clean('他<b>很快</b>就走了')).not.toContain('<b>');
  });

  it('numeric entities decode; out-of-range values do not throw', () => {
    expect(clean('A&#65;B')).toContain('AAB');
    expect(clean('&#x4e16;界')).toContain('世界');
    expect(() => clean('&#999999999;还在')).not.toThrow();
    expect(clean('&#999999999;还在')).toContain('还在');
    expect(() => clean('&#x110000;还在')).not.toThrow();
  });

  it('an unclosed custom tag is cut to the end', () => {
    // A real log had </fate_ui> misspelled as </fite_ui>, defeating pair matching
    const out = clean('正文在这里。\n<fate_ui>\n一大堆状态数据\n没有闭合标签');
    expect(out).toContain('正文在这里');
    expect(out).not.toContain('状态数据');
  });

  it('an orphan closing custom tag cuts everything before it', () => {
    // A real log: the reply began mid-block, so only the closing tags survived
    const out = clean('已抹除列表键值写入实时。\n</status_current_variables>\n<沉浸模块：显示电视画面</沉浸模块></think>奥运会开幕式还没放完。');
    expect(out).not.toContain('抹除列表');
    expect(out).not.toContain('沉浸模块');
    expect(out).toContain('奥运会开幕式还没放完');
  });

  it('an orphan closing standard HTML tag does not cut prose', () => {
    const out = clean('她推开门。</b>屋里没人。');
    expect(out).toContain('她推开门');
    expect(out).toContain('屋里没人');
  });

  it('unknown plugin tags are removed (allowlist)', () => {
    const out = clean('对话。<SomeFuturePluginBlock>垃圾数据</SomeFuturePluginBlock>还是对话。');
    expect(out).not.toContain('垃圾数据');
    expect(out).toContain('还是对话');
  });

  it('markdown emphasis is stripped, text kept', () => {
    // *action* is narration in SillyTavern; the text must be kept
    const out = clean('*他慢慢站起来*，说：“走吧。”');
    expect(out).toContain('他慢慢站起来');
    expect(out).not.toContain('*');
  });

  it('removes macros, links, code blocks and OOC', () => {
    expect(clean('{{user}}走了')).not.toContain('user');
    expect(clean('看这里 https://example.com/x 结束')).not.toContain('example.com');
    expect(clean('```json\n{"a":1}\n```\n正文')).not.toContain('json');
    expect(clean('[OOC: 我想换个方向]他点头。')).not.toContain('换个方向');
    expect(clean('见[这篇](https://a.b)文章')).toContain('这篇');
  });

  it('removes table / status lines, keeps prose', () => {
    const out = clean('| 属性 | 值 |\n|---|---|\n| 体力 | 80 |\n他站起来。');
    expect(out).toContain('他站起来');
    expect(out).not.toContain('体力');
  });

  it('empty input', () => {
    expect(clean('')).toBe('');
  });
});

describe('bare JSON blocks', () => {
  it('untagged variable patches are removed; bracketed text is kept', () => {
    const mes = '她点点头。\n[ { "op": "insert", "path": "/私有档案/存活母畜", "value": { "年龄": 25, "长相": "圆润鹅蛋脸" } } ]\n[拍摄通告单] 明天早上八点。';
    const out = cleanMessageText(mes, DEFAULT_CLEAN_OPTIONS);
    expect(out).not.toMatch(/insert|path|value|鹅蛋脸/);
    expect(out).toContain('她点点头');
    expect(out).toContain('[拍摄通告单] 明天早上八点');
  });
  it('brackets inside strings do not affect matching', () => {
    const mes = '前文 {"a": "含 } 和 ] 的字符串", "b": [1, 2, {"c": "x"}]} 后文';
    expect(cleanMessageText(mes, DEFAULT_CLEAN_OPTIONS).replace(/\s+/g, ' ').trim()).toBe('前文 后文');
  });
});

describe('scaffolding blocks', () => {
  it('removes <details> blocks whose summary is a meta label, keeps others', () => {
    const t = '正文一句。<details><summary>摘要</summary>这是被折叠的摘要内容</details>' +
      '<details><summary>信件</summary>亲爱的沈砚秋</details>';
    const out = cleanMessageText(t, DEFAULT_CLEAN_OPTIONS);
    expect(out).toContain('正文一句');
    expect(out).not.toContain('摘要内容');
    expect(out).toContain('亲爱的沈砚秋');
  });
  it('removes plain key/value status blocks but keeps speaker-style dialogue', () => {
    const status = '时间：清晨\n地点：宿舍\n好感度：45\n心情：平静\n';
    const dialogue = '沈砚秋：你来了。\n周敬亭：嗯。\n沈砚秋：坐吧。\n';
    const out = cleanMessageText(status + '她推开门。\n' + dialogue, DEFAULT_CLEAN_OPTIONS);
    expect(out).not.toContain('宿舍');
    expect(out).not.toContain('好感度');
    expect(out).toContain('她推开门');
    expect(out).toContain('你来了');
    expect(out).toContain('坐吧');
  });
  it('removes a bracket-labelled status header without a colon', () => {
    const out = cleanMessageText(
      '[当前时间] 2008-08-08 周五 22:10\n[当前地点] 中国-北京-朝阳区某居民楼-闷热无风\n\n窗外传来烟花的闷响。',
      DEFAULT_CLEAN_OPTIONS,
    );
    expect(out).not.toContain('朝阳区');
    expect(out).not.toContain('2008-08-08');
    expect(out).toContain('窗外传来烟花的闷响');
  });
  it('keeps bracketed speaker lines that carry no status field', () => {
    const out = cleanMessageText('【高飞】 我不去。\n【沈砚秋】 你去。\n', DEFAULT_CLEAN_OPTIONS);
    expect(out).toContain('我不去');
    expect(out).toContain('你去');
  });
  it('does not remove two isolated label lines', () => {
    const out = cleanMessageText('时间：清晨\n她推开门。\n地点：宿舍\n', DEFAULT_CLEAN_OPTIONS);
    expect(out).toContain('清晨');
    expect(out).toContain('宿舍');
  });
});

describe('repeated lines across messages', () => {
  it('removes a header line present in most messages, keeps dialogue', () => {
    const texts = Array.from({ length: 8 }, (_, i) => `【本轮状态更新】\n她说了第${i}句话。`);
    const out = stripRepeatedLines(texts);
    expect(out.every((t) => !t.includes('本轮状态更新'))).toBe(true);
    expect(out[3]).toContain('第3句话');
  });
  it('does nothing below the minimum batch size', () => {
    const texts = ['【本轮状态更新】\n甲', '【本轮状态更新】\n乙', '【本轮状态更新】\n丙'];
    expect(stripRepeatedLines(texts)).toEqual(texts);
  });
});

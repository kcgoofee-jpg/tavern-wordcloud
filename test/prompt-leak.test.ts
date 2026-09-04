/** Preset framing must not enter the cloud; frequent names must be recognized. Derived from a user's manual-hide list. */
import { describe, expect, it } from 'vitest';
import { cleanMessageText, DEFAULT_CLEAN_OPTIONS, unwrapUserInput } from '../src/core/clean';
import { detectEntities, classify, systemWords } from '../src/core/entities';
import { buildStopwords } from '../src/core/stopwords';

/** Shape of a real preset wrapper: 11 characters of content inside 700+ of framing */
const WRAPPED = `以下是用户的本轮输入：
<本轮用户输入>
假装还有最后一题没写完
</本轮用户输入>

以下输入的代码为接下来剧情相关记忆条目的对应的索引编码。注意它们仅为相关的过去记忆，你要结合它们里边的信息合理生成接下来的剧情：
<recall>
# 记忆召回
AM0001（父亲制定疏导计划）
</recall>
<supplement>
# 补充信息
- [背景设定] 某某当前抵抗值 100
</supplement>`;

describe('preset framing', () => {
  it('keeps only the wrapper content', () => {
    expect(unwrapUserInput(WRAPPED)).toBe('假装还有最后一题没写完');
  });

  it("only the user's own sentence remains", () => {
    const out = cleanMessageText(WRAPPED, DEFAULT_CLEAN_OPTIONS);
    expect(out).toBe('假装还有最后一题没写完');
    // Each word the user had to hide manually
    for (const junk of ['本轮用户', '索引编码', '相关记忆条目', '仅为相关', '信息合理生成', '你要结合']) {
      expect(out).not.toContain(junk);
    }
  });

  it.each([
    '<user_input>hello there</user_input>',
    '<用户输入>你好</用户输入>',
    '<current_input>hi</current_input>',
  ])('认得出各种写法的包裹标签：%s', (s) => {
    expect(unwrapUserInput(s).length).toBeLessThan(s.length);
  });

  it('messages without a wrapper are unchanged', () => {
    const plain = '他把那枚袖扣推过来的时候，我没接。';
    expect(unwrapUserInput(plain)).toBe(plain);
    expect(cleanMessageText(plain, DEFAULT_CLEAN_OPTIONS)).toBe(plain);
  });
});

describe('name detection: enough hits in one position count', () => {
  /** Only the possessive position, but many times, as in real logs */
  const many = Array.from({ length: 12 }, (_, i) =>
    `许婉如的眼睛看着窗外第${i}次。许婉如的手放在桌上。`).join('\n');
  const idx = detectEntities([many], systemWords([]));

  it('a frequent single position is enough', () => {
    expect(idx.personNames).toContain('许婉如');
    expect(classify('许婉如', idx)).toBe('person');
  });

  it('a rare single position still does not count', () => {
    const few = detectEntities(['蓝色的眼睛。蓝色的手。蓝色的脸。'], systemWords([]));
    expect(few.personNames).not.toContain('蓝色');
  });

  it('kinship terms are not names', () => {
    const kin = Array.from({ length: 12 }, () => '母亲的眼睛。母亲的手。妈妈的声音。').join('\n');
    const k = detectEntities([kin], systemWords([]));
    for (const w of ['母亲', '妈妈']) expect(k.personNames).not.toContain(w);
  });
});

describe('function words', () => {
  const stop = buildStopwords([], true, true);
  it.each(['这种', '那种', '一种', '甚至', '里边', '死死', '紧紧', '一点', '其实',
    // Generated demonstrative + classifier combos and the degree / position lists
    '那只', '那片', '一股', '每个', '这双', '两条', '极度', '几乎', '顺着', '后方', '刚刚', '原本'])(
    '%s 是停用词', (w) => expect(stop.has(w)).toBe(true));

  /** Words deliberately not added to the stop list. 片场 / 股份 / 条件 share a character with a classifier and must survive the generator. */
  it.each(['状态', '想法', '母亲', '成绩', '厨房', '片场', '股份', '条件', '内部', '中心'])(
    '%s **不是**停用词——它们有内容，不能顺手滤掉', (w) => expect(stop.has(w)).toBe(false));
});

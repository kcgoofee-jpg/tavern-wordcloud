/** docs/33 batch 4: additive tags below `event`. Independent of clean.test.ts. */
import { describe, expect, it } from 'vitest';
import { classify, classifyKinds, detectEntities } from '../src/core/entities';

const story = [
  '沈砚秋把音量拧小，"明天带你去试一个角色。"她说。',
  '沈高飞咬了口鸡蛋，目光落在那档案袋上。',
  '"郑叔叔好。"沈高飞说。郑晓龙笑了一下，没再跟他搭话。',
  '沈砚秋点点头，沈高飞抬头看她。',
  '周敬亭的声音从走廊那头传过来，"高飞，你过来。"',
  '沈砚秋说：好。沈高飞说：好。周敬亭问：真的吗。',
  '和周敬亭说过之后，沈砚秋皱了皱眉。',
  '周敬亭看了看他，周敬亭点点头。',
  '沈高飞的眼睛盯着桌上那份合同，忽然觉得有点冷。',
  '但他知道，这件事没那么简单。然后他站起来走到窗边。',
];

const empty = detectEntities([]);

describe('docs/33 batch 4: additive kinds below event', () => {
  it('the suffix / closed rules hit their class and reject the confusables', () => {
    const kinds = (w: string) => classifyKinds(w, empty).map((k) => k.kind);
    const cases: [string, string[], string[]][] = [
      ['onomatopoeia', ['砰砰', '咚咚', '嗡嗡', '哗啦', '叮当', '咔嚓'], ['哥哥', '爸爸', '往往', '渐渐']],
      ['measure', ['厘米', '公斤', '毫升', '公里', '千克', '摄氏度'], ['米饭', '米粒', '过来', '温度']],
      ['ethnicity', ['中国人', '法国人', '汉族', '精灵族', '兽人', '魔族'], ['工人', '主人', '家人', '大人', '女人', '男人']],
      ['rank', ['上校', '中尉', '伯爵', '公爵', '筑基期', '金丹期'], ['阶级', '超级', '等级', '时期', '长期', '陛下']],
      ['law', ['法律', '刑法', '条款', '谋杀罪', '违约', '诉讼'], ['办法', '想法', '看法', '说法', '方法', '法院']],
      ['number', ['三十万', '一百', '两千', '上百', '成千上万', '半数', '三成', '百分之十', '三个', '四张'], ['一个', '几个', '一些', '第一', '完成', '成功']],
      ['region', ['朝阳区', '开发区', '中国', '美国', '河北省', '上海市', '四川省'], ['误区', '社区', '时区', '音区', '办公室', '联合国', '超市', '市场']],
      ['path', ['高速公路', '立交桥', '人行道', '马路', '街道', '地铁站'], ['门口', '胸口', '虎口', '接口', '知道', '味道']],
    ];
    for (const [kind, pos, neg] of cases) {
      for (const w of pos) expect(kinds(w), `${kind}+ ${w}`).toContain(kind);
      for (const w of neg) expect(kinds(w), `${kind}- ${w}`).not.toContain(kind);
    }
  });

  it('朝阳区 stays place and also gains region', () => {
    expect(classify('朝阳区', empty)).toBe('place');
    expect(classifyKinds('朝阳区', empty).map((k) => k.kind)).toContain('region');
  });

  it('周敬亭 stays person, not building or path', () => {
    const e = detectEntities(story);
    expect(e.personNames).toContain('周敬亭');
    expect(classify('周敬亭', e)).toBe('person');
    const tags = classifyKinds('周敬亭', e).map((k) => k.kind);
    expect(tags).not.toContain('building');
    expect(tags).not.toContain('path');
  });

  it('工人 is an occupation, not an ethnicity', () => {
    expect(classifyKinds('工人', empty).map((k) => k.kind)).toContain('occupation');
    expect(classifyKinds('工人', empty).map((k) => k.kind)).not.toContain('ethnicity');
  });

  it('batch 4 never outranks an existing kind', () => {
    expect(classify('朝阳区', empty)).toBe('place');
    expect(classify('马路', empty)).toBe('place');
    expect(classify('高速公路', empty)).toBe('place');
    expect(classify('车站', empty)).toBe('place');
    expect(classify('办公室', empty)).toBe('place');
    expect(classify('大桥', empty)).toBe('building');
    expect(classify('立交桥', empty)).toBe('building');
    expect(classify('筑基', empty)).toBe('martial');
    expect(classify('陛下', empty)).toBe('title');
    expect(classify('米饭', empty)).toBe('food');
    expect(classify('味道', empty)).toBe('smell');
    expect(classify('门口', empty)).toBe('place');
    expect(classifyKinds('马路', empty).map((k) => k.kind)).toContain('path');
    expect(classifyKinds('立交桥', empty).map((k) => k.kind)).toContain('path');
    expect(classifyKinds('大桥', empty).map((k) => k.kind)).not.toContain('path');
    expect(classifyKinds('筑基', empty).map((k) => k.kind)).not.toContain('rank');
    expect(classifyKinds('陛下', empty).map((k) => k.kind)).not.toContain('rank');
    expect(classifyKinds('法院', empty).map((k) => k.kind)).not.toContain('law');
  });
});

/** Entity layer: names bypass cohesion (沈高飞 358 vs 高飞 1789 = 0.20) and can be hidden as a kind. */
import { describe, expect, it } from 'vitest';
import { classify, classifyKinds, detectCoref, detectEntities, looksLikePerson, systemWords } from '../src/core/entities';
import { analyze, DEFAULT_ANALYZE_OPTIONS } from '../src/core/analyze';

const story = [
  '沈砚秋把音量拧小，"明天带你去试一个角色。"她说。',
  '沈高飞咬了口鸡蛋，目光落在那档案袋上。',
  '"郑叔叔好。"沈高飞说。郑晓龙笑了一下，没再跟他搭话。',
  '沈砚秋点点头，沈高飞抬头看她。',
  '周敬亭的声音从走廊那头传过来，"高飞，你过来。"',
  '沈砚秋说：好。沈高飞说：好。周敬亭问：真的吗。',
  '和周敬亭说过之后，沈砚秋皱了皱眉。',
  '沈高飞的眼睛盯着桌上那份合同，忽然觉得有点冷。',
  '但他知道，这件事没那么简单。然后他站起来走到窗边。',
];

describe('entity detection', () => {
  it('names need three or more syntactic positions', () => {
    const e = detectEntities(story);
    expect(e.personNames).toContain('沈砚秋');
    expect(e.personNames).toContain('沈高飞');
    // Hit only one or two patterns: narration, not names
    expect(e.personNames).not.toContain('忽然觉得');
    expect(e.personNames).not.toContain('但他知');
    expect(e.personNames).not.toContain('然后');
  });

  it('reports patterns hit per name', () => {
    const e = detectEntities(story);
    expect(e.personConfidence.get('沈高飞')).toBeGreaterThanOrEqual(3);
  });

  it('persona and card names are system words', () => {
    const e = detectEntities(story, ['goofy', '逐梦演艺圈4.2']);
    expect(classify('goofy', e)).toBe('system');
    expect(classify('逐梦演艺圈4.2', e)).toBe('system');
  });

  it('time and place fall back to morphology', () => {
    const e = detectEntities(story);
    expect(classify('2008年', e)).toBe('time');
    expect(classify('下午', e)).toBe('time');
    expect(classify('办公室', e)).toBe('place');
    // 合同 used to stand in for "an ordinary noun with no kind"; since docs/33's
    // batch 3 it is a 文书, so the stand-in has to be a word no rule reaches.
    expect(classify('筷子', e)).toBe('plain');
  });

  /* ---------- F10: a word can carry several kinds ---------- */

  it('kinds are sorted by confidence and kind is the strongest one', () => {
    const e = detectEntities(story);
    for (const w of ['办公室', '下午', '衬衫', '老板', '天宇集团']) {
      const tags = classifyKinds(w, e);
      expect(tags.length, w).toBeGreaterThan(0);
      expect(tags.map((k) => k.conf)).toEqual([...tags.map((k) => k.conf)].sort((a2, b2) => b2 - a2));
      expect(classify(w, e), w).toBe(tags[0].kind);
    }
  });

  it('a title built on a surname is both a person and a title', () => {
    const e = detectEntities(story);
    const tags = classifyKinds('赵总', e).map((k) => k.kind);
    expect(tags).toContain('person');
    expect(tags).toContain('title');
    // The person tag wins, so nothing that used to be a person changes label.
    expect(classify('赵总', e)).toBe('person');
  });

  it('bare terms of address are titles, ordinary nouns are not', () => {
    const e = detectEntities(story);
    for (const w of ['陛下', '殿下', '大人', '老板', '导演', '女士']) expect(classify(w, e), w).toBe('title');
    for (const w of ['名字', '项目', '消息', '筷子']) expect(classify(w, e), w).toBe('plain');
  });

  /* ---------- docs/33 batch 3: the 20 kinds that take the design from 25 to 45 ---------- */

  it('the batch-3 suffix rules hit their class and reject the confusables built on the same characters', () => {
    const e = detectEntities(story);
    const kinds = (w: string) => classifyKinds(w, e).map((k) => k.kind);
    const cases: [string, string[], string[]][] = [
      ['plant', ['槐树', '树叶', '树枝', '玫瑰'], ['潦草', '起草', '爆竹', '烟花']],
      ['weather', ['暴雨', '大雪', '台风', '闪电'], ['血雨', '作风', '中风', '通风']],
      ['device', ['洗衣机', '遥控器', '手机', '屏幕'], ['危机', '时机', '器官', '直升机']],
      ['weapon', ['手枪', '长剑', '盾牌', '子弹'], ['矛盾', '开枪', '鞭炮', '反弹']],
      ['sound', ['脚步声', '笑声', '巨响', '嗓音'], ['名声', '影响', '大声', '低声']],
      ['smell', ['香味', '血腥味', '幽香', '气味'], ['意味', '品味', '回味', '口味']],
      ['illness', ['伤口', '骨折', '后遗症', '头痛'], ['悲伤', '受伤', '生病', '心痛']],
      ['speech', ['说道', '问道', '争吵', '语气'], ['知道', '味道', '街道', '难道']],
      ['thought', ['念头', '回忆', '幻想', '想法'], ['我想', '他想', '不想', '纪念']],
      ['desire', ['占有欲', '食欲', '渴望', '野心'], ['失望', '绝望', '眺望', '观望']],
      ['document', ['说明书', '身份证', '账单', '名片'], ['简单', '事件', '软件', '穿一件']],
      ['media', ['电视剧', '悲剧', '插曲', '小说'], ['加剧', '弯曲', '扭曲', '蜷曲']],
      ['event', ['婚礼', '决赛', '开幕式', '发布会'], ['敬礼', '委员会', '机会', '方式']],
      ['myth', ['神仙', '恶魔', '妖怪', '幽灵'], ['水仙', '精神', '心灵', '奇怪']],
      ['martial', ['口诀', '真气', '心法', '筑基'], ['秘诀', '成功', '生气', '牡丹']],
      ['festival', ['春节', '圣诞节', '元宵', '除夕'], ['细节', '环节', '章节', '季节']],
      ['material', ['玻璃', '塑料', '丝绸', '水泥'], ['本质', '材料', '资料', '饮料']],
      ['animal', ['老虎', '狐狸', '蝴蝶', '兔子'], ['马路', '牛奶', '龙头', '虎口']],
      ['jewelry', ['戒指', '项链', '玉镯', '发簪'], ['衬衫', '外套', '皮带', '围巾']],
      ['texture', ['冰凉', '滚烫', '粗糙', '湿润'], ['温柔', '冷漠', '热情', '冷静']],
    ];
    for (const [kind, pos, neg] of cases) {
      for (const w of pos) expect(kinds(w), `${kind}+ ${w}`).toContain(kind);
      for (const w of neg) expect(kinds(w), `${kind}- ${w}`).not.toContain(kind);
    }
  });

  it('batch 3 never outranks an existing kind: it only fills in what was 其他', () => {
    const e = detectEntities(story);
    // 圣诞节 gains `festival` but stays 时间; 剧本 is a 文书 and a 作品, and the
    // stronger of the two is the one CONF orders first.
    expect(classify('圣诞节', e)).toBe('time');
    expect(classifyKinds('圣诞节', e).map((k) => k.kind)).toContain('festival');
    expect(classify('办公室', e)).toBe('place');
    expect(classify('衬衫', e)).toBe('wear');
    expect(classify('咖啡', e)).toBe('drink');
    const tags = classifyKinds('剧本', e);
    expect(tags.map((k) => k.kind)).toEqual(['document', 'media']);
  });

  it('garment words are wear; the same tail characters elsewhere are not', () => {
    const e = detectEntities(story);
    for (const w of ['衬衫', '长裙', '短裤', '丝袜', '皮靴', '大衣', '帽子', '高跟鞋', '领带', '围巾', '制服']) {
      expect(classify(w, e), w).toBe('wear');
    }
    for (const w of ['声带', '磁带', '毛巾', '说服', '舒服', '一带']) expect(classify(w, e), w).not.toBe('wear');
    // Body parts win over the garment reading.
    expect(classifyKinds('胸口', e).map((k) => k.kind)).not.toContain('wear');
  });

  it('brands are only the corporate-suffix form and corpus-attested names', () => {
    const e = detectEntities(['NIKE牌的鞋。', 'NIKE牌又出了新款。', 'NIKE公司来人了。']);
    expect(classify('天宇集团', e)).toBe('brand');
    expect(classify('星辰工作室', e)).toBe('brand');
    expect(classify('nike', e)).toBe('brand');
    // Two characters is a common noun, not a company name.
    expect(classify('公司', e)).not.toBe('brand');
    expect(classify('影视', e)).not.toBe('brand');
  });

  it('systemWords come from message names', () => {
    const names = systemWords([
      { index: 0, name: 'goofy', role: 'user', raw: '', text: '', swipeCount: 1 },
      { index: 1, name: '逐梦演艺圈4.2', role: 'char', raw: '', text: '', swipeCount: 1 },
    ]);
    expect(names).toContain('goofy');
    expect(names).toContain('逐梦演艺圈4.2');
  });
});

describe('names bypass cohesion', () => {
  // Long name much rarer than the short name it contains, as in real logs
  const lines: string[] = [];
  for (let i = 0; i < 40; i++) lines.push('高飞走进房间，高飞看了一眼，高飞坐下了。');
  for (let i = 0; i < 8; i++) lines.push('沈高飞说：好。沈高飞点点头。沈高飞的眼睛看着他。"沈高飞说。');

  it('a long name is not lost to its frequent short form', () => {
    const e = detectEntities(lines);
    expect(e.personNames).toContain('沈高飞');
  });
});

describe('kind toggles', () => {
  const content = [
    JSON.stringify({ user_name: 'unused', character_name: 'unused', chat_metadata: {} }),
    ...story.map((t) => JSON.stringify({ name: 'goofy', is_user: true, mes: t })),
  ].join('\n');
  const files = [{ name: '测试卡 - 2026-08-31@20h00m08s527ms.jsonl', content }];
  const base = {
    ...DEFAULT_ANALYZE_OPTIONS,
    tokenize: { ...DEFAULT_ANALYZE_OPTIONS.tokenize, minCount: 1, discoverMinCount: 2 },
  };

  it('person names show by default; the kind button hides them', () => {
    const r = analyze(files, base);
    expect(r.words.map((w) => w.text)).toContain('沈砚秋');
    const hidden = analyze(files, { ...base, kinds: ['plain', 'place', 'time'] });
    expect(hidden.words.map((w) => w.text)).not.toContain('沈砚秋');
    expect(hidden.words.map((w) => w.text)).not.toContain('沈高飞');
  });

  it('per-kind counts are reported', () => {
    const r = analyze(files, base);
    const person = r.entities.byKind.find((k) => k.kind === 'person');
    expect(person!.words).toBeGreaterThan(0);
  });
});

/** 部 / 口 suffixes must not turn quantifier phrases (一部, 那部) into places. */
describe('place detection ignores quantifier phrases', () => {
  const idx = { kindOf: new Map(), personNames: [], hits: new Map(), brands: new Set() } as never;
  it.each(['一部', '那部', '这部', '两口', '三所', '几站'])('%s 不是地点', (w) => {
    expect(classify(w, idx)).toBe('plain');
  });
  it.each(['办公室', '写字楼', '排练厅', '菜市场', '中戏西门口'])('%s 是地点', (w) => {
    expect(classify(w, idx)).toBe('place');
  });

  /** Body parts, direction words and verb-object phrases share the 口/部/场/路 suffixes. */
  it.each([
    '胸口', '乳房', '面部', '大口', '裆部', '胸部', '腰部', '臀部', '阴部', '根部',
    '虎口', '背部', '中部', '内部', '外部', '底部', '尾部', '大腿根部',
    '吐司', '查房', '接口', '磁场', '一路', '当场', '现场',
  ])('%s 不是地点', (w) => {
    // Since the 60-kind design the anatomy half of this list carries a `body` tag
    // (docs/33); what the place rule must never do is claim any of them.
    expect(classifyKinds(w, idx).map((k) => k.kind)).not.toContain('place');
  });
  it.each(['胸口', '乳房', '裆部', '腰部', '臀部', '背部', '大腿根部'])('%s 是身体', (w) => {
    expect(classifyKinds(w, idx).map((k) => k.kind)).toContain('body');
  });
  it.each([
    '片场', '餐厅', '厨房', '浴室', '卧室', '客厅', '二楼', '一楼', '门口', '出口',
    '入口', '柏油路', '高速公路', '马路', '朝阳区', '居民楼', '中央戏剧学院',
  ])('%s 是地点', (w) => {
    expect(classify(w, idx)).toBe('place');
  });
});

describe('time expressions', () => {
  const idx = detectEntities([]);
  it('durations, relative days, day parts, seasons, weekdays and moments are time', () => {
    const yes = ['三个月', '两天', '半小时', '五分钟', '十秒钟', '几秒', '一整夜', '一天', '一夜', '一大早', '三秒钟',
      '今天', '那天', '当天', '每天', '前几天', '下个月', '去年', '明年', '今年', '周末', '月底', '年初', '三个月前', '两周后',
      '清晨', '午后', '深夜', '傍晚', '初春', '盛夏', '寒冬', '冬天', '周一', '星期三', '礼拜天',
      '此刻', '刚才', '后来', '片刻', '转眼', '当年', '如今', '小时候', '十月', '十一月', '三点', '十点半', '2026年', '12月', '4号',
      '春节', '圣诞节', '除夕', '生日', '一会儿', '半晌',
      '正月', '腊月', '初一', '廿三', '子时', '卯时', '三更', '五更天', '一炷香', '一盏茶', '一刻钟', '百年', '千年', '三百年', '数百年', '一甲子', '甲子年', '贞观三年', '立春', '冬至', '元宵', '上元', '昨夜', '今宵', '前世', '上古', '洪荒',
      'monday', 'january', 'morning', 'tonight', 'yesterday', 'weekend', '3pm', '1990s', 'christmas', 'minutes', 'ago', 'midnight'];
    for (const w of yes) expect(classify(w, idx), w).toBe('time');
  });
  it('look-alikes are not time', () => {
    const no = ['百分', '十分', '万一', '两下', '一下', '霜月', '月见', '分析', '分配', '少年', '享年', '年龄', '分娩', '同学', '年表', '准时', '分流', '午休室',
      // adverbs, conjunctions and weather words that used to slip into the alternation
      '雨水', '最终', '更深', '往前', '一秒', '一瞬间', '临时', '平时', '这时', '什么时候', '偶尔', '先前', '不久'];
    for (const w of no) expect(classify(w, idx), w).not.toBe('time');
  });
});

/**
 * Precision guard: the broad `subject` pattern used to promote common nouns and
 * adverb phrases to person names. Each string below is fed through five distinct
 * name positions, so only the suffix / head rules can reject it — the hit
 * thresholds are all satisfied. Measured end to end by `npm run eval:persons`.
 */
describe('common nouns are not person names', () => {
  /** Five sentences, five different PERSON_PATTERNS, for one candidate. */
  const positions = (w: string) => [
    `${w}说，这事就这么定了。`,
    `${w}，你先坐一会儿。`,
    `“${w}，别急。”`,
    `${w}：好。`,
    `${w}走到窗边，没有回头。`,
  ];
  const corpus = [
    '木质地板', '理石台面', '针织开衫', '另一只手', '复印件',
    '沈砚秋', '周敬亭', '韩野',
  ].flatMap(positions);
  const e = detectEntities(corpus);

  it.each(['木质地板', '理石台面', '针织开衫', '另一只手', '复印件'])('%s 不是人名', (w) => {
    expect(e.personNames).not.toContain(w);
  });
  it.each(['沈砚秋', '周敬亭', '韩野'])('%s 还是人名', (w) => {
    expect(e.personNames).toContain(w);
  });
});

/**
 * The corpus-free check used to sieve the community board a second time
 * (server/admin.ts): contributors filter on their own machine, so a name whose
 * log gave too little positional evidence can still reach the aggregate.
 */
describe('looksLikePerson（无上下文的人名判断）', () => {
  it.each(['赵一文', '沈砚秋', 'Maya Torres', '赵总', '王老师'])('%s 判成人名，要从榜单剔除', (w) => {
    expect(looksLikePerson(w)).toBe(true);
  });

  it.each(['片场', '沙发', '办公室', '通告单', '排练厅', '剧本'])('%s 不是人名，留在榜单里', (w) => {
    expect(looksLikePerson(w)).toBe(false);
  });

  // Deliberate choices, not accidents:
  it('单个小写英文词保留，即使它也可能是人名（sydney 既是城市也是名字，无上下文分不开）', () => {
    expect(looksLikePerson('sydney')).toBe(false);
    expect(looksLikePerson('rose')).toBe(false);
  });

  it('两字候选不按「姓+名」判（白裙 / 陈醋 跟 林薇 一样像，错删比漏删更贵）', () => {
    expect(looksLikePerson('白裙')).toBe(false);
  });
});

/**
 * Coreference proposals. `detectCoref` never touches counts, so these tests only
 * check which strings it is willing to put in one group.
 */
describe('detectCoref（同指候选）', () => {
  /** 赵一文 hits five distinct person patterns, which is what the confidence gate wants. */
  const zhao = [
    '赵一文说道："这个方案我看过了。"',
    '赵一文点了点头，没有说话。',
    '赵一文的声音很轻。',
    '林岚和赵一文说了几句。',
    '赵一文，你先坐。',
  ];
  const shortForms = [
    '小赵今天来得早。',
    '小赵把文件放在桌上。',
    '小赵笑了笑，没有接话。',
    '赵先生请进。',
    '赵先生把伞收起来。',
    '赵先生看了看表。',
  ];
  const run = (msgs: string[], opts?: { allowComplementary?: boolean }) => {
    const index = detectEntities(msgs);
    return detectCoref(msgs, index.personNames, index, opts);
  };

  it('姓 + 称谓和 小姓 都并到全名上', () => {
    const groups = run([...zhao, ...shortForms]);
    expect(groups.map((g) => g.full)).toContain('赵一文');
    const aliases = groups.find((g) => g.full === '赵一文')!.aliases;
    expect(aliases).toContain('小赵');
    expect(aliases).toContain('赵先生');
  });

  it('两个同姓全名时，同姓的短称是歧义的，不并（条件 2）', () => {
    const other = [
      '赵明远说道："我知道了。"',
      '赵明远点了点头。',
      '赵明远的眼睛很亮。',
      '她和赵明远说了几句。',
      '赵明远，你等一下。',
    ];
    const groups = run([...zhao, ...other, ...shortForms]);
    for (const g of groups) {
      expect(g.aliases).not.toContain('小赵');
      expect(g.aliases).not.toContain('赵先生');
    }
  });

  it('出现不到三次的变体不并（条件 1）', () => {
    const groups = run([...zhao, '小赵今天来得早。', '小赵把文件放在桌上。']);
    expect(groups.find((g) => g.full === '赵一文')?.aliases ?? []).not.toContain('小赵');
  });

  it('互补分布这一支可以关掉，关掉后从不同时出现的变体就不再提出（消融开关）', () => {
    const groups = run([...zhao, ...shortForms], { allowComplementary: false });
    expect(groups.find((g) => g.full === '赵一文')?.aliases ?? []).toHaveLength(0);
  });

  it('没有全名就没有候选', () => {
    expect(run(['今天天气不错。', '他把文件放在桌上。'])).toEqual([]);
  });
});

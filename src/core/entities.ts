import { DEFAULT_STOPWORDS } from './stopwords';
import { zh } from './zh';
import type { ChatMessage } from './types';

/**
 * Entity layer for chat logs. The tokenizer only splits; this layer decides what a
 * token is. Person names are detected from syntactic positions and bypass the
 * cohesion test, because a full name can have low cohesion when its short form is
 * more frequent.
 */

/** `generic`: evenly spread across messages (low dispersion), assigned in analyze.ts; hidden from the cloud by default. */
export type EntityKind = 'person' | 'time' | 'place' | 'system' | 'plain' | 'generic';

/** User-visible kind names, translated at display time via tx(). */
export const ENTITY_LABEL: Record<EntityKind, string> = {
  person: zh('人物'),
  time: zh('时间'),
  place: zh('地点'),
  system: zh('系统'),
  plain: zh('其他'),
  generic: zh('常见词'),
};

const NAME = '([\\u4e00-\\u9fff]{2,4})';

/**
 * Syntactic positions of person names. Each pattern alone is unreliable; the
 * number of distinct patterns hit is the signal. Names are 1..4 CJK characters.
 */
const PERSON_PATTERNS: { id: string; re: RegExp }[] = [
  { id: 'says', re: new RegExp(NAME + '(说道|问道|答道|说|问|答|道)[，。：""]', 'g') },
  { id: 'gesture', re: new RegExp(NAME + '(点了点头|摇了摇头|皱了皱眉|点点头|摇摇头|皱眉|抬头|低头|叹了口气|笑了笑)', 'g') },
  { id: 'possessive', re: new RegExp(NAME + '的(声音|眼睛|手|脸|目光|背影|语气|肩膀|表情)', 'g') },
  { id: 'quoted', re: new RegExp('[""]\\s*' + NAME + '(说|问|道)', 'g') },
  { id: 'address', re: new RegExp(NAME + '[，,](你|我|这|那)', 'g') },
  { id: 'toward', re: new RegExp('(?:和|跟|对|向|给|被)' + NAME + '(说|问|点|笑|看)', 'g') },
  // Subject position before a narrative verb or adverb. Broad on purpose; the
  // out-of-vocabulary test in `passes` keeps common nouns out.
  { id: 'subject', re: new RegExp(NAME + '(?:是|从|看|望|站|坐|走|抬|低|转|伸|皱|笑|叹|喊|叫|想|开始|接管|允许|采纳|发|知道|觉得|没有|已经|正在|突然|轻轻|缓缓|慢慢|猛地|微微|把|被|让|对|向|朝|跟|和|与|在|用|将|也|却|还|只|又|便|就|才|则|会|能|要|去|来|回|拿|放|推|拉|打|抓|握|摸|吻|抱|靠|躺|睡|醒|哭|停|等|听|闻|咬|舔|喝|吃|穿|脱|翻|拍|指|挥|掀|拧|扯|拽|扶|搂|蹲|跪|爬|跑|跳|冲|退|进|出|上|下)', 'g') },
  // Vocative at the start of a quotation: “霜月，……”
  { id: 'vocative', re: new RegExp('[“"「]' + NAME + '[，,！!？?、]', 'g') },
  // Speaker label at the start of a line: 霜月：……
  { id: 'label', re: new RegExp('(?:^|\\n)\\s*' + NAME + '[：:]', 'g') },
];

/** Leading function characters swallowed by the greedy capture. */
const HEAD_JUNK = /^[的了在是和都也就还又很不个们过着与把被向对从但而且或到当让给跟比你我他她它您咱谁]+/;
/** Strings that cannot be names: function characters inside, colour words, address terms. */
const NOT_NAME = /[以于之乎者及或而且但则即若]|[色后前里中边旁上下内外]$/;
/** Kinship terms and job titles: frequent in name positions but not names. Closed list. */
const KINSHIP_TERMS = new Set([
  '妈妈', '母亲', '爸爸', '父亲', '儿子', '女儿', '哥哥', '姐姐', '弟弟', '妹妹',
  '爷爷', '奶奶', '外公', '外婆', '姥姥', '姥爷', '叔叔', '阿姨', '舅舅', '姑姑',
  '老公', '老婆', '丈夫', '妻子', '孩子', '男人', '女人', '老师', '学生', '同学',
  '医生', '护士', '警察', '师傅', '老板', '经理', '主任', '导演', '演员', '助理',
]);
const ADDRESS = new Set(['主人', '小主人', '陛下', '殿下', '大人', '老爷', '夫人', '小姐', '少爷', '公子', '姑娘', '先生', '女士', '老板', '队长', '教官', '长官', '阁下', '师父', '师傅', '前辈', '学长', '学姐', '宝贝', '亲爱的']);

/** Characters common in transliterated names; two or more mark a likely foreign name. */
const TRANSLIT = new Set('妮娜莉丝德尼克斯拉娅亚伊艾安琳蒂卡罗瑞塔尔恩维露菲莎雅娃杰姆汉森曼特诺奥洛里利布格兰达迪西赛贝伦华巴基加米汀温芙莲蓉茜薇蕾丽娣萝柯凯乔希夫冯汤约翰彼得保爱玛妲蕊珊珍琪黛朵妃芬蓓碧娥瑟依埃弗莱朗雷林摩莫纳欧帕佩皮普奇琴萨塞史苏索泰提图托瓦威韦沃夏肖逊扬耶尤泽詹朱伯博查戴顿多菲弗盖戈哈赫霍吉杰卡肯库莱丽隆卢鲁伦马麦曼梅蒙米明莫穆娜奈尼诺帕潘佩珀普齐乔瑞若萨桑瑟沙珊莎史斯汀托沃希雅娅伊尤泽兹'.split(''));
const seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('zh', { granularity: 'word' }) : null;
/** Out of vocabulary: the segmenter does not know the string as one word. */
function isOov(w: string): boolean {
  if (!seg) return false;
  return [...seg.segment(w)].filter((x) => x.isWordLike).length > 1;
}
function looksTransliterated(w: string): boolean {
  let n = 0; for (const c of w) if (TRANSLIT.has(c)) n++;
  return n >= 2 && n >= w.length - 1;
}

/**
 * Honorific / title suffixes (X总 / X老师 / X哥). The form itself marks a person.
 * Applied only to tokenizer output, never to sliding-window substrings.
 */
const TITLE_RE = /^[一-鿿]{1,3}(总|老师|导演|副导演|经理|医生|主任|哥|姐|叔|姨|先生|小姐|女士|同学|队长|教授)$/;

/** Names do not end with a function word; used to trim greedy matches. */
const TAIL_JUNK = /[的了没在是和都也就还又很不个们过着与把被向对从地得]$/;

/**
 * Common-noun suffixes. A 2..4 character string ending in one of these is a
 * thing, a room or a role, not a given name — 木质地板 / 针织开衫 / 理石台面 /
 * 复印件 / 保温杯 / 办公室 / 中年男人. Deliberately short: only characters that
 * essentially never end a Chinese personal name. `任` (制片主任) and `单`
 * (通告单) stay out, they are ground-truth targets.
 */
const NOUN_TAIL = /[板面衫沙台门口手星部布巾件本杯器椅牌表夹箱凳树声场室馆人子理生戏款机灯纸袋墙窗桌硬露]$/;

/**
 * Degree adverbs and dangling function fragments swallowed at the head of the
 * greedy capture: 完全暴露 / 彻底暴露 / 受控制地 / 另一只手 / 一文冷硬.
 * Overridden when the whole string is unknown to the segmenter and hit by three
 * or more distinct patterns, so a real name starting with one of these survives.
 */
const HEAD_FRAGMENT = /^[完彻受另大条一最更太极超挺]/;

/**
 * Time expressions. Groups:
 *   absolute: 2026年 / 10月 / 4号 / 三点 / 十点半 / 五分 / 周一 / 星期三
 *   durations: 三个月 / 两天 / 半小时 / 五分钟 / 十秒钟 / 一整夜 / 几年
 *   relative days and periods: 今天 / 那天 / 当天 / 每天 / 前几天 / 下个月 / 去年 / 明年 / 周末 / 月底 / 年初
 *   parts of the day and seasons: 清晨 / 午后 / 深夜 / 初春 / 盛夏 / 寒冬
 *   relative moments: 此刻 / 刚才 / 后来 / 片刻 / 转眼 / 当年 / 如今
 */
const NUM = '(?:\\d+|[一二两三四五六七八九十百千零〇几半]+)';
const UNIT = '(?:个?(?:世纪|年|月|周|星期|礼拜|天|日|夜|晚|宿|小时|钟头|刻钟|分钟|秒钟|秒|分|季度|学期|旬|载)|整[天夜年月]|大早|会儿|阵子|瞬|眨眼)';
const TIME_RE = new RegExp(
  '^(?:' + [
    `\\d{1,4}[年月日号]`, `\\d{1,2}[点时](?:半|钟|\\d{1,2}分?)?`, `\\d{1,2}[分秒]`,
    `${NUM}[年月日号点时]`, `${NUM}点[半钟]`, `${NUM}${UNIT}(?:前|后|内|来|里|间|半)?`,
    `${NUM}[早晚宿夜]`,
    `(?:今|明|后|昨|前|去|大前|大后|当|那|这|每|某|上|下|本|次|翌|隔|头|末|同|近|几|数|多|好几|整|半|全|一整|连)(?:几|数|多|半)?(?:天|日|早|晚|夜|年|月|周|季|世|个月|星期|礼拜|阵子|会儿)`,
    // 往前 / 过前 are spatial, so 往 and 过 only combine with 后.
    `(?:前|之|以|其|随|稍|事|战|婚|饭|课|赛|会)(?:后|前)`, `(?:过|往)后`,
    `(?:上|下|本|这|那|每|头|某)?(?:个)?(?:月|周|年|季|学期)(?:初|中|末|底|尾|头)`,
    `[早晚午夜晨]间`, `早[上晨间]`, `上午|中午|正午|下午|午后|午间|傍晚|黄昏|晚上|夜里|夜晚|深夜|半夜|午夜|凌晨|黎明|拂晓|破晓|清晨|清早|一大早|白天|白日|日间|晌午|日出|日落|日暮|入夜|夜深|天亮|天黑|傍黑`,
    `(?:初|早|仲|盛|深|晚|残|寒|严|隆|暖|暮)?[春夏秋冬](?:天|季|日|末|初)?`, `春夏秋冬|四季`,
    `周[一二三四五六日天末]|星期[一二三四五六日天]|礼拜[一二三四五六日天]|周末|工作日|假日|节假日|休息日|放假`,
    `此刻|此时|此后|现在|当时|那时|那会儿|这会儿|当下|眼下|目前|如今|今后|以后|以前|从前|往日|昔日|当年|早年|近年|近来|最近|近日|日前|未来|将来|后来|随后|稍后|事后|片刻|顷刻|一会儿|许久|良久|半晌|良辰|瞬间|刹那|转眼|转瞬|须臾|刚才|方才|适才|方刚|刚刚|之前|之后|一时|一时间|同时|当初|起初|最初|最后|平日|时刻|时候|多久|终日|整日|整夜|通宵|彻夜|连日|连夜|接下来|即日|当日|翌日|次日|今日|昨日|明日|生日|忌日|纪念日|周年|年份|时辰|钟点|点钟|小时候|童年|少年时|青春期|老年|晚年|一生|余生|半生|下半年|上半年|年头|年底|年末|年初|月初|月中|月末|月底|季末|季初|开学|期末|期中|放学|下班|上班|午休|开饭|睡前|醒来|黄昏后|日复一日|年复一年`,
    `(?:春|元|中秋|端午|清明|重阳|七夕|圣诞|万圣|感恩|情人|愚人|劳动|国庆|儿童|母亲|父亲|教师|平安|除夕)节|元旦|春节|除夕|新年|跨年|年夜|中秋|端午|清明|七夕|圣诞|万圣|感恩|双十一|黑五`,
    // Lunar calendar and traditional / xianxia time words
    `(?:正|腊|冬|闰)月`, `(?:初|廿|卅)[一二三四五六七八九十]`, `(?:上|中|下)旬`, `[子丑寅卯辰巳午未申酉戌亥]时`, `(?:三|四|五)更(?:天|时分)?`, `[一二三四五]更`,
    `(?:一|半)炷香|一盏茶|一刻钟|一柱香|一顿饭|片刻间|一弹指|弹指间|须臾间|一霎`,
    `(?:一|三|十|百|千|万|亿|数|几)(?:百|千|万|亿)?(?:年|载|世|纪|甲子|元会)(?:前|后|间|来)?`, `(?:数|几)(?:百|千|万)?(?:年|载|日|月|世)`,
    `甲子|一甲子|纪元|元会|大劫|量劫|末法时代|上古|远古|太古|洪荒|末世|乱世|盛世|当朝|本朝|前朝|前世|今生|来世|来日|他日|往昔|往昔岁月|昔年|旧时|古时|古时候|彼时|是时|是日|是夜|昨夜|今夜|今宵|今朝|来年|翌年|明岁|来岁|旬日|半日|数日|连日|终年|经年|多年|经年累月|日复一日|光阴|岁月|辰光|时辰|时分|黄昏时分|拂晓时分|黎明时分|夜半|夜半时分|午时三刻|卯时|辰时|巳时|未时|申时|酉时|戌时|亥时|子夜|三更半夜|更深露重|天明|天光|平旦|日中|日昳|晡时|日入|人定|鸡鸣`,
    // Solar terms, minus the four that are ordinary weather words far more often
    // than calendar terms in chat logs (雨水 / 白露 / 小雪 / 大雪).
    `立春|惊蛰|春分|谷雨|立夏|小满|芒种|夏至|小暑|大暑|立秋|处暑|秋分|寒露|霜降|立冬|冬至|小寒|大寒`,
    `元宵|中元|上元|下元|花朝|寒食|腊八|小年|除夜|守岁|灯节|乞巧|重五|端阳|冬节|年关|开春|入冬|入夏|入秋`,
    `[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥](?:年|岁)?`, `(?:建安|贞观|开元|天宝|永乐|康熙|雍正|乾隆|嘉靖|万历|崇祯|洪武|嘉庆|道光|咸丰|同治|光绪|宣统|元和|景泰|正德|天启|太初|元狩|建元)(?:[一二三四五六七八九十元]+年)?`, `[一-鿿]{2,4}[一二三四五六七八九十元]+年间?`,
  ].join('|') + ')$',
);
/** English time words; tokens are lower-cased. */
const EN_TIME_RE = /^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|morning|mornings|afternoon|afternoons|evening|evenings|night|nights|noon|midnight|midday|dawn|dusk|sunrise|sunset|twilight|daybreak|nightfall|today|tomorrow|yesterday|tonight|tomorrows|now|later|soon|sooner|recently|currently|earlier|nowadays|eventually|meanwhile|afterwards|afterward|beforehand|already|ago|weekend|weekends|weekday|weekdays|week|weeks|month|months|year|years|decade|decades|century|centuries|millennium|minute|minutes|hour|hours|second|seconds|moment|moments|instant|instantly|day|days|daily|weekly|monthly|yearly|annual|annually|spring|summer|autumn|fall|winter|christmas|easter|halloween|thanksgiving|birthday|anniversary|o'clock|am|pm|a\.m\.|p\.m\.|\d{1,2}(?::\d{2})?\s?(?:am|pm)|\d{4}s?|\d{1,2}(?:st|nd|rd|th)|midweek|fortnight|overnight|sometime|someday|once|twice|nowadays|lately|whenever|forever|eternity|era|eras|epoch|age|ages|season|seasons|semester|quarter|quarters|dawns|nighttime|daytime|bedtime|lunchtime|dinnertime|breakfast|lunch|dinner|supper|teatime|curfew|deadline)$/;

/**
 * Percentages and similar look like 数词+分 but are not time. `一秒` / `一瞬间`
 * are grammatical time expressions but in practice they are used as intensifiers
 * ("一秒都没停"), so they are excluded; `几秒` / `三秒钟` stay.
 */
const NOT_TIME = /^(?:百分|千分|万分|十分|几分|一分|三分|七分|五分|万一|一时半|半分|三秒|一秒|一瞬|一瞬间|两下|一下|几下|一天天|一年年|一日日)$/;

const PLACE_RE = /(室|厅|房|楼|院|馆|场|店|街|路|区|市|省|县|镇|村|园|站|口|棚|厂|所|部|司)$/;
/** Suffix rule exception: quantifier/demonstrative + 部/口 (一部, 那部, 一口) is not a place. */
const NOT_PLACE = /^([一二两三四五六七八九十几半整每某另本这那哪上下前后同]|\d+)[部口所司场站园路]$/;

/**
 * High-ambiguity place suffixes. `口 部 场 路 司 房` also end body parts (胸口,
 * 腰部), direction and aspect words (中部, 内部), verb-object phrases (查房,
 * 接口) and abstract nouns (磁场, 一路). A word ending in one of them counts as a
 * place only when it is three characters or longer, or when it is in the closed
 * list of ordinary two-character place words below.
 *
 * Corpus context was tried and dropped: 在现场 / 去现场 / 当场 are exactly as
 * locative as 在门口, so "appears after 在/到/去/进" does not separate the two.
 */
const AMBIG_TAIL = /[口部场路司房]$/;
const AMBIG_PLACE2 = new Set([
  '门口', '出口', '入口', '路口', '巷口', '街口', '村口', '山口', '港口', '渡口', '洞口', '窗口', '楼口', '隘口',
  '广场', '商场', '农场', '牧场', '会场', '剧场', '操场', '靶场', '机场', '赛场', '战场', '片场', '秀场', '猪场',
  '马路', '公路', '铁路', '大路', '小路', '山路', '岔路', '土路', '石路', '弯路',
  '厨房', '书房', '病房', '客房', '机房', '牢房', '产房', '库房', '花房', '暖房',
  '平房', '楼房', '民房', '洋房', '瓦房', '空房', '包房', '新房',
  '公司',
]);
/** Anatomy characters. 大腿根部 / 胸口 / 裆部 are body parts however long they are. */
const BODY_RE = /[胸乳裆腰臀阴背腹肩颈喉腕踝膝肘唇舌齿眼耳鼻臂股胯脐颊额腮趾膀腿虎]/;

export interface EntityIndex {
  kindOf: Map<string, EntityKind>;
  /** Candidates detected as person names. Forced as whole tokens, bypassing cohesion. */
  personNames: string[];
  /** Distinct patterns hit per name, shown as a confidence hint. */
  personConfidence: Map<string, number>;
}

/**
 * Detect entities in cleaned texts.
 *
 * @param known words always labelled `system` (persona name, card name)
 */
export function detectEntities(texts: string[], known: string[] = []): EntityIndex {
  const joined = texts.join('\n');
  const hits = new Map<string, Set<string>>();
  const counts = new Map<string, number>();

  /** Hits per pattern x name. A single high-frequency pattern is evidence on its own. */
  const patHits = new Map<string, number>();
  for (const { id, re } of PERSON_PATTERNS) {
    for (const m of joined.matchAll(re)) {
      const name = (m[1] ?? '').replace(HEAD_JUNK, '');
      if (!name || name.length < 2) continue;
      (hits.get(name) ?? hits.set(name, new Set()).get(name)!).add(id);
      counts.set(name, (counts.get(name) ?? 0) + 1);
      const key = `${id}\u0000${name}`;
      patHits.set(key, (patHits.get(key) ?? 0) + 1);
    }
  }

  const kindOf = new Map<string, EntityKind>();
  const personConfidence = new Map<string, number>();
  const personNames: string[] = [];

  const passes = (name: string, pats: Set<string>) => {
    if ((counts.get(name) ?? 0) < 3) return false;
    /** Threshold: hits in >= 3 distinct patterns, or enough hits in a single pattern. */
    const strongest = Math.max(0, ...[...pats].map((id) => patHits.get(`${id}\u0000${name}`) ?? 0));
    if (KINSHIP_TERMS.has(name) || ADDRESS.has(name) || NOT_NAME.test(name)) return false;
    // Names the segmenter does not know (or transliterations) need less positional evidence
    // than dictionary words, which are mostly common nouns in these positions.
    const oov = isOov(name) || looksTransliterated(name);
    // Out-of-vocabulary alone is weak evidence: most junk here (理石台面, 补充条款)
    // is also OOV. Ask for two positions *and* enough hits, not either/or.
    const enough = oov
      ? ((pats.size >= 2 && (counts.get(name) ?? 0) >= 4) || strongest >= 4)
      : (pats.size >= 3 || strongest >= 8);
    if (!enough) return false;
    // Common nouns and phrases picked up by the broad `subject` pattern.
    if (NOUN_TAIL.test(name)) return false;
    if (HEAD_FRAGMENT.test(name) && !(oov && pats.size >= 3)) return false;
    // Function words are never names.
    if (DEFAULT_STOPWORDS.has(name)) return false;
    // The 2..4 character capture is greedy and may swallow a neighbouring character.
    // Two cheap trims:
    // (1) a name does not end with a function word
    if (TAIL_JUNK.test(name)) return false;
    // (2) if the candidate minus its last character is also a candidate with at least
    //     as many hits, the extra character was swallowed; keep the shorter form
    const prefix = name.slice(0, -1);
    const p = hits.get(prefix);
    if (p && p.size >= pats.size && (counts.get(prefix) ?? 0) >= (counts.get(name) ?? 0)) return false;
    return true;
  };

  for (const [name, pats] of hits) {
    if (!passes(name, pats)) continue;
    kindOf.set(name, 'person');
    personConfidence.set(name, pats.size);
    personNames.push(name);
  }

  for (const k of known) {
    const t = k.trim();
    if (t) kindOf.set(t, 'system');
  }

  // Longest first so maximal matching prefers the full name.
  personNames.sort((a, b) => b.length - a.length);
  return { kindOf, personNames, personConfidence };
}

/** Kind of a single word; falls back to morphology when the entity pass did not claim it. */
export function classify(word: string, index: EntityIndex): EntityKind {
  const known = index.kindOf.get(word);
  if (known) return known;
  // Title suffixes are tested here, on tokenizer output.
  if (TITLE_RE.test(word)) return 'person';
  if (!NOT_TIME.test(word) && TIME_RE.test(word)) return 'time';
  if (/^[a-z0-9.':]+$/i.test(word) && EN_TIME_RE.test(word)) return 'time';
  if (word.length >= 2 && PLACE_RE.test(word) && !NOT_PLACE.test(word)) {
    if (!AMBIG_TAIL.test(word)) return 'place';
    if (BODY_RE.test(word)) return 'plain';
    if (AMBIG_PLACE2.has(word)) return 'place';
    return word.length >= 3 ? 'place' : 'plain';
  }
  return 'plain';
}

/** SillyTavern's own labels (persona name, card name) are software fields, not story content. */
export function systemWords(messages: ChatMessage[]): string[] {
  const s = new Set<string>();
  for (const m of messages) {
    if (m.name && m.name !== '(未知)') s.add(m.name);
  }
  // Common default persona names
  for (const w of ['user', 'User', 'assistant', 'Assistant', 'char', 'system']) s.add(w);
  return [...s];
}

/* ---------- Context-free person check ----------
   `detectEntities` needs a corpus: it counts syntactic positions over the whole
   chat. The community board has no corpus — it aggregates word lists sent by
   many people, each already filtered on *their* machine. When one contributor's
   log gave too little positional evidence, a real name (赵一文) slips into the
   public board.

   `looksLikePerson` is the corpus-free half of the same rules, used to sieve
   the board a second time. It is tuned for precision, not recall: a name kept
   is a privacy leak, a noun dropped is one missing board row. Anything it
   cannot judge is kept. */

/**
 * Single-character surnames (百家姓) plus the usual compound ones. Rare surnames
 * that are also ordinary words heading ordinary compounds are left out on
 * purpose — 通 (通告单), 台 (台球厅), 空, 广, 文, 明, 和, 平, 全, 相, 后 and the
 * like would drag common nouns off the board with them.
 */
const SURNAMES = new Set(
  '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严魏陶姜戚谢邹喻柏窦章苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳酆鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常傅伍顾孟黄穆萧尹姚邵湛汪祁毛禹狄米贝臧计伏戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵季贾娄危童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞柯管卢莫经房裘缪解应宗丁宣贲邓郁杭洪包诸左石崔吉钮龚程嵇邢滑裴陆荣翁荀羊惠甄曲封芮羿储靳汲邴糜松井段富巫乌焦巴弓牧隗侯宓蓬郗班仰仲伊宫宁仇栾甘祖武符刘景詹束龙叶幸司韶郜黎蓟薄蒲鄂籍赖卓蔺屠蒙乔阴胥苍莘翟谭姬冉宰郦雍璩桑桂濮扈燕冀郏浦庄晏柴瞿阎慕连茹习宦艾慎戈廖庾暨衡耿弘匡国寇禄阙欧殳沃蔚夔隆师巩聂晁勾敖訾辛阚曾毋乜养鞠须蒯荆竺逯桓'.split(''),
);
const COMPOUND_SURNAMES = ['欧阳', '司马', '上官', '慕容', '诸葛', '司徒', '皇甫', '独孤', '尉迟', '长孙', '宇文', '夏侯', '东方', '西门', '南宫', '公孙', '轩辕', '端木', '澹台'];

/** Two capitalised Latin words: `Maya Torres`. A single word is far too ambiguous (sydney, may, rose). */
const EN_FULLNAME_RE = /^\p{Lu}\p{Ll}+(?:[-'’]\p{Lu}?\p{Ll}+)?[ ]\p{Lu}\p{Ll}+(?:[-'’]\p{Lu}?\p{Ll}+)?$/u;

/**
 * Does this word look like a person's name with no surrounding text to go on?
 *
 * Three independent rules, each picked because it has no plausible common-noun
 * reading:
 *   1. an honorific / title form (`TITLE_RE`): 赵总 / 王老师;
 *   2. two capitalised Latin words: `Maya Torres`;
 *   3. a Chinese surname (or a transliteration) followed by a given name —
 *      **only** when the segmenter does not know the string as one word. 赵一文
 *      and 沈砚秋 are unknown to it; 沙发, 片场 and 办公室 are ordinary dictionary
 *      words and survive untouched.
 *
 * Two-character candidates are deliberately not judged by rule 3: 白裙 and 陈醋
 * parse as surname + character exactly as well as 林薇 does, and a wrong removal
 * costs more here than a miss. Single lower-case Latin words (`sydney`) are left
 * alone for the same reason — the city and the name are indistinguishable
 * without context.
 */
export function looksLikePerson(word: string): boolean {
  const w = word.trim();
  if (!w || w.length > 24) return false;
  if (TITLE_RE.test(w)) return true;
  if (EN_FULLNAME_RE.test(w)) return true;
  if (!/^[一-鿿]{3,4}$/.test(w)) return false;
  if (KINSHIP_TERMS.has(w) || ADDRESS.has(w) || NOT_NAME.test(w)) return false;
  if (NOUN_TAIL.test(w) || TAIL_JUNK.test(w) || DEFAULT_STOPWORDS.has(w)) return false;
  if (!SURNAMES.has(w[0]) && !COMPOUND_SURNAMES.includes(w.slice(0, 2)) && !looksTransliterated(w)) return false;
  return isOov(w);   // A word the segmenter knows is a word, not a name.
}

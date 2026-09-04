import { DEFAULT_STOPWORDS } from './stopwords';
import { zh } from './zh';
import type { ChatMessage } from './types';

/**
 * Entity layer for chat logs. The tokenizer only splits; this layer decides what a
 * token is. Person names are detected from syntactic positions and bypass the
 * cohesion test, because a full name can have low cohesion when its short form is
 * more frequent.
 */

/**
 * `generic`: evenly spread across messages (low dispersion), assigned in analyze.ts;
 * hidden from the cloud by default.
 *
 * The full 60-kind target is designed in notes/docs/33; this union carries the
 * kinds that are actually implemented and measured by `npm run eval:kinds`.
 * Every rule below is a **construction** (suffix, prefix, closed form-class of
 * at most ~40 seeds), not a word list to look words up in — see docs/33 §2 for
 * why that stays inside AGENTS.md hard rule 3.
 */
export type EntityKind =
  | 'person' | 'time' | 'place' | 'system' | 'plain' | 'generic'
  | 'brand' | 'wear' | 'title'
  // Group 2 people and identity
  | 'kinship' | 'occupation' | 'relation'
  // Group 3 places and buildings
  | 'building' | 'room' | 'nature'
  // Group 4 quantities
  | 'money'
  // Group 5 things
  | 'food' | 'drink' | 'furniture' | 'container' | 'vehicle'
  // Group 7 body and senses
  | 'body' | 'color'
  // Group 8 behaviour and feeling
  | 'emotion'
  // Group 9 society
  | 'org';

/** User-visible kind names, translated at display time via tx(). */
export const ENTITY_LABEL: Record<EntityKind, string> = {
  person: zh('人物'),
  time: zh('时间'),
  place: zh('地点'),
  system: zh('系统'),
  plain: zh('其他'),
  generic: zh('常见词'),
  brand: zh('品牌'),
  wear: zh('服饰'),
  title: zh('称谓'),
  kinship: zh('亲属'),
  occupation: zh('职业'),
  relation: zh('人际关系'),
  building: zh('建筑'),
  room: zh('室内空间'),
  nature: zh('自然景观'),
  money: zh('钱'),
  food: zh('食物'),
  drink: zh('饮品'),
  furniture: zh('家具'),
  container: zh('容器'),
  vehicle: zh('交通工具'),
  body: zh('身体部位'),
  color: zh('色彩'),
  emotion: zh('情绪'),
  org: zh('机构'),
};

/**
 * Kind groups. 60 buttons cannot be laid out flat (docs/33 §3), so the filter,
 * review and import panels render one collapsible section per group. `common`
 * is the group that opens by default and the only one the import panel shows.
 * Groups whose kinds are all still unimplemented (docs/33's 暂缓 and later
 * batches) simply have no entry here yet.
 */
export const KIND_GROUPS = [
  { id: 'common', label: zh('常用'), kinds: ['plain', 'person', 'place', 'time', 'generic'] },
  { id: 'people', label: zh('人物与身份'), kinds: ['title', 'kinship', 'occupation', 'relation'] },
  { id: 'space', label: zh('地点与建筑'), kinds: ['building', 'room', 'nature'] },
  { id: 'thing', label: zh('物品'), kinds: ['brand', 'wear', 'food', 'drink', 'furniture', 'container', 'vehicle'] },
  { id: 'sense', label: zh('身体与感官'), kinds: ['body', 'color'] },
  { id: 'act', label: zh('行为与情绪'), kinds: ['emotion'] },
  { id: 'social', label: zh('社会与组织'), kinds: ['org', 'money'] },
] as const satisfies readonly { id: string; label: string; kinds: readonly EntityKind[] }[];

export type KindGroupId = (typeof KIND_GROUPS)[number]['id'];

/**
 * Every implemented, user-facing kind, in group order — the kind buttons and the
 * default `options.kinds` both read this. `system` is deliberately absent: it
 * marks SillyTavern's own fields, has never had a button, and must stay out of
 * the cloud by default.
 */
export const ALL_KINDS: EntityKind[] = KIND_GROUPS.flatMap((g) => [...g.kinds]);

/**
 * Kinds the UI marks as experimental. `npm run eval:kinds` forces any kind whose
 * measured precision is below 80% into this list; a kind may also be listed
 * above the line, as `brand` is: it scores 100% on the shapes it claims but
 * recognises almost nothing outside them (the local logs contain no brand at
 * all), so what the user sees is mostly misses. docs/27 §7 expects those to be
 * fixed by hand re-filing, not by guessing.
 */
export const EXPERIMENTAL_KINDS: EntityKind[] = ['brand'];

/** One classification of a word. A word can carry several; sorted by `conf` descending. */
export interface KindTag {
  kind: EntityKind;
  /** Rule confidence, 0..1. Fixed per rule; see CONF below. */
  conf: number;
}

/**
 * Rule confidences. These only order the tags of one word — they are not
 * probabilities. The ordering is what keeps `classify()` (highest tag) returning
 * exactly what it returned before the multi-kind change: a person name that also
 * matches the title construction (赵总) stays `person`.
 */
const CONF = {
  system: 1,
  person: 0.95,
  personTitleForm: 0.9,
  time: 0.9,
  place: 0.85,
  placeWeak: 0.7,
  /** Above `place`: 星辰工作室 / 华美公司 also carry a place suffix, but the company is the point. */
  brand: 0.88,
  wear: 0.8,
  title: 0.7,
  /**
   * Batch-2 kinds (docs/33 §4). All of them sit **below** `title`, so the
   * strongest tag of every word that already had one is unchanged: 公司 stays
   * `place`, 赵总 stays `person`, 衬衫 stays `wear`. Within the batch the order
   * is specificity: a closed form-class outranks a suffix rule.
   */
  kinship: 0.68,
  body: 0.66,
  org: 0.66,
  money: 0.64,
  occupation: 0.62,
  building: 0.6,
  room: 0.6,
  nature: 0.58,
  food: 0.55,
  drink: 0.55,
  vehicle: 0.54,
  furniture: 0.52,
  container: 0.52,
  relation: 0.5,
  color: 0.5,
  emotion: 0.5,
  plain: 0.3,
  /** Dispersion-based, assigned in analyze.ts; never outranks a construction. */
  generic: 0.3,
} as const;

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
/**
 * Single-character verbs that take a person as their object. `PERSON_PATTERNS`
 * only anchors on what follows the name, so the 2..4 character capture is greedy
 * to the **left** and a verb sitting in front of the name lands inside it:
 * 看见沈砚秋坐在… captured 见沈砚秋, 推门看见高飞 captured 看见高飞 (both reached
 * `personNames` on the local logs, 2026-09-05, and then won maximal matching, so
 * the verb disappeared into the person token).
 *
 * Trimming is safe because none of these characters is a Chinese surname — the
 * capture starts at a surname whenever it really is a name — and the trim is only
 * applied when at least two characters are left, so it can shorten a candidate to
 * its true left edge but never delete one.
 */
const VERB_HEAD = /^[见看找问叫喊等送接陪跟带劝骂夸推拉抱]+/;
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
/**
 * The honorific seeds themselves, shared with the coreference stage below so
 * that 赵总 / 赵老师 / 赵律师 are built from exactly the list that recognises
 * them. Order matters only for readability; the regex is an alternation.
 */
const TITLE_SUFFIXES = [
  '总', '老师', '导演', '副导演', '经理', '医生', '律师', '主任',
  '哥', '姐', '叔', '姨', '先生', '小姐', '女士', '同学', '队长', '教授',
] as const;
const TITLE_RE = new RegExp(`^[一-鿿]{1,3}(?:${TITLE_SUFFIXES.join('|')})$`);

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

/* ---------- Clothing (`wear`) ----------
   Seed: the tail characters that essentially only end garment words
   (衫 裙 裤 袜 靴 衣 帽 鞋 袍 褂). 带 / 巾 / 服 are in the seed list of the design
   note (docs/27 §7) but each of them ends far more non-garment words than
   garment ones (声带 磁带 / 毛巾 餐巾 / 说服 佩服), so they are reached through a
   closed word list instead of a suffix rule. 24 seeds + 26 closed words. */
const WEAR_TAIL = /[衫裙裤袜靴衣帽鞋袍褂]$/;
const WEAR_WORDS = new Set([
  '领带', '皮带', '腰带', '吊带', '绑带', '背带',
  '丝巾', '围巾', '头巾', '纱巾', '方巾',
  '衣服', '制服', '校服', '礼服', '西服', '军服', '便服', '孝服',
  '泳装', '婚纱', '披肩', '手套', '胸罩', '文胸', '服饰',
  '外套', '套装', '裙子', '裤子', '帽子', '鞋子', '袜子', '靴子',
]);
/** Quantifier + garment tail (一件衣 / 那顶帽) is a phrase fragment, not a garment word. */
const NOT_WEAR = /^(?:[一二两三四五六七八九十几半这那每某另]|\d+)/;

/* ---------- Titles and forms of address (`title`) ----------
   Seed: 38 standalone terms of address and job titles that occur as bare nouns.
   The productive `姓 + 先生/小姐/总/老师…` construction is already encoded in
   TITLE_RE, which is reused here. A word matching both this and the person rules
   gets both tags (龚总 → person + title). */
const TITLE_WORDS = new Set([
  '陛下', '殿下', '大人', '老爷', '夫人', '娘娘', '公主', '太子', '皇上', '王爷',
  '小姐', '少爷', '公子', '先生', '女士', '阁下', '主人', '师父', '师傅', '前辈',
  '学长', '学姐', '老板', '队长', '教官', '长官', '将军', '大夫',
  '老师', '医生', '护士', '导演', '制片', '主任', '经理', '总监', '教授', '助理',
]);

/* ---------- Brands (`brand`) ----------
   Two shapes only, per docs/27 §7. Everything else is left to the user's manual
   re-filing — guessing brand names without a dictionary produces noise. */
/** Corporate suffixes. A token that itself ends in one (and is long enough to carry a name) is a brand. */
const BRAND_TAIL = /(?:牌|公司|集团|工作室|官方)$/;
/** Corpus context for the transliterated-Chinese shape. */
const BRAND_CONTEXT = /[穿买牌款]/;

/* ==========================================================================
   Batch-2 kinds (notes/docs/33). Each block is: a *construction* — a suffix, a
   prefix or a closed form-class of at most 40 seeds — plus the exceptions the
   local TOP list produced. None of these is a lexicon: a seed is a morpheme
   that closes a word class (…杯 …椅 …师), and the closed sets are the ones whose
   class is closed in the language itself (kinship, colours, emotions), not
   samples of an open one. docs/33 §2 argues why hard rule 3 still holds.
   ========================================================================== */

/** Quantifier / demonstrative head: 一件, 那顶, 三辆. Shared by every suffix rule below. */
const QUANT_HEAD = /^(?:[一二两三四五六七八九十几半这那每某另整]|\d+)/;
/** Applies a suffix rule: long enough, no quantifier head, not a function word. */
const suffixHit = (w: string, re: RegExp, min = 2) =>
  w.length >= min && re.test(w) && !QUANT_HEAD.test(w) && !DEFAULT_STOPWORDS.has(w);

/* ---------- 亲属 (`kinship`) ----------
   The kinship system is a genuinely closed class, so a 40-term list is a form
   class and not a dictionary. `KINSHIP_TERMS` above cannot be reused: it mixes
   in job titles (老师 / 医生 / 警察) because it exists to keep those *out* of the
   person layer. */
const KINSHIP_WORDS = new Set([
  '妈妈', '母亲', '娘亲', '爸爸', '父亲', '爹娘', '父母', '儿子', '女儿', '哥哥',
  '大哥', '姐姐', '弟弟', '妹妹', '爷爷', '奶奶', '外公', '外婆', '姥姥', '姥爷',
  '叔叔', '阿姨', '舅舅', '姑姑', '婶婶', '嫂子', '侄子', '外甥', '孙子', '孙女',
  '表哥', '表姐', '堂哥', '老公', '老婆', '丈夫', '妻子', '家人', '亲戚', '兄妹',
]);

/* ---------- 职业 (`occupation`) ----------
   Two productive agent suffixes (…师 / …员) plus the closed set of two-character
   occupation words that carry no suffix at all. Length >= 3 on the suffix rule:
   人员 / 成员 / 会员 are role words, 服务员 / 摄影师 are occupations. */
const OCCUPATION_TAIL = /(?:师|员)$/;
const OCCUPATION_WORDS = new Set([
  '医生', '律师', '教师', '警察', '护士', '司机', '厨师', '演员', '导演', '作家',
  '记者', '编剧', '保安', '会计', '秘书', '模特', '歌手', '画家', '舞者', '翻译',
  '士兵', '将军', '农民', '工人', '商人', '学生', '主播', '裁缝', '铁匠', '猎人',
  '侍女', '丫鬟', '管家', '佣人', '保姆', '教练', '法官', '牧师', '道士', '和尚',
]);
/** …师 / …员 words that name a thing or a state, not the person doing it. */
const NOT_OCCUPATION = new Set(['工作人员', '大师兄', '出人员', '动员', '幅员']);

/* ---------- 人际关系 (`relation`) ----------
   Closed class: the words that name a tie between two people. Distinct from
   `title` (how you address someone) and `kinship` (blood and marriage). */
const RELATION_WORDS = new Set([
  '朋友', '好友', '闺蜜', '恋人', '情人', '爱人', '男友', '女友', '男朋友', '女朋友',
  '同事', '同学', '同伴', '伙伴', '搭档', '队友', '邻居', '房东', '客人', '客户',
  '下属', '上司', '领导', '对手', '敌人', '仇人', '陌生人', '熟人', '前任', '未婚妻',
  '未婚夫', '情敌', '知己', '战友', '室友', '学弟', '学妹', '徒弟', '师兄', '师姐',
]);

/* ---------- 建筑 (`building`) ----------
   Suffix seeds are the characters that essentially only end building words.
   堂 / 城 / 坊 / 阁 were dropped from the suffix and moved into the closed list:
   课堂 / 天堂, 进城 / 全城, 街坊, 内阁 are far more common than their building
   readings. */
const BUILDING_TAIL = /(?:楼|塔|桥|殿|宫|寺|庙|亭|墅)$/;
const BUILDING_WORDS = new Set([
  '大厦', '公寓', '教堂', '礼堂', '食堂', '祠堂', '城堡', '别墅', '房屋', '屋子',
  '帐篷', '木屋', '小屋', '城墙', '围墙', '烟囱', '台阶', '屋顶', '地基', '电梯',
  '楼梯', '长城', '古城', '宫殿', '庭院',
]);

/* ---------- 室内空间 (`room`) ----------
   A subset of `place`: the 室 / 厅 suffixes are already place suffixes, so these
   words carry both tags and `place` (higher conf) stays the primary one. 间 is
   deliberately not a seed — 时间 / 中间 / 瞬间 / 之间 swamp 房间. */
const ROOM_TAIL = /(?:室|厅)$/;
const ROOM_WORDS = new Set([
  '卧室', '客厅', '厨房', '浴室', '书房', '卫生间', '洗手间', '阳台', '走廊', '玄关',
  '储藏室', '地下室', '更衣室', '会议室', '办公室', '教室', '病房', '客房', '包间',
  '隔间', '楼道', '过道', '天井', '后院', '前厅', '房间',
]);

/* ---------- 自然景观 (`nature`) ----------
   海 alone would take 脑海 / 人海 / 花海 with it, so those are excluded by name.
   The rest of the seeds (山 河 湖 林 岛 峰 崖 溪 泉 滩) have no common figurative
   reading in chat logs. */
const NATURE_TAIL = /(?:山|河|湖|海|林|岛|峰|崖|溪|泉|滩)$/;
const NOT_NATURE = new Set(['脑海', '人海', '火海', '花海', '苦海', '学海', '林林', '下山', '上山']);
const NATURE_WORDS = new Set([
  '天空', '太阳', '月亮', '星星', '星空', '云朵', '大地', '沙漠', '草原', '森林',
  '瀑布', '山谷', '悬崖', '河流', '溪流', '湖泊', '海洋', '海边', '沙滩', '荒野',
  '田野', '山顶', '山脚', '树林', '旷野', '沼泽', '冰川', '峡谷',
]);

/* ---------- 食物 (`food`) / 饮品 (`drink`) ----------
   Food takes a suffix rule (饭 菜 汤 粥 糕 饼 肉) with the verb-object phrases
   built on the same characters excluded by name. Drinks are a closed list only:
   酒 / 茶 end as many verb-object phrases (喝酒 敬酒 品茶) as drink names, so no
   suffix rule is safe. */
const FOOD_TAIL = /(?:饭|菜|汤|粥|糕|饼|肉)$/;
const NOT_FOOD = new Set(['肌肉', '吃饭', '做饭', '煮饭', '喝汤', '点菜', '做菜', '上菜', '炒菜', '洗菜', '心肉', '血肉']);
const FOOD_WORDS = new Set([
  '米饭', '面条', '面包', '包子', '馒头', '饺子', '蛋糕', '巧克力', '饼干', '早餐',
  '午餐', '晚餐', '宵夜', '零食', '水果', '苹果', '蔬菜', '鸡蛋', '海鲜', '火锅',
  '沙拉', '三明治', '泡面', '便当', '甜点', '点心',
]);
const DRINK_WORDS = new Set([
  '咖啡', '红茶', '绿茶', '奶茶', '牛奶', '果汁', '汽水', '可乐', '啤酒', '白酒',
  '红酒', '香槟', '威士忌', '鸡尾酒', '白开水', '温水', '冰水', '矿泉水', '热水',
  '饮料', '酒精', '茶水', '开水', '柠檬水',
]);

/* ---------- 家具 (`furniture`) / 容器 (`container`) ----------
   Both are suffix classes with a short exclusion list. 同桌 is a classmate;
   脑袋 is a head; 键盘 / 音箱 / 邮箱 are devices, not vessels. */
const FURNITURE_TAIL = /(?:桌|椅|柜|凳)$/;
const NOT_FURNITURE = new Set(['同桌', '上桌', '一桌']);
const FURNITURE_WORDS = new Set([
  '桌子', '椅子', '沙发', '书桌', '餐桌', '茶几', '柜子', '衣柜', '书架', '书柜',
  '抽屉', '板凳', '梳妆台', '床头柜', '屏风', '地毯', '窗帘', '台灯', '落地灯',
  '靠垫', '枕头', '被子', '床单', '床垫', '吧台', '大床',
]);
const CONTAINER_TAIL = /(?:杯|碗|盘|瓶|箱|袋|盒|罐|壶|篮|桶)$/;
const NOT_CONTAINER = new Set(['脑袋', '全盘', '地盘', '通盘', '棋盘', '键盘', '音箱', '邮箱', '心碗', '一箱']);
const CONTAINER_WORDS = new Set([
  '玻璃杯', '保温杯', '水杯', '茶杯', '咖啡杯', '盘子', '瓶子', '箱子', '袋子', '盒子',
  '罐子', '水壶', '篮子', '水桶', '花瓶', '行李箱', '购物袋', '塑料袋', '碗筷',
]);

/* ---------- 交通工具 (`vehicle`) ----------
   车 is the seed, but it also ends a whole family of verb-object phrases
   (开车 停车 打车 …). Those are listed; everything else ending in 车 is a
   vehicle. */
const VEHICLE_TAIL = /(?:车|船|艇|舰)$/;
const NOT_VEHICLE = new Set([
  '开车', '停车', '上车', '下车', '打车', '塞车', '堵车', '骑车', '坐车', '修车',
  '洗车', '倒车', '刹车', '让车', '搭车', '飙车', '晕车', '翻车', '上船', '下船',
]);
const VEHICLE_WORDS = new Set([
  '汽车', '出租车', '公交车', '地铁', '火车', '高铁', '飞机', '直升机', '摩托车',
  '自行车', '电动车', '轿车', '卡车', '货车', '救护车', '消防车', '警车', '轮船',
  '游艇', '快艇', '马车',
]);

/* ---------- 身体 (`body`) ----------
   Closed list of the parts that actually appear in narration, plus the
   anatomy-character rule already used to keep body parts out of `place`:
   any word ending in 部 or 口 that contains an anatomy character is a body part
   (胸口 / 裆部 / 腰部), which is exactly the negative set of the place eval. */
const BODY_WORDS = new Set([
  '头发', '脸颊', '眼睛', '眉毛', '鼻子', '嘴唇', '牙齿', '舌头', '耳朵', '脖子',
  '喉咙', '肩膀', '手臂', '手腕', '手指', '手掌', '手心', '指尖', '胸膛', '后背',
  '肚子', '屁股', '大腿', '小腿', '膝盖', '脚踝', '脚趾', '皮肤', '骨头', '肌肉',
  '心脏', '血液', '指甲', '睫毛', '乳房', '额头', '下巴', '锁骨', '腰肢', '脊背',
]);

/* ---------- 颜色 (`color`) ----------
   Suffix 色 plus the closed set of bare colour words. 角色 / 神色 / 脸色 / 景色
   share the suffix without being colours, so they are excluded by name. */
const NOT_COLOR = new Set([
  '角色', '特色', '出色', '神色', '脸色', '气色', '音色', '景色', '好色', '姿色',
  '声色', '各色', '一色', '本色', '有色', '无色', '女色', '秀色', '色色', '货色',
  '菜色', '血色', '起色', '难色', '正色', '喜色',
]);
const COLOR_WORDS = new Set([
  '深蓝', '浅蓝', '深红', '大红', '雪白', '漆黑', '通红', '惨白', '乌黑', '金黄',
  '墨绿', '淡粉', '殷红', '苍白', '黝黑', '洁白',
]);

/* ---------- 情绪 (`emotion`) ----------
   Emotion vocabulary is open in principle but its core is small and closed in
   practice; 40 seeds cover what narration actually names. No suffix rule: 情 /
   心 / 感 end far too many non-emotion words. */
const EMOTION_WORDS = new Set([
  '高兴', '开心', '快乐', '兴奋', '激动', '喜悦', '幸福', '满足', '欣慰', '感动',
  '愤怒', '生气', '恼火', '烦躁', '焦虑', '紧张', '不安', '害怕', '恐惧', '惊恐',
  '慌乱', '悲伤', '难过', '伤心', '痛苦', '绝望', '失望', '沮丧', '委屈', '心疼',
  '心酸', '孤独', '寂寞', '羞耻', '害羞', '尴尬', '内疚', '愧疚', '嫉妒', '崩溃',
]);

/* ---------- 钱 (`money`) ----------
   A number followed by a currency unit, three-character …费 compounds
   (医药费 / 手续费), and the closed set of money words. */
const MONEY_RE = /^(?:\d+|[一二两三四五六七八九十百千万亿零]+)(?:块钱|块|元|万|亿|美元|欧元|日元|英镑|万元)$/;
const FEE_RE = /^[一-鿿]{2}费$/;
const MONEY_WORDS = new Set([
  '金钱', '现金', '工资', '薪水', '存款', '押金', '房租', '红包', '零钱', '钞票',
  '硬币', '银行卡', '信用卡', '报酬', '佣金', '转账', '欠款', '账单', '发票', '预算',
]);

/* ---------- 机构 (`org`) ----------
   Institution suffixes. 公司 also carries a `place` tag (it is in AMBIG_PLACE2)
   and `place` has the higher confidence, so nothing that used to read as a place
   changes its primary kind. */
const ORG_TAIL = /(?:公司|集团|学校|大学|学院|医院|银行|警局|派出所|政府|部门|协会|工会|剧组|工作室|事务所|研究所|基金会|委员会|法院|检察院|大使馆)$/;
const ORG_WORDS = new Set([
  '公会', '商会', '军队', '部队', '团队', '组织', '机构', '单位', '企业', '工厂',
  '联盟', '门派', '宗门', '家族', '公司',
]);

export interface EntityIndex {
  kindOf: Map<string, EntityKind>;
  /** Words the corpus pass accepted as brands (Latin forms are lower-cased). */
  brands: Set<string>;
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
      let name = (m[1] ?? '').replace(HEAD_JUNK, '');
      // Trim a leading object-taking verb, but only while a two-character name is left.
      const trimmed = name.replace(VERB_HEAD, '');
      if (trimmed.length >= 2) name = trimmed;
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
  return { kindOf, personNames, personConfidence, brands: detectBrands(joined) };
}

/**
 * Brands that need the corpus to decide. Two shapes, both from docs/27 §7:
 *
 *  1. a Latin word written all-caps or Capitalized that is **never** written
 *     lower-case anywhere in the corpus (the same evidence `english.ts` uses for
 *     proper nouns), immediately followed by 牌 / 公司 / 集团 / 工作室 / 官方;
 *  2. a transliterated Chinese word (`looksTransliterated`) that co-occurs with
 *     one of 穿 / 买 / 牌 / 款 within 12 characters at least three times.
 *
 * The context-free shape (a token that itself ends in a corporate suffix) is
 * handled in `classifyKinds`; it needs no corpus.
 */
function detectBrands(joined: string): Set<string> {
  const out = new Set<string>();

  const lowered = new Set<string>();
  for (const m of joined.matchAll(/\b[a-z][a-z0-9&.-]{1,20}\b/g)) lowered.add(m[0]);
  for (const m of joined.matchAll(/\b([A-Z][A-Za-z0-9&.-]{1,20})(?=\s?(?:牌|公司|集团|工作室|官方))/g)) {
    const w = m[1];
    if (!lowered.has(w.toLowerCase())) out.add(w.toLowerCase());
  }

  // Maximal runs of transliteration characters. A run is the candidate; scanning
  // every 2..5 character substring of the corpus would be quadratic and would
  // mostly produce fragments of ordinary sentences.
  const near = new Map<string, number>();
  let run = '', start = 0;
  const flush = (end: number) => {
    if (run.length >= 2 && run.length <= 5) {
      const window = joined.slice(Math.max(0, start - 12), end + 12);
      if (BRAND_CONTEXT.test(window.split(run).join(''))) near.set(run, (near.get(run) ?? 0) + 1);
    }
    run = '';
  };
  for (let i = 0; i < joined.length; i++) {
    if (TRANSLIT.has(joined[i])) { if (!run) start = i; run += joined[i]; }
    else if (run) flush(i);
  }
  if (run) flush(joined.length);
  for (const [w, n] of near) if (n >= 3) out.add(w);

  return out;
}

/**
 * All kinds a word matches, strongest first.
 *
 * A word can be several things at once (赵总 is a person *and* a title), so the
 * rules are all evaluated and the hits are ranked by `CONF`. `system` is
 * exclusive: it means the string is a SillyTavern field, not story content.
 * The list is never empty — `plain` is the fallback.
 */
export function classifyKinds(word: string, index: EntityIndex): KindTag[] {
  const tags: KindTag[] = [];
  const known = index.kindOf.get(word);
  if (known === 'system') return [{ kind: 'system', conf: CONF.system }];
  if (known) tags.push({ kind: known, conf: CONF.person });

  // Title suffixes are tested here, on tokenizer output.
  if (TITLE_RE.test(word)) {
    if (known !== 'person') tags.push({ kind: 'person', conf: CONF.personTitleForm });
    tags.push({ kind: 'title', conf: CONF.title });
  } else if (TITLE_WORDS.has(word)) {
    tags.push({ kind: 'title', conf: CONF.title });
  }

  if (!known) {
    if (!NOT_TIME.test(word) && TIME_RE.test(word)) tags.push({ kind: 'time', conf: CONF.time });
    else if (/^[a-z0-9.':]+$/i.test(word) && EN_TIME_RE.test(word)) tags.push({ kind: 'time', conf: CONF.time });
    else if (word.length >= 2 && PLACE_RE.test(word) && !NOT_PLACE.test(word)) {
      if (!AMBIG_TAIL.test(word)) tags.push({ kind: 'place', conf: CONF.place });
      else if (BODY_RE.test(word)) { /* body part, not a place */ }
      else if (AMBIG_PLACE2.has(word)) tags.push({ kind: 'place', conf: CONF.place });
      else if (word.length >= 3) tags.push({ kind: 'place', conf: CONF.placeWeak });
    }
  }

  // Garments. A word naming a body part is never re-read as clothing (胸口, 胸衣).
  if (word.length >= 2 && !NOT_WEAR.test(word) && !BODY_RE.test(word)
      && (WEAR_WORDS.has(word) || (WEAR_TAIL.test(word) && !DEFAULT_STOPWORDS.has(word)))) {
    tags.push({ kind: 'wear', conf: CONF.wear });
  }

  // Brands: the context-free corporate-suffix form, or what the corpus pass found.
  const brandForm = word.length >= 3 && BRAND_TAIL.test(word) && /[一-鿿A-Za-z]/.test(word[0]);
  if (brandForm || index.brands.has(word.toLowerCase())) {
    tags.push({ kind: 'brand', conf: CONF.brand });
  }

  /* ---- Batch-2 kinds (docs/33 §4). Additive: a word keeps every tag it earns. ----
     Person names are exempt from all of them. A given name can end in a seed
     character by coincidence — 周敬亭 was read as a 建筑 on the local logs because
     of 亭 — and a name is never also a piece of furniture. This is the only
     cross-kind exclusion; everything else is allowed to multi-tag. */
  if (tags.some((t) => t.kind === 'person')) return tags.sort((a, b) => b.conf - a.conf);
  const add = (kind: EntityKind) => tags.push({ kind, conf: CONF[kind] });

  if (KINSHIP_WORDS.has(word)) add('kinship');
  if (RELATION_WORDS.has(word)) add('relation');
  if (OCCUPATION_WORDS.has(word)
      || (!NOT_OCCUPATION.has(word) && suffixHit(word, OCCUPATION_TAIL, 3))) add('occupation');

  if (BUILDING_WORDS.has(word) || suffixHit(word, BUILDING_TAIL)) add('building');
  if (ROOM_WORDS.has(word) || suffixHit(word, ROOM_TAIL)) add('room');
  if (NATURE_WORDS.has(word) || (!NOT_NATURE.has(word) && suffixHit(word, NATURE_TAIL))) add('nature');

  if (FOOD_WORDS.has(word) || (!NOT_FOOD.has(word) && suffixHit(word, FOOD_TAIL))) add('food');
  if (DRINK_WORDS.has(word)) add('drink');
  if (FURNITURE_WORDS.has(word) || (!NOT_FURNITURE.has(word) && suffixHit(word, FURNITURE_TAIL))) add('furniture');
  if (CONTAINER_WORDS.has(word) || (!NOT_CONTAINER.has(word) && suffixHit(word, CONTAINER_TAIL))) add('container');
  if (VEHICLE_WORDS.has(word) || (!NOT_VEHICLE.has(word) && suffixHit(word, VEHICLE_TAIL))) add('vehicle');

  // Anatomy character + 部/口 is the same test that keeps body parts out of `place`.
  if (BODY_WORDS.has(word) || (word.length >= 2 && BODY_RE.test(word) && /[部口]$/.test(word))) add('body');
  if (COLOR_WORDS.has(word) || (!NOT_COLOR.has(word) && suffixHit(word, /色$/))) add('color');
  if (EMOTION_WORDS.has(word)) add('emotion');

  if (MONEY_WORDS.has(word) || MONEY_RE.test(word) || FEE_RE.test(word)) add('money');
  if (ORG_WORDS.has(word) || (word.length >= 2 && ORG_TAIL.test(word))) add('org');

  if (!tags.length) return [{ kind: 'plain', conf: CONF.plain }];
  return tags.sort((a, b) => b.conf - a.conf);
}

/**
 * Mark a word as `generic` (evenly spread over the messages, see analyze.ts).
 *
 * Before the 60-kind design a generic word could only ever be `plain`, and the
 * tag replaced it. Now a filler word may also carry a batch-2 construction tag
 * (`颜色`, `情绪` …), and dropping those would hide the word from its own kind
 * button. So: `plain` is still replaced outright — the counts the UI shows for
 * 其他 / 常见词 are unchanged — and any other tag is kept alongside.
 */
export function markGeneric(tags: KindTag[]): KindTag[] {
  const kept = tags.filter((t) => t.kind !== 'plain');
  return [...kept, { kind: 'generic' as const, conf: CONF.generic }].sort((a, b) => b.conf - a.conf);
}

/** Kind of a single word: the highest-confidence tag. Kept for callers that want one label. */
export function classify(word: string, index: EntityIndex): EntityKind {
  return classifyKinds(word, index)[0].kind;
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

/* ---------- Coreference candidates (task T6) ----------
   A full name is written out once and then shortened: 赵一文 becomes 一文, 小赵,
   赵先生. The word list shows those as four unrelated words, each carrying a
   fraction of the count.

   This stage proposes the grouping. It does **not** touch the frequency table —
   `analyze()` reports the groups and the UI folds them into one row, so a wrong
   proposal costs a display row, not a corrupted count.

   No dictionary is involved (hard rule 3): the variants are generated from the
   full name by morphology, and the corpus only ever *rejects* them. */

/** A full name and the surface forms judged to refer to the same person. */
export interface CorefGroup {
  full: string;
  /** Variants, most frequent first. Never contains `full`. */
  aliases: string[];
}

/**
 * Full names considered, most frequent first. The pass costs one corpus scan per
 * candidate string, and the tail of `personNames` (hundreds of entries on a real
 * export, mostly two-character noise) is not worth scanning.
 */
const COREF_MAX_FULL = 24;
/**
 * Rule 1 — a variant must occur **on its own** at least this many times. Three is
 * the floor `detectEntities` already uses for a name candidate: below it a string
 * is as likely to be a typo or a one-off as a nickname.
 */
const COREF_MIN_COUNT = 3;
/**
 * Rule 3 — the variant and the full name share at least this share of the rarer
 * form's messages. 0.15 is deliberately low: an alias is used *instead of* the
 * full name, so a high rate is not expected; the floor only rules out a pair that
 * meets by accident.
 */
const COREF_MIN_COOCCUR = 0.15;
/**
 * Distinct syntactic positions (`EntityIndex.personConfidence`) a Chinese full
 * name must hit before it may absorb other words. Calibrated on the local
 * 473-message export: the eight real characters score 5..7, the mis-captures the
 * positional rules also promote (沈好放, 钱一并, 王德海) score 1..3.
 */
const COREF_MIN_CONFIDENCE = 4;

/** Occurrences of `needle` in `hay`, counted without overlap. */
function countOf(hay: string, needle: string): number {
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) >= 0) { n++; i += needle.length; }
  return n;
}

/** English honorifics; each needs the surname spelt exactly as in the full name. */
const EN_HONORIFICS = ['Mr.', 'Mrs.', 'Ms.', 'Miss', 'Dr.'];

/**
 * Honorifics used only here, not in `TITLE_RE`. 赵导 is how a director is
 * addressed on set, but `^[一-鿿]{1,3}导$` also matches 领导 / 报导 / 主导 /
 * 教导, so the suffix cannot join the context-free title rule. It is safe in
 * this stage because the prefix is not any character — it is the surname of a
 * full name the corpus already established.
 */
const COREF_EXTRA_SUFFIXES = ['导'];

/**
 * The forms a full name can be shortened to. Morphology only — every string here
 * still has to survive the corpus tests in `detectCoref`.
 *
 * Chinese, surname `A` + given name `BC`: `BC` (drop the surname), `小A`, `老A`,
 * `A` + each honorific seed (`TITLE_SUFFIXES`, so 赵总 / 赵先生 / 赵律师 are
 * exactly the forms `TITLE_RE` recognises), and the doubled-syllable nicknames
 * `BB` / `CC`. A compound surname (欧阳) drops two characters instead of one.
 *
 * English, `First Last`: `First`, `Last`, `Mr./Mrs./Ms. Last`, `First's`.
 */
function corefVariants(full: string): { v: string; title: boolean }[] {
  const out: { v: string; title: boolean }[] = [];
  const bare = (v: string) => out.push({ v, title: false });
  const titled = (v: string) => out.push({ v, title: true });
  if (EN_FULLNAME_RE.test(full)) {
    const [first, last] = full.split(' ');
    bare(first); bare(last); bare(`${first}'s`); bare(`${first}’s`);
    for (const h of EN_HONORIFICS) titled(`${h} ${last}`);
    return out;
  }
  if (!/^[一-鿿]{3,4}$/.test(full)) return out;
  const compound = COMPOUND_SURNAMES.includes(full.slice(0, 2));
  const surname = compound ? full.slice(0, 2) : full[0];
  const given = full.slice(surname.length);
  // Only 姓 + 双字名 has a short form that is still a name: dropping the surname of
  // 李明 leaves a single character, which is an ordinary word far more often.
  if (given.length === 2) { bare(given); bare(given[0] + given[0]); bare(given[1] + given[1]); }
  bare(`小${surname}`); bare(`老${surname}`);
  for (const s of [...TITLE_SUFFIXES, ...COREF_EXTRA_SUFFIXES]) titled(surname + s);
  return out;
}

/**
 * Group the surface forms that refer to the same person.
 *
 * @param texts one cleaned message per entry — co-occurrence is measured per message
 * @param names full-name candidates (`EntityIndex.personNames` plus the English pairs)
 * @param index the entity index; unused for now beyond keeping the signature honest
 *
 * A variant is accepted only when **all four** conditions hold:
 *
 *  1. it occurs at least `COREF_MIN_COUNT` times *outside* every tracked full name
 *     that contains it. Without the subtraction 砚秋 would "occur" 680 times purely
 *     as the tail of 沈砚秋 and every full name would merge with its own substring;
 *  2. it is not a name in its own right: `looksLikePerson` must reject it (a string
 *     that parses as surname + given name is a different person, not a short form),
 *     it must not be one of the tracked full names, and it must not be proposed by
 *     two different full names — 沈砚秋 and 沈高飞 both generate 小沈 and 沈老师,
 *     and nothing in the text says which one is meant;
 *  3. it either shares at least `COREF_MIN_COOCCUR` of the rarer form's messages
 *     with the full name, or never appears in the same message at all
 *     (complementary distribution: the writer uses one form or the other);
 *  4. it is not a stop word, a kinship term, a form of address, or a word the
 *     segmenter already knows — 老公 and 小三 are built by the same morphology as
 *     老沈 and 小赵 and are ordinary words.
 *
 * On condition 2: the drop-surname form of a real name is itself almost always
 * detected as a person (高飞 is, with ~980 standalone occurrences), so "not an
 * independently recognised person" is read as "not an independently recognised
 * **full** name". Read literally the condition rejects every true alias and leaves
 * the rule with zero recall.
 */
export function detectCoref(
  texts: readonly string[],
  names: readonly string[],
  index: EntityIndex,
  /**
   * `allowComplementary: false` drops the second half of condition 3. The
   * harness (`npm run eval:persons`) sweeps it, because that branch is what
   * admits both of the mis-merges measured on the local corpus.
   */
  opts: { allowComplementary?: boolean } = {},
): CorefGroup[] {
  const allowComplementary = opts.allowComplementary ?? true;
  const joined = texts.join('\n');
  // Only a string that reads as a complete name has short forms. `looksLikePerson`
  // is the corpus-free half of the person rules and already demands a surname and
  // an out-of-vocabulary reading, which is what keeps 这句话 / 两个字 — three-character
  // strings the positional rules do promote to `person` — out of this stage.
  // 姓 + 称谓 (周叔叔, 尹阿姨, 沈老师) is excluded as well: it is already a short
  // form, and treating it as a full name makes every *real* 周x short form look
  // ambiguous between it and 周敬亭.
  const isAddressForm = (n: string) => TITLE_RE.test(n)
    || [...KINSHIP_TERMS, ...ADDRESS].some((k) => n !== k && n.endsWith(k));
  const shaped = names.filter((n) => looksLikePerson(n) && !isAddressForm(n)
    // A full name only gets to absorb other words when the positional evidence
    // behind it is strong: on the local logs the real names sit at 5..7 distinct
    // patterns and the mis-captures (沈好放, 钱一并) at 1..3. English pairs carry
    // capitalisation evidence instead (english.ts) and have no entry here.
    && (EN_FULLNAME_RE.test(n) || (index.personConfidence.get(n) ?? 0) >= COREF_MIN_CONFIDENCE));
  if (!shaped.length) return [];

  const fullCount = new Map<string, number>();
  for (const n of shaped) fullCount.set(n, countOf(joined, n));
  const fulls = [...fullCount.entries()]
    .filter(([, c]) => c >= COREF_MIN_COUNT)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, COREF_MAX_FULL)
    .map(([n]) => n);
  const fullSet = new Set(fulls);

  // Condition 2, ambiguity half: a variant proposed by two full names is dropped.
  const proposedBy = new Map<string, Set<string>>();
  const variantsOf = new Map<string, { v: string; title: boolean }[]>();
  for (const full of fulls) {
    const seen = new Set<string>([full]);
    const vs = corefVariants(full).filter((x) => x.v && !seen.has(x.v) && seen.add(x.v));
    variantsOf.set(full, vs);
    for (const { v } of vs) (proposedBy.get(v) ?? proposedBy.set(v, new Set()).get(v)!).add(full);
  }

  /** Full names that contain `v`; their occurrences are not occurrences of `v`. */
  const containers = new Map<string, string[]>();
  const standalone = (hay: string, v: string) => {
    let owners = containers.get(v);
    if (!owners) containers.set(v, (owners = fulls.filter((f) => f !== v && f.includes(v))));
    let n = countOf(hay, v);
    for (const f of owners) n -= countOf(hay, f);
    return Math.max(0, n);
  };

  const out: CorefGroup[] = [];
  for (const full of fulls) {
    const docsFull = texts.reduce((a, t) => a + (t.includes(full) ? 1 : 0), 0);
    const kept: { v: string; n: number }[] = [];
    for (const { v, title } of variantsOf.get(full)!) {
      if (proposedBy.get(v)!.size > 1) continue;                        // 2: ambiguous
      // 2: a name of its own. The honorific forms are exempt because they *are*
      // built from this full name's surname — `looksLikePerson` recognises 周老师
      // as a person precisely because of the construction we just applied.
      if (fullSet.has(v) || (!title && looksLikePerson(v))) continue;
      if (DEFAULT_STOPWORDS.has(v) || KINSHIP_TERMS.has(v)
        || ADDRESS.has(v) || TITLE_WORDS.has(v)) continue;              // 4: closed lists
      if (/^[一-鿿]+$/.test(v) && !isOov(v)) continue;                   // 4: a word the segmenter knows
      const n = standalone(joined, v);
      if (n < COREF_MIN_COUNT) continue;                                // 1
      let both = 0, docsVar = 0;
      for (const t of texts) {
        if (!standalone(t, v)) continue;
        docsVar++;
        if (t.includes(full)) both++;
      }
      if (!docsVar) continue;
      const denom = Math.min(docsFull, docsVar);
      // Complementary distribution (both === 0) is accepted; a low but non-zero
      // overlap is the shape of two words that merely share a scene.
      if (both === 0 ? !allowComplementary
        : (denom <= 0 || both / denom < COREF_MIN_COOCCUR)) continue;               // 3
      kept.push({ v, n });
    }
    if (kept.length) {
      kept.sort((a, b) => b.n - a.n || a.v.localeCompare(b.v));
      out.push({ full, aliases: kept.map((k) => k.v) });
    }
  }
  return out;
}

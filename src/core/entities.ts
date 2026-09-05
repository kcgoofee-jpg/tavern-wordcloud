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
  | 'kinship' | 'occupation' | 'relation' | 'ethnicity' | 'rank'
  // Group 3 places and buildings
  | 'building' | 'room' | 'nature' | 'region' | 'path'
  // Group 4 time and quantity
  | 'money' | 'festival' | 'measure' | 'number'
  // Group 5 things
  | 'food' | 'drink' | 'furniture' | 'container' | 'vehicle'
  | 'device' | 'weapon' | 'jewelry'
  // Group 6 materials and nature
  | 'material' | 'plant' | 'animal' | 'weather'
  // Group 7 body and senses
  | 'body' | 'color' | 'sound' | 'smell' | 'texture' | 'illness'
  // Group 8 behaviour and feeling
  | 'emotion' | 'speech' | 'thought' | 'desire'
  // Group 9 society
  | 'org' | 'document' | 'media' | 'event' | 'law'
  // Group 10 culture and language
  | 'myth' | 'martial' | 'onomatopoeia';

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
  ethnicity: zh('族群与国籍'),
  rank: zh('头衔等级'),
  building: zh('建筑'),
  room: zh('室内空间'),
  nature: zh('自然景观'),
  region: zh('行政区划'),
  path: zh('道路与交通设施'),
  money: zh('钱'),
  measure: zh('度量单位'),
  number: zh('数量'),
  food: zh('食物'),
  drink: zh('饮品'),
  furniture: zh('家具'),
  container: zh('容器'),
  vehicle: zh('交通工具'),
  body: zh('身体部位'),
  color: zh('色彩'),
  emotion: zh('情绪'),
  org: zh('机构'),
  festival: zh('节日'),
  device: zh('电子设备'),
  weapon: zh('武器'),
  jewelry: zh('首饰'),
  material: zh('材质'),
  plant: zh('植物'),
  animal: zh('动物'),
  weather: zh('天气'),
  sound: zh('声音'),
  // 「气味」 is already an NSFW category label (i18n keys are the Chinese source
  // strings, so the two would collide); the sense is named after the sense.
  smell: zh('嗅觉'),
  texture: zh('触感'),
  illness: zh('伤病'),
  speech: zh('言语'),
  thought: zh('心理'),
  desire: zh('欲望'),
  document: zh('文书'),
  media: zh('作品与媒体'),
  event: zh('事件与仪式'),
  law: zh('法律'),
  myth: zh('神话与超自然'),
  martial: zh('武侠与修真'),
  onomatopoeia: zh('拟声词'),
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
  { id: 'people', label: zh('人物与身份'), kinds: ['title', 'kinship', 'occupation', 'relation', 'ethnicity', 'rank'] },
  { id: 'space', label: zh('地点与建筑'), kinds: ['building', 'room', 'nature', 'region', 'path'] },
  { id: 'count', label: zh('时间与数量'), kinds: ['money', 'festival', 'measure', 'number'] },
  { id: 'thing', label: zh('物品'), kinds: ['brand', 'wear', 'food', 'drink', 'furniture', 'container', 'vehicle', 'device', 'weapon', 'jewelry'] },
  { id: 'matter', label: zh('材料与自然物'), kinds: ['material', 'plant', 'animal', 'weather'] },
  { id: 'sense', label: zh('身体与感官'), kinds: ['body', 'color', 'sound', 'smell', 'texture', 'illness'] },
  { id: 'act', label: zh('行为与情绪'), kinds: ['emotion', 'speech', 'thought', 'desire'] },
  { id: 'social', label: zh('社会与组织'), kinds: ['org', 'document', 'media', 'event', 'law'] },
  { id: 'culture', label: zh('文化与语言'), kinds: ['myth', 'martial', 'onomatopoeia'] },
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
export const EXPERIMENTAL_KINDS: EntityKind[] = [
  'brand',
  /**
   * Both cleared the 80% line on the hand-written cases, and both then over-fired
   * on the local TOP 200, which is the check that actually finds things (docs/33
   * §7): the 件 rule read the measure-word fragment 穿一件 as a document, and the
   * 想 rule read 我想 / 他想 as thoughts. They are patched, not proven — the seed
   * characters stay the most ambiguous of the batch, so the UI says so.
   */
  'document', 'thought',
];

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
  /**
   * Batch-3 kinds (docs/33, second half of the 60). Every one of them sits
   * **below** the whole of batch 2, so this batch cannot change the primary kind
   * of any word that already had one — the strongest tag only ever moves when a
   * word's only previous tag was `plain`. Inside the batch the order is again
   * specificity: a closed form-class first, then a suffix rule, then the rules
   * whose seed characters are the most ambiguous.
   */
  animal: 0.49,
  material: 0.48,
  jewelry: 0.47,
  texture: 0.46,
  festival: 0.46,
  weather: 0.45,
  plant: 0.44,
  illness: 0.43,
  myth: 0.43,
  martial: 0.42,
  desire: 0.42,
  weapon: 0.41,
  device: 0.4,
  thought: 0.39,
  sound: 0.38,
  smell: 0.37,
  speech: 0.36,
  document: 0.35,
  media: 0.34,
  event: 0.33,
  /**
   * Batch-4 kinds (docs/33 §5). Every one of them sits **below** `event`, so this
   * batch cannot change the primary kind of any word that already had one — a
   * 朝阳区 stays `place`, 筑基 stays `martial`, 法院 stays `org`. Inside the
   * batch the order is again specificity (closed nationality before a 人/族
   * suffix, 爵 before 级).
   */
  ethnicity: 0.329,
  rank: 0.328,
  law: 0.327,
  measure: 0.326,
  onomatopoeia: 0.325,
  number: 0.324,
  region: 0.323,
  path: 0.322,
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

/* ==========================================================================
   Batch-3 kinds (notes/docs/33 §5, the second half of the sixty). Same contract
   as batch 2: every block is a construction — a suffix, a closed form-class, or
   a fixed compounding template — of at most 40 seeds counting the counter-example
   list, never a lexicon to look words up in (docs/33 §2). The counter-examples
   are not guesses: each one is a word the suffix actually reached on the local
   TOP-200 pass or an obvious confusable of the same shape.
   ========================================================================== */

/* ---------- 材质 (`material`) ----------
   Closed list only. The design note offers …质 / …料 as suffixes, but 本质 /
   性质 / 素质 and 资料 / 照料 / 饮料 outnumber the material readings, so neither
   is safe as a rule and the class is small enough to close by hand. */
const MATERIAL_WORDS = new Set([
  '木头', '木材', '钢铁', '不锈钢', '玻璃', '塑料', '陶瓷', '瓷器', '大理石', '石头',
  '棉花', '丝绸', '皮革', '真皮', '牛皮', '羊毛', '亚麻', '尼龙', '帆布', '纸张',
  '橡胶', '水泥', '混凝土', '青铜', '黄铜', '白银', '黄金', '合金', '布料', '麻布',
  '天鹅绒', '蕾丝', '绸缎', '红木', '琉璃', '泡沫',
]);

/* ---------- 植物 (`plant`) ----------
   花 is deliberately not a suffix: 烟花 / 火花 / 浪花 / 雪花 / 泪花 all end in it
   and none is a plant, so flower names are reached through the closed list. */
const PLANT_TAIL = /(?:树|草|叶|枝|藤|竹)$/;
const NOT_PLANT = new Set(['潦草', '起草', '爆竹']);
const PLANT_WORDS = new Set([
  '玫瑰', '樱花', '桃花', '荷花', '菊花', '兰花', '百合', '牡丹', '梅花', '杏花',
  '梨花', '向日葵', '蔷薇', '薰衣草', '仙人掌', '苔藓', '蘑菇', '银杏', '花瓣', '花朵',
  '花束', '树干', '树根', '树苗', '盆栽', '绿植', '藤蔓', '荆棘', '麦子', '玉米', '小麦',
]);

/* ---------- 动物 (`animal`) ----------
   Closed: the animals narration actually names. No suffix rule — 龙头 / 马路 /
   牛奶 / 虎口 are built on exactly these characters. */
const ANIMAL_WORDS = new Set([
  '猫', '狗', '小猫', '小狗', '猫咪', '鸟儿', '鱼儿', '马儿', '老虎', '狮子',
  '狼群', '熊猫', '狐狸', '老鼠', '蛇', '龙', '凤凰', '大象', '猴子', '鹿',
  '老鹰', '乌鸦', '麻雀', '蝴蝶', '蜘蛛', '蚂蚁', '蜜蜂', '青蛙', '鲨鱼', '海豚',
  '骏马', '母马', '野兽', '猛兽', '宠物', '幼崽', '兔子', '羊群', '牛群', '猎犬',
]);

/* ---------- 天气 (`weather`) ----------
   雨 / 雪 are safe suffixes (大雨 细雨 暴雨 / 大雪 风雪); 风 is not — 作风 /
   家风 / 通风 / 中风 swamp it, so wind words are listed. */
const WEATHER_TAIL = /(?:雨|雪)$/;
const NOT_WEATHER = new Set(['血雨', '泪雨', '洗雪']);
const WEATHER_WORDS = new Set([
  '大风', '微风', '冷风', '狂风', '台风', '龙卷风', '寒风', '暖风', '晚风', '夜风',
  '雾气', '浓雾', '薄雾', '闪电', '雷电', '雷鸣', '霜冻', '露水', '晴天', '阴天',
  '多云', '冰雹', '彩虹', '天气', '气温', '阳光', '月光', '天晴', '放晴', '寒气',
  '暑气', '冰霜',
]);

/* ---------- 电子设备 (`device`) ----------
   …机 / …器 are productive but the two-character words built on them are almost
   never devices (危机 时机 动机 生机 / 武器 容器 器官 乐器), so the suffix rule
   needs three characters. The remaining three-character misfires are vehicles
   and anatomy, listed below; two-character devices are in the closed list. */
const DEVICE_TAIL = /(?:机|器)$/;
const NOT_DEVICE = new Set(['直升机', '拖拉机', '战斗机', '轰炸机', '救护机', '运输机', '生殖器', '消化器']);
const DEVICE_WORDS = new Set([
  '手机', '电脑', '相机', '屏幕', '键盘', '鼠标', '耳机', '音响', '音箱', '充电器',
  '数据线', '电视', '冰箱', '空调', '洗衣机', '微波炉', '吹风机', '电灯', '电扇', '摄像头',
  '监控', '平板', '电话', '座机', '遥控器', '闹钟', '显示器', '路由器', '投影仪', '摄像机',
]);

/* ---------- 武器 (`weapon`) ----------
   矛盾 is the one that matters: it is a contradiction, not a pike and a shield,
   and it is far more frequent than either. */
const WEAPON_TAIL = /(?:刀|剑|枪|炮|弓|箭|斧|锤|矛|盾|弹)$/;
const NOT_WEAPON = new Set(['矛盾', '开枪', '中枪', '鞭炮', '放炮', '反弹', '回弹', '剪刀']);
const WEAPON_WORDS = new Set([
  '匕首', '手枪', '步枪', '手榴弹', '炸弹', '子弹', '导弹', '长剑', '宝剑', '佩剑',
  '长枪', '弓箭', '盔甲', '铠甲', '武器', '兵器', '暗器', '军刀', '战斧', '盾牌', '箭矢',
]);

/* ---------- 首饰 (`jewelry`) ----------
   镯 / 簪 / 钗 end essentially nothing else. Gemstone names are left out on
   purpose: docs/33 §6 dropped 矿物与宝石 because 玉 cannot be split between
   material and jewel without knowing what it modifies. */
const JEWELRY_TAIL = /(?:镯|簪|钗)$/;
const JEWELRY_WORDS = new Set([
  '戒指', '项链', '耳环', '耳坠', '耳钉', '手镯', '手链', '脚链', '胸针', '发簪',
  '玉佩', '吊坠', '首饰', '珠宝', '钻戒', '金饰', '银饰', '头饰', '发饰', '项圈',
  '袖扣', '玉镯', '手串', '佛珠', '婚戒', '挂坠',
]);

/* ---------- 声音 (`sound`) ----------
   …声 / …响 is the most productive suffix in the whole batch (脚步声 关门声
   呼吸声 都不用列). Its misfires are of two kinds and both are listed: the
   adverbs built on 声 (大声 低声 轻声) and the abstract nouns (名声 影响 交响). */
const SOUND_TAIL = /(?:声|响)$/;
const NOT_SOUND = new Set([
  '名声', '影响', '音响', '交响', '反响', '大声', '小声', '低声', '轻声', '高声', '出声', '齐声',
]);
const SOUND_WORDS = new Set([
  '声音', '噪音', '嗓音', '口音', '尖叫', '呐喊', '杂音', '静音',
  '音量', '响动', '动静', '音色', '重音', '嘶吼', '呻吟', '喘息',
]);

/* ---------- 气味 (`smell`) ----------
   …味 / …香 with the evaluative senses excluded: 意味 / 品味 / 趣味 / 回味 are
   about judgement, not the nose, and 口味 / 滋味 / 美味 are taste. */
const SMELL_TAIL = /(?:味|香)$/;
const NOT_SMELL = new Set([
  '意味', '品味', '趣味', '回味', '乏味', '兴味', '入味', '美味', '口味', '滋味', '烧香',
]);
const SMELL_WORDS = new Set([
  '气味', '香水', '气息', '味道', '芬芳', '熏香', '檀香', '麝香', '恶臭', '臭气', '香气', '体香',
]);

/* ---------- 触感 (`texture`) ----------
   Closed: temperature and surface words as they are used of touch. 温柔 and
   冷漠 are about a person, not a surface, and stay out. */
const TEXTURE_WORDS = new Set([
  '冰凉', '冰冷', '温热', '滚烫', '灼热', '炙热', '温暖', '柔软', '松软', '柔滑',
  '光滑', '顺滑', '粗糙', '坚硬', '僵硬', '湿润', '潮湿', '干燥', '干涩', '黏腻',
  '湿滑', '温软', '酥麻', '麻木', '紧绷', '蓬松', '细腻', '厚实', '轻盈', '冰寒',
]);

/* ---------- 伤病 (`illness`) ----------
   …伤 / …病 / …症 / …痛 minus the feelings built on the same characters
   (悲伤 哀伤 心痛 悲痛 are `emotion`) and the verb-object phrases (受伤 生病
   看病 疗伤). */
const ILLNESS_TAIL = /(?:伤|病|症|痛)$/;
const NOT_ILLNESS = new Set([
  '悲伤', '哀伤', '感伤', '忧伤', '中伤', '受伤', '生病', '看病', '治病', '疗伤', '心痛', '悲痛',
]);
const ILLNESS_WORDS = new Set([
  '伤口', '伤疤', '骨折', '高烧', '发烧', '感冒', '咳嗽', '呕吐', '头晕', '眩晕',
  '昏迷', '中毒', '过敏', '失眠', '淤青', '疤痕', '病情', '症状', '药物', '药片',
]);

/* ---------- 言语 (`speech`) ----------
   The bare 道 suffix is unusable (知道 味道 街道 难道 频道 跑道), but the
   *speech-verb* + 道 template is a closed two-character construction and it is
   the single most common speech form in these logs. Plus the closed list of
   speech acts. */
const SAY_DAO_RE = /^[说问答喊叫笑骂吼应回续哼]道$/;
const SPEECH_WORDS = new Set([
  '说话', '讲话', '对话', '交谈', '聊天', '闲聊', '议论', '讨论', '争论', '争吵',
  '吵架', '解释', '说明', '承诺', '命令', '警告', '提醒', '抱怨', '唠叨', '嘟囔',
  '低语', '耳语', '呢喃', '嘀咕', '沉默', '口吻', '语气',
]);

/* ---------- 心理 (`thought`) ----------
   …念 / …忆 / …想. The misfire the local TOP 200 actually produced is the
   pronoun + 想 fragment (我想 / 他想 / 你想 all reach the word list), so those
   are listed; 纪念 and 悬念 are the other two shapes that are not thoughts. */
const THOUGHT_TAIL = /(?:念|忆|想)$/;
const NOT_THOUGHT = new Set([
  '我想', '你想', '他想', '她想', '不想', '没想', '别想', '要想', '敢想', '休想',
  '试想', '只想', '纪念', '悬念',
]);
const THOUGHT_WORDS = new Set([
  '想法', '心思', '思绪', '直觉', '错觉', '印象', '疑惑', '困惑', '好奇', '意识',
  '潜意识', '灵感', '主意', '打算', '决心', '判断', '想象', '认知', '观点', '看法',
  '念头', '脑海', '思考',
]);

/* ---------- 欲望 (`desire`) ----------
   …欲 is a clean suffix (食欲 性欲 情欲 私欲 占有欲 控制欲 求知欲): almost
   nothing else ends in it as a standalone token. */
const DESIRE_TAIL = /欲$/;
const DESIRE_WORDS = new Set([
  '渴望', '愿望', '冲动', '贪婪', '野心', '执念', '好胜心', '渴求', '奢望', '妄念',
  '痴念', '企图', '野望', '贪心', '占有', '迷恋', '痴迷', '觊觎', '憧憬', '向往',
  '心愿', '念想', '欲望',
]);

/* ---------- 文书 (`document`) ----------
   …书 / …单 / …证 / …函 / …件 at three characters or more. Every two-character
   word on these characters is ambiguous (秘书 床单 保证 事件 条件 软件), and the
   documents among them are listed instead. */
const DOCUMENT_TAIL = /(?:书|单|证|函|件)$/;
/**
 * Second clause: a **measure-word phrase**, not a document. `QUANT_HEAD` only
 * looks at the first character, so 穿一件 walked straight through the 件 rule and
 * reached the local TOP 200 as a 文书 (2026-09-05). Any quantifier immediately in
 * front of the suffix character means the token is a fragment of 数词 + 量词.
 */
const NOT_DOCUMENT = /(?:简单|保证|事件|条件|零件|部件|软件|硬件|物件|证明)$|(?:[一二两三四五六七八九十几半这那每某另整]|\d)[书单证函件]$/;
const DOCUMENT_WORDS = new Set([
  '合同', '协议', '文件', '剧本', '名片', '证件', '简历', '报告', '名单', '清单',
  '账单', '菜单', '订单', '发票', '收据', '信件', '邮件', '通知', '公告', '契约',
  '遗嘱', '档案', '资料', '笔记', '日记',
]);

/* ---------- 作品与媒体 (`media`) ----------
   …剧 / …曲 only. 片 / 集 / 说 were dropped: 照片 碎片 药片 卡片, 集合, 听说
   据说 虽说 are all more frequent than the work readings. */
const MEDIA_TAIL = /(?:剧|曲)$/;
const NOT_MEDIA = new Set(['加剧', '急剧', '恶作剧', '弯曲', '扭曲', '蜷曲']);
const MEDIA_WORDS = new Set([
  '电影', '电视剧', '小说', '综艺', '专辑', '歌曲', '音乐', '节目', '纪录片', '动画',
  '漫画', '游戏', '杂志', '报纸', '新闻', '广告', '直播', '视频', '照片', '画作',
  '诗集', '剧集', '预告片', '主题曲', '台词', '影视', '镜头', '剧本',
]);

/* ---------- 事件与仪式 (`event`) ----------
   礼 / 赛 / 典 work at two characters; 式 and 会 need three, because 方式 形式
   模式 样式 公式 and 机会 社会 一会 体会 误会 are the two-character majority.
   委员会 / 基金会 are institutions and stay with `org`. */
const EVENT_TAIL = /(?:礼|赛|典)$/;
const EVENT_TAIL3 = /(?:式|会)$/;
const NOT_EVENT = new Set([
  '敬礼', '行礼', '送礼', '失礼', '无礼', '有礼', '委员会', '基金会', '方程式', '表达式',
]);
const EVENT_WORDS = new Set([
  '婚礼', '葬礼', '会议', '发布会', '比赛', '典礼', '婚宴', '宴会', '舞会', '晚会',
  '聚会', '约会', '面试', '演出', '演唱会', '展览', '仪式', '庆典', '派对', '聚餐',
  '拍摄', '试镜', '开机', '杀青', '探班',
]);

/* ---------- 神话与超自然 (`myth`) ----------
   仙 / 魔 / 妖 are the three that carry no everyday reading. 神 / 灵 / 鬼 / 怪
   were dropped from the suffix — 精神 眼神 走神, 心灵 机灵 失灵, 见鬼 搞鬼,
   奇怪 古怪 难怪 would have needed a longer exception list than the class. */
const MYTH_TAIL = /(?:仙|魔|妖)$/;
const NOT_MYTH = new Set(['水仙', '入魔', '着魔', '成魔']);
const MYTH_WORDS = new Set([
  '神明', '神灵', '神仙', '女神', '死神', '天神', '天使', '恶魔', '魔鬼', '恶鬼',
  '厉鬼', '鬼魂', '幽灵', '亡灵', '精灵', '妖怪', '妖精', '巫师', '巫婆', '术士',
  '吸血鬼', '狼人', '僵尸', '神话', '传说', '魔法', '法术', '咒语', '诅咒', '结界',
  '灵异', '仙人', '灵魂',
]);

/* ---------- 武侠与修真 (`martial`) ----------
   …诀 is the only safe suffix (口诀 心诀 剑诀 法诀); …功 / …气 / …丹 would take
   成功 / 生气 天气 语气 / 牡丹 with them. The cultivation stages are a closed
   set — the ladder is fixed by the genre, not sampled from it. */
const MARTIAL_TAIL = /诀$/;
const NOT_MARTIAL = new Set(['秘诀']);
const MARTIAL_WORDS = new Set([
  '内力', '真气', '内功', '武功', '招式', '剑法', '刀法', '拳法', '心法', '功法',
  '秘籍', '剑气', '灵力', '灵气', '灵石', '丹药', '仙丹', '灵丹', '修为', '境界',
  '筑基', '金丹', '元婴', '化神', '渡劫', '轻功', '点穴', '经脉', '丹田', '气海',
  '修炼', '打坐', '入定', '天劫', '法宝', '剑意',
]);

/* ---------- 节日 (`festival`) ----------
   Split out of `time` (docs/33 §5 group 4). The words keep their `time` tag —
   it has the higher confidence, so 圣诞节 still reads as 时间 — and gain a
   second one, which is what the additive design is for. 节 alone is not a
   suffix: 细节 环节 章节 情节 季节 关节 调节 all end in it. */
const FESTIVAL_RE = /^(?:春|元|中秋|端午|清明|重阳|七夕|圣诞|万圣|感恩|情人|愚人|劳动|国庆|儿童|母亲|父亲|教师|平安|建军|复活|光棍|妇女)节$/;
const FESTIVAL_WORDS = new Set([
  '元旦', '春节', '除夕', '新年', '跨年', '年夜', '中秋', '端午', '清明', '七夕',
  '圣诞', '万圣', '元宵', '腊八', '小年', '平安夜',
]);

/* ==========================================================================
   Batch-4 kinds (notes/docs/33 §5, the unimplemented rows). Same contract as
   batches 2–3: a construction of at most ~40 seeds, never a lexicon. Every
   CONF value sits below `event` (0.33), so these tags are additive — they
   cannot steal the primary kind of a word that already had one.
   ========================================================================== */

/* ---------- 拟声词 (`onomatopoeia`) ----------
   Reduplication of a closed set of sound-characters (砰砰 咚咚 嗡嗡), plus
   the two-character onomatopoeia that are not AA (哗啦 叮当 咔嚓). Not every
   reduplication: 哥哥 爸爸 are kinship, 往往 渐渐 are adverbs, and 哈哈 is
   already a stop word. */
const ONO_CHAR = new Set('砰咚嗡啪咔咯吱呼哗叮铃轰咕啾喵汪嘎嘶嗷呜当嚓啦噗嗒隆哐'.split(''));
const ONO_WORDS = new Set([
  '哗啦', '叮当', '咔嚓', '咯吱', '轰隆', '扑通', '叮咚', '滴答', '吧嗒', '咕咚',
  '哐当', '呼哧', '喀嚓', '咕噜', '叽里',
]);

/* ---------- 度量单位 (`measure`) ----------
   Closed two-or-more-character units only. 米 / 克 / 度 / 升 as suffixes would
   take 米饭 米粒, names ending in 米, and 温度 with them; 分钟 / 小时 are time
   and stay with `time`. */
const MEASURE_WORDS = new Set([
  '厘米', '毫米', '公里', '公斤', '千克', '毫升', '平方米', '立方米', '公顷', '英寸',
  '英尺', '海里', '摄氏度', '平方厘米', '公升', '毫克', '微米', '千米', '吨位', '千瓦',
  '加仑', '英里', '公分', '立方厘米',
]);

/* ---------- 族群与国籍 (`ethnicity`) ----------
   Closed nationalities and races, plus …人 / …族 at length ≥ 3 when the stem
   is a country/region, a myth race, or a closed ethnicity morpheme. Two-character
   兽人 / 魔族 / 人族 / 汉族 live in the closed list; 工人 主人 家人 大人 女人
   男人 are two characters and never reach the suffix. */
const ETHNICITY_WORDS = new Set([
  '中国人', '法国人', '美国人', '日本人', '韩国人', '英国人', '德国人',
  '汉族', '苗族', '满族', '回族', '藏族', '彝族', '壮族',
  '精灵族', '兽人', '魔族', '人族', '妖族', '仙族', '黑人', '白人',
]);
const ETHNICITY_STEMS = new Set([
  '汉', '苗', '满', '回', '藏', '彝', '壮', '维', '傣', '白',
  '精灵', '兽', '魔', '人', '妖', '仙', '龙', '鬼', '神',
]);
const NOT_ETHNICITY = new Set([
  '工人', '主人', '家人', '大人', '女人', '男人', '老人', '好人', '坏人', '情人',
  '友人', '证人', '路人', '路人甲', '客人', '诗人', '本人', '他人', '私人', '众人',
  '商人', '病人', '犯人', '猎人', '军人',
]);

/* ---------- 头衔等级 (`rank`) ----------
   Military ranks, peerage, and cultivation stages. 陛下 is a `title`, not a
   rank. …期 only when the stem is already a martial stage (筑基期), so 时期
   长期 期待 never fire. …级 at three characters minus the generic 国家级
   世界级. Rank CONF sits below `martial`, so 筑基 stays martial. */
const RANK_WORDS = new Set([
  '上校', '中校', '少校', '中尉', '上尉', '少尉', '元帅', '上将', '中将', '少将',
  '大尉', '伯爵', '公爵', '侯爵', '男爵', '子爵', '亲王', '国王', '皇帝',
  '筑基期', '金丹期', '元婴期', '化神期', '练气期',
]);
const NOT_RANK = new Set([
  '阶级', '超级', '等级', '升级', '降级', '班级', '年级', '国家级', '世界级', '专业级',
  '时期', '长期', '期待', '手段', '地段', '阶段', '片段', '陛下',
]);

/* ---------- 法律 (`law`) ----------
   Closed legal nouns plus …罪, …条款, and …法 at three characters. 办法 想法
   看法 说法 方法 魔法 are the two-character 法 majority and stay out; 法院 is
   already `org` and is not forced into law. */
const LAW_WORDS = new Set([
  '法律', '刑法', '民法', '宪法', '商法', '条款', '罪名', '犯罪', '违约', '侵权',
  '诉讼', '判决', '立法', '司法', '婚姻法', '劳动法', '合同法', '行政法',
]);
const NOT_LAW = new Set([
  '办法', '想法', '看法', '说法', '方法', '无法', '合法', '非法', '用法', '魔法',
  '书法', '手法', '技法', '兵法', '算法', '剑法', '心法', '刀法', '拳法', '障眼法',
  '法院', '法官', '罪过', '罪恶', '有罪', '无罪', '怪罪', '认罪', '得罪', '问罪',
]);

/* ---------- 数量 (`number`) ----------
   Numeral + 百千万亿 / 成 / 倍, 上/数 + those units, 百分之…, and a handful of
   closed quantity nouns. Demonstrative × classifier (一个 这只) is already in
   DEFAULT_STOPWORDS and is not a number construction. */
const NUMBER_WORDS = new Set(['半数', '成千上万', '成百上千', '百分之百']);
const NUMBER_RE = /^(?:[一二三四五六七八九十两百千]+[百千万亿]|[数上][百千万亿]|[一二三四五六七八九十两]成|[一二三四五六七八九十两]+倍|百分之[一二三四五六七八九十百千万两]+)$/;
/** 数词×量词 that are not the 2-char demonstrative×classifier stop table (一个 这只). */
const NUMBER_CLASS_TAIL = /(?:个|只|片|双|股|条|张|份|次|遍|杯|碗|盘|辆|本|封|把|根|颗|粒|枚|套|层|位|名|座|支)$/;
const isCountPhrase = (w: string) =>
  QUANT_HEAD.test(w) && NUMBER_CLASS_TAIL.test(w) && !DEFAULT_STOPWORDS.has(w)
  && !TIME_RE.test(w) && !MONEY_RE.test(w);

/* ---------- 行政区划 (`region`) ----------
   Additive on the 省市县区镇村州郡国邦 suffixes at length ≥ 3, plus the
   two-character country names that have no suffix long enough. 办公室 is a
   `room` (室), not 区; 社区 误区 时区 音区 are listed even though min-3 already
   drops the two-character ones. `place` is kept as-is — 朝阳区 stays place. */
const REGION_TAIL = /(?:省|市|县|区|镇|村|州|郡|国|邦)$/;
const REGION_WORDS = new Set(['中国', '美国', '英国', '法国', '日本', '韩国']);
const NOT_REGION = new Set([
  '误区', '社区', '时区', '音区', '盲区', '禁区', '景区', '联合国',
  '超市', '夜市', '菜市', '集市', '市场', '股市', '上市', '都市',
  '节省', '省略', '反省', '自省', '坐镇', '冰镇', '爱国', '出国', '回国',
]);

/* ---------- 道路与交通设施 (`path`) ----------
   Additive on 路 街 巷 道 站 at length ≥ 3, plus a closed list of the common
   two-character roads and the four named constructions (高速公路 立交桥
   十字路口 人行道). 口 is not a path suffix: 门口 is `place`, 胸口 虎口 are
   `body`, 路口 is two characters. 桥 stays with `building` — 立交桥 is in the
   closed list so it *gains* path without stealing the primary tag. 知道 味道
   are two-character 道 and never reach the suffix. */
const PATH_TAIL = /(?:路|街|巷|道|站)$/;
const PATH_WORDS = new Set([
  '高速公路', '立交桥', '十字路口', '人行道', '马路', '街道', '车站', '地铁站',
  '公路', '铁路', '大街', '小巷', '大路', '小路', '山路', '道路', '公交站', '火车站',
]);
const NOT_PATH = new Set([
  '门口', '胸口', '虎口', '接口', '路口', '知道', '味道', '难道', '频道', '跑道',
  '通道', '报道', '不知道', '网站', '工作站', '说道', '问道', '答道',
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

/** For context-free kind checks before the corpus pass writes `kindOf`. */
const EMPTY_INDEX: EntityIndex = {
  kindOf: new Map(),
  brands: new Set(),
  personNames: [],
  personConfidence: new Map(),
};

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
    // Closed-class nouns (合同 / 通告单 / 台词 / 开幕式) sit in the same
    // subject/possessive slots as names. Only document/media/event: a given
    // name can share a place suffix (周敬亭 / 亭) and must still pass.
    if (classifyKinds(name, EMPTY_INDEX).some((k) => k.kind === 'document' || k.kind === 'media' || k.kind === 'event')) return false;
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

  /* ---- Batch-3 kinds (docs/33 §5). Same shape as batch 2: closed set OR
     suffix rule minus its counter-examples, every tag additive. ---- */
  if (MATERIAL_WORDS.has(word)) add('material');
  if (PLANT_WORDS.has(word) || (!NOT_PLANT.has(word) && suffixHit(word, PLANT_TAIL))) add('plant');
  if (ANIMAL_WORDS.has(word)) add('animal');
  if (WEATHER_WORDS.has(word) || (!NOT_WEATHER.has(word) && suffixHit(word, WEATHER_TAIL))) add('weather');

  if (DEVICE_WORDS.has(word) || (!NOT_DEVICE.has(word) && suffixHit(word, DEVICE_TAIL, 3))) add('device');
  if (WEAPON_WORDS.has(word) || (!NOT_WEAPON.has(word) && suffixHit(word, WEAPON_TAIL))) add('weapon');
  if (JEWELRY_WORDS.has(word) || suffixHit(word, JEWELRY_TAIL)) add('jewelry');

  if (SOUND_WORDS.has(word) || (!NOT_SOUND.has(word) && suffixHit(word, SOUND_TAIL))) add('sound');
  if (SMELL_WORDS.has(word) || (!NOT_SMELL.has(word) && suffixHit(word, SMELL_TAIL))) add('smell');
  if (TEXTURE_WORDS.has(word)) add('texture');
  if (ILLNESS_WORDS.has(word) || (!NOT_ILLNESS.has(word) && suffixHit(word, ILLNESS_TAIL))) add('illness');

  if (SPEECH_WORDS.has(word) || SAY_DAO_RE.test(word)) add('speech');
  if (THOUGHT_WORDS.has(word) || (!NOT_THOUGHT.has(word) && suffixHit(word, THOUGHT_TAIL))) add('thought');
  if (DESIRE_WORDS.has(word) || suffixHit(word, DESIRE_TAIL)) add('desire');

  if (DOCUMENT_WORDS.has(word) || (!NOT_DOCUMENT.test(word) && suffixHit(word, DOCUMENT_TAIL, 3))) add('document');
  if (MEDIA_WORDS.has(word) || (!NOT_MEDIA.has(word) && suffixHit(word, MEDIA_TAIL))) add('media');
  if (EVENT_WORDS.has(word) || (!NOT_EVENT.has(word)
      && (suffixHit(word, EVENT_TAIL) || suffixHit(word, EVENT_TAIL3, 3)))) add('event');

  if (MYTH_WORDS.has(word) || (!NOT_MYTH.has(word) && suffixHit(word, MYTH_TAIL))) add('myth');
  if (MARTIAL_WORDS.has(word) || (!NOT_MARTIAL.has(word) && suffixHit(word, MARTIAL_TAIL))) add('martial');
  if (FESTIVAL_WORDS.has(word) || FESTIVAL_RE.test(word)) add('festival');

  /* ---- Batch-4 kinds (docs/33 §5). Additive; CONF all sit below `event`. ---- */
  const ethStem = word.length >= 3 && /(?:人|族)$/.test(word) ? word.slice(0, -1) : '';
  if (ETHNICITY_WORDS.has(word) || (ethStem !== '' && !NOT_ETHNICITY.has(word) && (
    ETHNICITY_STEMS.has(ethStem) || REGION_WORDS.has(ethStem) || /[国洲]$/.test(ethStem)
    || MYTH_WORDS.has(ethStem) || (!NOT_MYTH.has(ethStem) && MYTH_TAIL.test(ethStem))
  ))) add('ethnicity');
  if (RANK_WORDS.has(word)
      || (!NOT_RANK.has(word) && suffixHit(word, /爵$/))
      || (word.length >= 3 && word.endsWith('期') && MARTIAL_WORDS.has(word.slice(0, -1)))
      || (!NOT_RANK.has(word) && suffixHit(word, /级$/, 3))) add('rank');
  if (LAW_WORDS.has(word) || (!NOT_LAW.has(word)
      && (suffixHit(word, /罪$/) || suffixHit(word, /法$/, 3) || suffixHit(word, /条款$/)))) add('law');
  if (MEASURE_WORDS.has(word)) add('measure');
  if (ONO_WORDS.has(word) || (word.length === 2 && word[0] === word[1] && ONO_CHAR.has(word[0]))) add('onomatopoeia');
  if (NUMBER_WORDS.has(word) || (NUMBER_RE.test(word) && !DEFAULT_STOPWORDS.has(word)) || isCountPhrase(word)) add('number');
  // Not `suffixHit`: QUANT_HEAD would drop 四川省 (四 is a numeral character).
  if (REGION_WORDS.has(word) || (word.length >= 3 && REGION_TAIL.test(word)
      && !NOT_REGION.has(word) && !DEFAULT_STOPWORDS.has(word))) add('region');
  if (PATH_WORDS.has(word) || (!NOT_PATH.has(word) && suffixHit(word, PATH_TAIL, 3))) add('path');

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
/**
 * Rule 5 (`tailEvidence`) — the drop-surname form (砚秋 of 沈砚秋) is the one
 * variant that is a *substring* of the full name, so the corpus counts it inside
 * every mention of the full name. When at most this share of its occurrences are
 * outside the full name, the string simply has no independent life in this corpus
 * and folding it in cannot take a different word with it. 0.25 is well clear of
 * both sides measured on the local export: 砚秋 0.004, 敬亭 0.006, 晓龙 0.0 —
 * against 高飞 0.78 and 安静-shaped dictionary words at 1.0.
 */
const COREF_TAIL_MAX_SOLO_SHARE = 0.25;

/** Knobs, all defaulting to the shipped behaviour; `npm run eval:coref -- --ablate` flips one at a time. */
export interface CorefOptions {
  /**
   * Accept a variant that never shares a message with the full name. A17 shipped
   * this on; the ablation in `tools/eval/coref.ts` shows it is the only source of
   * mis-merges on both corpora, so it defaults to **off** since C6.
   */
  allowComplementary?: boolean;
  /**
   * Require the variant to appear at least once in a message that does *not*
   * contain the full name. An alias is used **instead of** the full name; a form
   * that only ever appears beside it is a second person in the same scene
   * (沈老师 the mother, standing next to 沈砚秋 the son).
   */
  requireSubstitution?: boolean;
  /** Rule 5: let the drop-surname form in on containment / person evidence. */
  tailEvidence?: boolean;
  /**
   * Reject `姓 + 头衔` when a second surname in the same corpus carries the same
   * title: 老师 borne by both 沈 and 周 means `周老师` is a role, not a short form.
   */
  titleShared?: boolean;
}

/** A generated surface form and how it was built; each kind has its own evidence rules. */
interface CorefVariant {
  v: string;
  /** `tail` = drop-surname, `title` = 姓 + 头衔, `plain` = 小姓 / 老姓 / 叠字 / English halves. */
  kind: 'tail' | 'title' | 'plain';
  /** For `title`: the honorific itself, used by the shared-title test. */
  suffix?: string;
}

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
function corefVariants(full: string): CorefVariant[] {
  const out: CorefVariant[] = [];
  const bare = (v: string) => out.push({ v, kind: 'plain' });
  const tail = (v: string) => out.push({ v, kind: 'tail' });
  const titled = (v: string, suffix: string) => out.push({ v, kind: 'title', suffix });
  if (EN_FULLNAME_RE.test(full)) {
    const [first, last] = full.split(' ');
    bare(first); bare(last); bare(`${first}'s`); bare(`${first}’s`);
    for (const h of EN_HONORIFICS) titled(`${h} ${last}`, h);
    return out;
  }
  if (!/^[一-鿿]{3,4}$/.test(full)) return out;
  const compound = COMPOUND_SURNAMES.includes(full.slice(0, 2));
  const surname = compound ? full.slice(0, 2) : full[0];
  const given = full.slice(surname.length);
  // Only 姓 + 双字名 has a short form that is still a name: dropping the surname of
  // 李明 leaves a single character, which is an ordinary word far more often.
  if (given.length === 2) { tail(given); bare(given[0] + given[0]); bare(given[1] + given[1]); }
  bare(`小${surname}`); bare(`老${surname}`);
  for (const s of [...TITLE_SUFFIXES, ...COREF_EXTRA_SUFFIXES]) titled(surname + s, s);
  return out;
}

/**
 * Group the surface forms that refer to the same person.
 *
 * @param texts one cleaned message per entry — co-occurrence is measured per message
 * @param names full-name candidates (`EntityIndex.personNames` plus the English pairs)
 * @param index the entity index; unused for now beyond keeping the signature honest
 *
 * A variant is accepted only when every condition below holds. Conditions 1-4 are
 * the A17 set; 5 (drop-surname evidence), 6 (shared honorific) and the substitution
 * test were added by C6, which is what moved the numbers from 35% recall / 30%
 * mis-merge to 97.5% / 0% (`npm run eval:coref -- --ablate`) and let the UI apply
 * the groups by default instead of only proposing them:
 *
 *  1. it occurs at least `COREF_MIN_COUNT` times *outside* every tracked full name
 *     that contains it. Without the subtraction 砚秋 would "occur" 680 times purely
 *     as the tail of 沈砚秋 and every full name would merge with its own substring;
 *  2. it is not a name in its own right: `looksLikePerson` must reject it (a string
 *     that parses as surname + given name is a different person, not a short form),
 *     it must not be one of the tracked full names, and it must not be proposed by
 *     two different full names — 沈砚秋 and 沈高飞 both generate 小沈 and 沈老师,
 *     and nothing in the text says which one is meant;
 *  3. it shares at least `COREF_MIN_COOCCUR` of the rarer form's messages with the
 *     full name **and** appears at least once without it. Complementary distribution
 *     (never in the same message) was accepted by A17 and is off by default since C6:
 *     it is where every measured mis-merge came from. The drop-surname form is exempt
 *     from this whole condition — see 5;
 *  4. it is not a stop word, a kinship term, a form of address, or a word the
 *     segmenter already knows — 老公 and 小三 are built by the same morphology as
 *     老沈 and 小赵 and are ordinary words;
 *  5. the drop-surname form (砚秋 of 沈砚秋) instead has to show that the characters
 *     have no independent life in this corpus (`COREF_TAIL_MAX_SOLO_SHARE`) or that
 *     the entity layer read the bare form as a person on its own. That replaces both
 *     the dictionary test in 4 and the co-occurrence test in 3, because a message
 *     that writes 敬亭 is a message that chose not to write 周敬亭;
 *  6. `姓 + 头衔` is dropped when a second surname wears the same honorific: 老师 held
 *     by both 沈 and 周 makes 周老师 a job, not a short form for 周敬亭.
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
  opts: CorefOptions = {},
): CorefGroup[] {
  const allowComplementary = opts.allowComplementary ?? false;
  const requireSubstitution = opts.requireSubstitution ?? true;
  const tailEvidence = opts.tailEvidence ?? true;
  const titleShared = opts.titleShared ?? true;
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
  const variantsOf = new Map<string, CorefVariant[]>();
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

  /**
   * Rule 6: surnames seen carrying each honorific. `周老师` is only a short form
   * of 周敬亭 when 老师 belongs to exactly one person in this corpus; the moment
   * 沈老师 also appears, the title says "teacher", not "the Zhou we know".
   * Only surname-shaped prefixes count, so 制片主任 does not make 主任 shared.
   */
  const bearersOf = new Map<string, Set<string>>();
  if (titleShared) {
    for (const s of [...TITLE_SUFFIXES, ...COREF_EXTRA_SUFFIXES]) {
      const seen = new Set<string>();
      for (const re of [new RegExp(`([一-鿿]{2})${s}`, 'g'), new RegExp(`([一-鿿])${s}`, 'g')]) {
        for (const m of joined.matchAll(re)) {
          const p = m[1];
          const sur = COMPOUND_SURNAMES.includes(p) ? p : (SURNAMES.has(p.at(-1)!) ? p.at(-1)! : '');
          if (sur && countOf(joined, sur + s) >= COREF_MIN_COUNT) seen.add(sur);
        }
      }
      bearersOf.set(s, seen);
    }
  }

  const out: CorefGroup[] = [];
  for (const full of fulls) {
    const docsFull = texts.reduce((a, t) => a + (t.includes(full) ? 1 : 0), 0);
    const kept: { v: string; n: number }[] = [];
    for (const { v, kind, suffix } of variantsOf.get(full)!) {
      if (proposedBy.get(v)!.size > 1) continue;                        // 2: ambiguous
      // 2: a name of its own. The honorific forms are exempt because they *are*
      // built from this full name's surname — `looksLikePerson` recognises 周老师
      // as a person precisely because of the construction we just applied.
      if (fullSet.has(v) || (kind !== 'title' && kind !== 'tail' && looksLikePerson(v))) continue;
      if (DEFAULT_STOPWORDS.has(v) || KINSHIP_TERMS.has(v)
        || ADDRESS.has(v) || TITLE_WORDS.has(v)) continue;              // 4: closed lists
      // 6: the honorific is worn by a second surname, so it is a role, not a nickname.
      if (kind === 'title' && suffix && (bearersOf.get(suffix)?.size ?? 0) > 1) continue;
      const n = standalone(joined, v);
      // 5: the drop-surname form. It is a substring of the full name, so the corpus
      // has already tied the two together; what has to be excluded is the case where
      // the same characters lead an independent life (安静, 高飞-the-verb). Either
      // almost every occurrence sits inside the full name, or the entity layer found
      // person evidence for the bare form on its own.
      const total = countOf(joined, v);
      const soloShare = total > 0 ? n / total : 1;
      const tailOk = tailEvidence && kind === 'tail'
        && (soloShare <= COREF_TAIL_MAX_SOLO_SHARE
          || (index.personConfidence.get(v) ?? 0) >= COREF_MIN_CONFIDENCE);
      if (!tailOk) {
        if (/^[一-鿿]+$/.test(v) && !isOov(v)) continue;                 // 4: a word the segmenter knows
        if (kind === 'tail' && looksLikePerson(v) && soloShare > COREF_TAIL_MAX_SOLO_SHARE) continue;
        if (n < COREF_MIN_COUNT) continue;                              // 1
      }
      let both = 0, docsVar = 0;
      for (const t of texts) {
        if (!standalone(t, v)) continue;
        docsVar++;
        if (t.includes(full)) both++;
      }
      // A tail form carried entirely by the full name has no standalone message to
      // measure; containment (rule 5) is the evidence, and the merge only ever shows
      // up if the tokenizer produced the bare form as a word of its own.
      if (!docsVar) { if (tailOk && n < COREF_MIN_COUNT) kept.push({ v, n }); continue; }
      const denom = Math.min(docsFull, docsVar);
      // Complementary distribution (both === 0) was accepted before C6; the ablation
      // in tools/eval/coref.ts shows it is where every mis-merge comes from — for
      // every variant except the drop-surname form, which is *expected* to be
      // complementary: a message that writes 敬亭 is a message that chose not to
      // write 周敬亭. Rule 5's containment / person evidence stands in for rule 3 there.
      if (!tailOk && (both === 0 ? !allowComplementary
        : (denom <= 0 || both / denom < COREF_MIN_COOCCUR))) continue;               // 3
      // Substitution: an alias replaces the full name somewhere. A form that never
      // appears without it is the other person in the room, not another name for
      // this one. Tail forms are exempt — they are inside every mention by construction.
      if (requireSubstitution && kind !== 'tail' && both > 0 && docsVar - both < 1) continue;
      kept.push({ v, n });
    }
    if (kept.length) {
      kept.sort((a, b) => b.n - a.n || a.v.localeCompare(b.v));
      out.push({ full, aliases: kept.map((k) => k.v) });
    }
  }
  return out;
}

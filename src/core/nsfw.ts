/**
 * Explicit-word detection. Words are classified, never removed; the UI decides
 * whether to hide them.
 *
 * Tiers:
 *   - explicit (counted by default): act, organ, fluid, arousal, voice, kink, slur, profanity, taboo, porn
 *   - mild (not counted by default): body, face, scent, bdsm, wear
 *   - maybe: words common in ordinary narration, plus two-character words that
 *     contain a single sensitive character
 */
export type NsfwKind =
  | 'act' | 'organ' | 'fluid' | 'arousal' | 'voice' | 'face' | 'kink' | 'slur' | 'profanity' | 'taboo' | 'porn'
  | 'body' | 'scent' | 'bdsm' | 'wear'
  | 'maybe';

/** Display order. */
export const NSFW_KINDS: readonly NsfwKind[] = [
  'act', 'organ', 'fluid', 'arousal', 'voice', 'face', 'kink', 'slur', 'profanity', 'taboo', 'porn',
  'body', 'scent', 'bdsm', 'wear', 'maybe',
];
/** Categories counted as explicit by default. */
export const NSFW_EXPLICIT_KINDS: readonly NsfwKind[] = ['act', 'organ', 'fluid', 'arousal', 'voice', 'kink', 'slur', 'profanity', 'taboo', 'porn'];
/** Mild categories: labelled but not counted by default. */
export const NSFW_MILD_KINDS: readonly NsfwKind[] = ['body', 'face', 'scent', 'bdsm', 'wear'];

const LISTS: Record<Exclude<NsfwKind, 'maybe'>, string> = {
  act: `
    做爱 性交 交合 交媾 抽插 抽送 顶弄 舔弄 深喉 口交 自慰 手淫 高潮 射精 内射 中出 潮吹 潮喷 泄身 达到顶峰
    乳交 体位 体奸 作爱 口射 口活 口淫 口爆 叫床 吃精 吸精 喷精 食精 大力抽送 套弄 射爽 射颜 颜射
    干穴 开苞 性技巧 抓胸 揉乳 摸奶 摸胸 拔出来 拳交 捏弄 推油 放尿 文做 爆草 狂插 狂操 群交 肛交
    胸推 脚交 舔脚 舔阴 脱内裤 被干 被插 被操 要射了 轮操 相奸 插进 插阴
  `,
  organ: `
    阴部 阴道 阴茎 阴唇 阴蒂 阴户 阴核 阴阜 阴精 下体 私处 生殖器 睾丸 龟头
    肉棒 肉屌 肉棍 肉茎 肉具 阳具 巨屌
    肉穴 小穴 蜜穴 淫穴 后穴 菊穴 嫩穴 密穴 粉穴 玉穴 美穴 骚穴 雌穴 穴口 穴道 肉洞 肉缝 肉唇 秘唇
    肉屄 骚屄 屄唇 逼肉 精盆 花核 肉豆 口穴
    后庭 菊门 菊花洞 肛门 屁眼 g点
  `,
  fluid: `
    淫水 淫液 淫汁 精液 爱液 蜜液 蜜汁 春水 骚水 雌汁 卵汁 卵液 阴精 屄水 淫靡汁液
  `,
  arousal: `
    淫荡 淫靡 淫糜 淫乱 淫亵 淫色 淫媚 淫样 淫情 淫浪 淫贱
    发浪 情潮 春情 情欲 性欲 欲火 兽欲 肉欲 色欲 性饥渴 好嫩
    酥痒 释欲 泄欲 性感诱惑 性感妖娆 色诱 丝诱 欠插 嗜精 淫湿 雌熟 淫熟 欲求不满 性饥渴
  `,
  voice: `
    娇喘 浪叫 淫叫 淫声浪语 浪啼 骚啼 娇吟 尖啼 急喘 淫语 骚话 荡语 哦齁 齁齁 咿呀
  `,
  face: `
    高潮脸 啊嘿颜 母猪脸 婊子脸 淫脸 骚脸 淫靡表情 翻白眼 吐舌 口穴
  `,
  kink: `
    恋足 足交 舔脚 恋腋 腋下舔 恋肛 肛塞 媚黑 黑人崇拜 寝取 绿帽 露出癖 露出 触手 兽人 母乳 泌乳 榨乳
    怀孕 孕肚 受孕 播种 产卵 排卵 催眠 洗脑 寄生 淫纹 淫堕 雌堕 雌化 堕落 扶她 双性 女装 伪娘 人外 兽化 畜化 家畜化
    尿道 放尿 圣水 黄金 调教 女王 女s 男m 母狗调教 奴隶 公厕 精液便器 母猪化 恋物 制服 触手
  `,
  scent: `
    雌香 淫香 骚味 雌臭 骚臭 腥膻 腥甜 精液味 淫靡气息 骚甜 蜜香
  `,
  slur: `
    母畜 雌畜 奴妻 性奴 肉便器 婊子 荡妇 荡女 淫妇 淫女 淫妻 淫娃 淫母 淫魔 淫虫 淫兽
    骚货 骚女 浪女 浪妇 欲女 男奴 厕奴 熟女 熟妇 熟母 美少妇 嫩女 人妻 炮友 砲友 狼友 女优
    便器 飞机杯 鸡巴套子 骑乘便器 雌躯 雌肉 骚肉 种马
  `,
  profanity: `
    fuck 几吧 鸡吧 鸡巴 操我 操死 操烂 操逼 操黑 肏你 肏死 干死你 插你 插我 插b 插比 插暴 插逼
    日烂 日逼 死逼 骚比 骚逼 肥逼 黑逼 美逼 小逼 嫩逼 肉逼 浪逼 色逼 色b 阴b 露b
    小xue 一ye情 强jian 就去日 色色
  `,
  taboo: `
    强奸 强奸处女 强暴 轮奸 轮暴 迷奸 暴奸 逼奸 母奸 鸡奸 兽奸 兽交 人兽 乱伦 乱交 幼交 美幼 凌辱
    失身粉 春药 买春 招妓 招鸡 援交 援助交际 应召 裸陪 包二奶 换妻俱乐部 妓女 校鸡
    一夜情 一夜欢 偷欢 奸情 盗撮
  `,
  porn: `
    a片 gay片 h动漫 h动画 黄片 爽片 一本道 国产av 无修正
    仓井空 夏川纯 杨思敏 松岛枫 汤加丽 夜勤病栋 少年阿宾 淫兽学园 淫术炼金士 淫教师 风月大陆
    成人小说 成人文学 成人游戏 成人电影 成人网站 成人色情 成人论坛 情色 艳情小说
    淫书 淫照 淫电影 穴图 色情网站 色区 色猫 色界 色盟 性息 聊性 裹本 亚情
  `,
  body: `
    乳房 乳头 奶头 胸部 乳沟 大乳 巨乳 爆乳 暴乳 豪乳 玉乳 美乳 漏乳 乳爆 大波 奶子 巨奶
    屁股 肥臀 美臀 双臀 大腿根 腿心 胯下 美腿 全裸 前凸后翘 肥尻 雌尻 爆尻 雌臀 媚臀 子宫 乳峰 乳肉 奶肉 奶水 奶汁
  `,
  bdsm: `
    束缚 捆绑 鞭打 项圈 口塞 拘束 性虐 淫虐 皮鞭 手铐 脚镣 眼罩 绳缚 龟甲缚 跳蛋 假阳具 贞操锁
  `,
  wear: `
    丝袜 裤袜 罩杯 原味内衣 情趣用品 按摩棒 淫荡自慰器
  `,
};

/** Common in ordinary narration; whole-word hits are tagged `maybe` only. */
const AMBIGUOUS = `
  湿润 濡湿 黏腻 呻吟 妩媚 娇媚 媚态 风骚 母狗 母马 母猪 雌性 雄性 发情 饥渴 痴迷 香汗 媚眼 朱唇 樱唇 红唇 香舌 体香 主人
  插入 抚摸 揉捏 揉搓 磨蹭 律动 挺进 撞击 舔舐 吸吮 情动
`;

/** Single characters that tag a two-character word as `maybe`. */
export const NSFW_CHARS: ReadonlySet<string> = new Set(['乳', '屌', '穴', '淫', '妓', '娼', '肏', '屄']);

const split = (s: string) => s.trim().split(/\s+/).filter(Boolean);

/** Word -> category; the first category listed wins. */
const INDEX = new Map<string, NsfwKind>();
for (const kind of NSFW_KINDS) {
  if (kind === 'maybe') continue;
  for (const w of split(LISTS[kind])) if (!INDEX.has(w)) INDEX.set(w, kind);
}
for (const w of split(AMBIGUOUS)) if (!INDEX.has(w)) INDEX.set(w, 'maybe');

/** Entries of 3+ characters also match as substrings; 2-character entries match whole words only. */
const LONG: { w: string; kind: NsfwKind }[] = [...INDEX.entries()]
  .filter(([w, kind]) => kind !== 'maybe' && w.length >= 3)
  .map(([w, kind]) => ({ w, kind }));

/** Every listed word, for tooling. */
export const NSFW_WORDS: ReadonlySet<string> = new Set(INDEX.keys());

/** Category of a word, or null. */
export function nsfwKind(word: string): NsfwKind | null {
  const lower = word.toLowerCase();
  const hit = INDEX.get(lower);
  if (hit) return hit;
  for (const { w, kind } of LONG) if (lower.length > w.length && lower.includes(w)) return kind;
  if (word.length === 2) {
    for (const c of word) if (NSFW_CHARS.has(c)) return 'maybe';
  }
  return null;
}

/** Number of words whose category is in `kinds`. */
export function countSensitive(words: { nsfw?: NsfwKind }[], kinds: ReadonlySet<NsfwKind>): number {
  let n = 0;
  for (const w of words) if (w.nsfw && kinds.has(w.nsfw)) n++;
  return n;
}

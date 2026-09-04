/** Stop words: Chinese function words, English, and role-play specific noise. Two characters and longer; single characters are handled by minLength. */

const ZH = `
的 了 是 在 我 有 和 就 不 人 都 一 一个 上 也 很 到 说 要 去 你 会 着 没有 看 好 自己 这 那 里 中 又 才 再 就 让 被 把 从 向 给 对 跟 与 并 而 则 却 且 呢 吗 吧 啦 嘛
他 她 它 我们 你们 他们 她们 它们 这个 那个 这些 那些 这样 那样 这里 那里 这么 那么
什么 怎么 怎样 为什么 因为 所以 但是 可是 如果 虽然 然而 而且 并且 或者 还是 于是
已经 曾经 正在 将要 马上 立刻 突然 忽然 终于 一直 始终 仍然 依然 还有 还要 还能
可以 可能 应该 必须 需要 想要 打算 愿意 能够 无法 不能 不会 不要 不是 不用 不再
知道 觉得 认为 发现 感觉 感到 变得 成为 开始 继续 结束 停止 保持 让 使 被 把
时候 时间 现在 刚才 之前 之后 以前 以后 当时 那时 今天 明天 昨天 一会儿 一下 一下子
里面 外面 上面 下面 前面 后面 旁边 中间 周围 附近 这边 那边 身上 手里 眼里 心里
一些 有些 所有 全部 整个 每个 各种 任何 其他 别的 另外 更多 一点 一点点 有点 有点儿
起来 出来 下来 上去 过来 过去 回来 回去 进来 出去 下去 上来
非常 特别 十分 极其 相当 比较 稍微 有些 更加 最为 太 挺 蛮
一样 一起 一边 一面 一直 一定 一般 一切 一切都
自己 别人 大家 谁 哪个 哪些 哪里 多少 几个
然后 接着 于是 因此 不过 只是 只有 除了 关于 对于 至于 由于 通过 根据 按照
好像 似乎 仿佛 大概 也许 或许 恐怕 反正 其实 当然 确实 真的 究竟 到底
东西 事情 情况 问题 样子 方面 地方 感觉 声音 眼睛 目光
没 有的 是的 对的 好的 是不是 有没有 怎么办
就是 也是 都是 还是 又是 才是 而是 只是 总是 老是 真是
这是 那是 有点 一点 一次 一遍 一样的 什么样
说道 说着 问道 答道 说话 开口 出声
不知 不知道 不明白 没什么 没关系 没事 也没有 也没 都没 还没 就没 并没 从没 没能 没再
的是 的话 的人 的事 了一 他的 她的 我的 你的 它的 说的 做的 来的 去的 里的 上的 中的
一半 一整 一大
会儿 一会 一会儿 半天 半晌 片刻 好久 许久
第一 第二 第三 第四 第五 最后 最先 最初 其中 其一 之一 以上 以下 左右
有人 没人 什么的 之类 等等 以及 之类的
`.trim().split(/\s+/);

const EN = `
a an the and or but if then else so because as of in on at to for from by with without
into onto over under again further once here there when where why how all any both each
few more most other some such no nor not only own same than too very can will just should
now i me my myself we our ours you your yours he him his she her hers it its they them their
what which who whom this that these those am is are was were be been being have has had
having do does did doing would could shall may might must about above after before below
between during through up down out off again also however therefore thus while yet still
get got go went come came make made take took see saw look looked say said know knew think
thought want wanted feel felt one two three like back even much many well way thing things
`.trim().split(/\s+/);

/** English contractions. Intl.Segmenter keeps `didn't` as one token, so they need their own entries. Both apostrophes occur in real text. */
const EN_CONTRACTIONS = [
  "i'm", "i've", "i'd", "i'll", "you're", "you've", "you'd", "you'll",
  "he's", "he'd", "he'll", "she's", "she'd", "she'll", "it's", "it'd", "it'll",
  "we're", "we've", "we'd", "we'll", "they're", "they've", "they'd", "they'll",
  "that's", "there's", "here's", "what's", "who's", "let's",
  "don't", "doesn't", "didn't", "isn't", "aren't", "wasn't", "weren't",
  "can't", "couldn't", "won't", "wouldn't", "shouldn't", "mustn't", "haven't",
  "hasn't", "hadn't", "ain't",
].flatMap((w) => [w, w.replace("'", '\u2019')]);

/** English narrative filler (the counterpart of NARRATIVE_STOPWORDS). Only words that carry no story content. */
const EN_NARRATIVE = `
something anything nothing everything someone anyone everyone nobody somebody
somewhere anywhere everywhere somehow anyhow
moment moments minute minutes second seconds hour hours day days week weeks
month months year years time times
ask asked asking answer answered reply replied tell told telling speak spoke
spoken talk talked talking speaking hear heard hearing listen listened
watch watched watching stare stared staring glance glanced gaze gazed
turn turned turning walk walked walking step stepped stepping stand stood
standing sit sat sitting move moved moving reach reached reaching
smile smiled smiling laugh laughed laughing sigh sighed nod nodded nodding
shake shook shrug shrugged frown frowned blink blinked pause paused
open opened close closed put pull pulled push pushed hold held holding
give gave given let leave left leaving keep kept find found finding
seem seemed seeming become became begin began started start
actually really exactly simply almost already still instead rather perhaps
maybe probably certainly finally suddenly slowly quickly quietly softly
enough least last next first second whole another every each other others
good better best bad worse little bit lot kind sort right wrong true
long short small large big high low old new young
face eyes eye hand hands head voice mouth
`.trim().split(/\s+/);

/** Role-play / SillyTavern noise: narrative filler, plugin residue, system prompt words. */
const RP_NOISE = `
user char assistant system prompt persona
ooc OOC swipe swipes
继续 好的 嗯嗯 哈哈 哈哈哈 呵呵 唔 嗯 啊 哦 噢 诶 咦 唉
你好 谢谢 抱歉 对不起 没关系
`.trim().split(/\s+/);

/**
 * Demonstrative / numeral + classifier combos (那只 一股 每个 这片 …). Generated from two
 * short atom lists instead of hand-listing hundreds of forms. Only the 2-char combos are
 * stop words: single-character classifiers must stay out of the set, because
 * discoverPhrases() drops any candidate that contains a stop-word atom and names would
 * stop being recovered.
 */
const DEMONSTRATIVES = '一 这 那 每 某 该 哪 此 几 两'.split(' ');
const CLASSIFIERS = `
个 只 片 双 股 条 张 份 声 次 遍 阵 口 块 段 步 堆 群 把 本 封 杯 碗 盘 辆 间 层 角 侧 眼 句 行
位 名 座 家 处 道 场 团 缕 丝 抹 束 滴 圈 种 些 样 支 根 颗 粒 枚 幅 套 对 排 列 串 截 节 页
`.trim().split(/\s+/);
const DEMO_CLASSIFIER = DEMONSTRATIVES.flatMap((d) => CLASSIFIERS.map((c) => d + c));

export const DEFAULT_STOPWORDS: ReadonlySet<string> = new Set(
  [...ZH, ...DEMO_CLASSIFIER, ...EN, ...EN_CONTRACTIONS, ...RP_NOISE].map((w) => w.toLowerCase()).filter(Boolean),
);

export function buildStopwords(
  extra: string[] = [],
  useDefault = true,
  useNarrative = true,
): Set<string> {
  const s = new Set<string>(useDefault ? DEFAULT_STOPWORDS : []);
  if (useNarrative) for (const w of NARRATIVE_STOPWORDS) s.add(w);
  for (const w of extra) {
    const t = w.trim().toLowerCase();
    if (t) s.add(t);
  }
  return s;
}

/**
 * Narrative filler: words at the top of the frequency list of any Chinese novel.
 * Kept as a separate, switchable set: they are signal when studying writing style.
 */
const NARRATIVE = `
看 看了 看着 看过 看向 看见 看到 望 望着 望向 瞧 瞧了 盯 盯着 瞥 瞥了 瞟
说 说了 说着 说道 讲 讲了 问 问了 问道 答 答道 应 应道 回 回了 回答 开口 出声 接话
走 走了 走着 走到 走过 走向 走进 走出 走上 走下 走近 来到 过来 过去 回来 回去
站 站着 站在 站起 站起来 站住 坐 坐着 坐在 坐下 坐了 躺 躺着 靠 靠着 靠在 蹲 蹲下
抬 抬起 抬头 低 低头 低下 转 转身 转过 转头 回头 侧头 仰头 埋头
伸 伸手 伸出 缩 缩回 抓 抓住 握 握着 握住 拉 拉住 推 推开 拽 拉开
拿 拿着 拿起 拿出 放 放下 放到 放在 搁 搁下 摆 摆着 递 递给 接 接过 接住
合 合上 打开 关 关上 拉上 掀 掀开 揭 揭开 翻 翻开 翻到 翻了
点头 点点头 摇头 摇摇头 皱眉 皱了皱眉 挑眉 眯眼 眯起 闭眼 闭上 睁开 睁眼
笑 笑了 笑着 笑起来 微笑 苦笑 冷笑 叹气 叹了口气 呼吸 喘气 顿住 顿了顿 停下 停住
想 想了 想着 想起 想到 觉得 感觉 感到 意识到 明白 知道 记得 忘了 发现 注意到
听 听着 听见 听到 闻 闻到 摸 摸着 碰 碰到 撞 撞上
一眼 一句 一声 一下 一步 一口 半天 片刻 忽然 突然 忽地 猛地 缓缓 慢慢 轻轻 悄悄
沉默 沉默了 没说 没说话 没有说 没答 不语 无言
这种 那种 一种 各种 某种 这样 那样 这些 那些 这么 那么 怎么 什么样
甚至 而且 但是 不过 然后 于是 因此 所以 如果 虽然 尽管 即使 除了 关于 对于 至于
里边 里面 外边 外面 上边 下边 旁边 中间 之间 之后 之前 当中
死死 紧紧 慢慢 悄悄 轻轻 深深 微微 淡淡 缓缓 静静 默默
一点 一些 一下 一直 一起 一边 一次 一样 一切 全部 所有 整个 每个
其实 确实 的确 显然 明显 似乎 好像 仿佛 大概 也许 应该 可能
东西 事情 时候 地方 样子
`.trim().split(/\s+/).filter(Boolean);

/** Degree / time-sequence adverbs: they top the frequency list of any narrative and carry no story content. */
const DEGREE = `
极度 彻底 几乎 刚刚 原本 本来 顿时 瞬间 随即 立即 随后 此刻 此时 同时 稍稍 略微 逐渐 渐渐
完全 根本 简直 实在 竟然 居然 果然 依旧 仍旧 一时 暂时 无比 格外 尤其 异常 极为 颇为
`.trim().split(/\s+/);

/** Relative position words (上方 身后 顺着 …). 内部 / 外部 / 中心 are deliberately absent: content in some stories. */
const RELPOS = `
上方 下方 前方 后方 左侧 右侧 两侧 顶端 底端 内侧 外侧 之上 之下 之中 之外
向上 向下 向前 向后 朝着 顺着 沿着 隔着 对面 面前 身前 身后 身侧 身旁 脚下 头顶 眼前 跟前
`.trim().split(/\s+/);

/** Add to this list conservatively: generic nouns such as 状态 / 感觉 / 想法 are content in some stories. */
/** Narrative filler set. Removed by default. */
/** Narrative filler, Chinese and English combined. Controlled by the narrative-stopwords option. */
export const NARRATIVE_STOPWORDS: ReadonlySet<string> = new Set(
  [...NARRATIVE, ...DEGREE, ...RELPOS, ...EN_NARRATIVE].map((w) => w.toLowerCase()),
);

/**
 * Adversarial fixtures: twelve "dirty" chat logs, one per class of real-world
 * pollution, each with an `expected.json` stating what cleaning must achieve.
 *
 * Unlike tools/make-fixtures.mjs (which mixes every kind of noise into one big
 * corpus to measure throughput and the overall noise ratio), each file here
 * isolates ONE pollution source so a failure names its own cause.
 *
 * Every sentence is invented for this generator. No real chat log, character
 * card, world book or user text is used or reproduced.
 *
 * Usage: node tools/make-fixtures-hard.mjs [outDir]   (default fixtures/hard)
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] ?? path.join('fixtures', 'hard');

/* ---------- Deterministic random ---------- */
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

/* ---------- Invented vocabulary (a lighthouse / dockyard story) ---------- */
/*
 * The vocabulary is deliberately wide. With a narrow one, ordinary story words
 * pile up to 30-40 hits and sit above the noise, so a "noise word not in TOP 40"
 * assertion would pass even when nothing was cleaned. Wide vocabulary keeps every
 * story word near 10-20 hits while a per-turn noise block reaches 24 — so a leak
 * really does show up in the TOP.
 */
const HERO = '林潮生';
const CAST = ['阮岫', '戚野', '邵晚', '葛叙', '仇明棠', '钟砚'];
const PLACES = [
  '灯塔', '船坞', '锈港', '缆车站', '冷库', '旧仓', '值班室', '气象站', '引桥', '修理棚',
  '晒网场', '油库', '候船室', '铁桥', '西堤', '渔市', '锅炉房', '瞭望台', '空货场', '潜水棚',
  '电报房', '苗圃', '旧船台', '闸口',
];
const THINGS = [
  '航海钟', '缆绳', '煤油灯', '海图', '铜哨', '雨衣', '铁皮箱', '浮标', '扳手', '旧唱片',
  '罗盘', '救生圈', '望远镜', '油壶', '登记簿', '橡胶靴', '电报纸', '铅锤', '帆布', '搪瓷缸',
  '手摇钻', '藤筐', '风向标', '标尺',
];
const VERBS = ['擦亮', '收起', '递给', '接过', '放下', '拧开', '翻到', '塞进', '摸出', '按住', '挂上', '拖开', '扣紧', '掀起', '抵住', '拾起'];
const MOVES = ['站起来', '蹲下去', '走过去', '停住', '转过身', '低下头', '靠在栏杆上', '退了半步', '绕到后面', '坐回原处', '贴着墙走', '踩上台阶'];
const EMOS = ['没吭声', '笑了笑', '皱起眉', '叹了口气', '愣了两秒', '摇摇头', '点点头', '抿了抿嘴', '别过脸去', '眯起眼'];
const ABSTRACT = ['分寸', '底线', '默契', '尺度', '交代', '章程', '眉目', '退路', '说法', '门路', '算盘', '把柄'];
const TIMES = ['凌晨四点', '清早六点', '正午', '傍晚七点', '夜里十点', '后半夜', '午后两点', '黄昏时分'];

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];
const someone = (rng) => (rng() < 0.4 ? HERO : pick(rng, CAST));

function sentence(rng) {
  const a = someone(rng), b = someone(rng);
  const t = [
    () => `${a}${pick(rng, VERBS)}${pick(rng, THINGS)}，${pick(rng, EMOS)}。`,
    () => `${a}${pick(rng, MOVES)}，${b}跟着${pick(rng, MOVES)}。`,
    () => `${pick(rng, PLACES)}里只剩下${a}和${b}。`,
    () => `“这事总得有个${pick(rng, ABSTRACT)}。”${a}说。`,
    () => `${pick(rng, TIMES)}，${a}到了${pick(rng, PLACES)}。`,
    () => `海风把${pick(rng, THINGS)}吹得作响，${a}盯着看了一会儿。`,
    () => `${b}${pick(rng, EMOS)}，过了很久才开口：“${pick(rng, ABSTRACT)}我懂。”`,
    () => `${pick(rng, PLACES)}的门被推开，${b}走进来，手里拿着${pick(rng, THINGS)}。`,
  ];
  return pick(rng, t)();
}

/** A few paragraphs of story, roughly `chars` long. */
function story(rng, chars) {
  let out = '';
  while (out.length < chars) {
    let p = '';
    const n = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) p += sentence(rng);
    out += p + '\n\n';
  }
  return out.trim();
}

const nonEmpty = (s) => s.split('\n').filter((l) => l.trim()).length;

/* ---------- Message helpers ---------- */
const T0 = Date.UTC(2026, 8, 1, 8, 0, 0);
const at = (i) => new Date(T0 + i * 141000).toISOString();

function userMsg(i, mes, extra = {}, more = {}) {
  return { name: 'goofy', is_user: true, is_system: false, send_date: at(i), mes, extra: { isSmallSys: false, ...extra }, swipes: [], ...more };
}
function charMsg(i, name, mes, extra = {}, more = {}) {
  return {
    name, is_user: false, is_system: false, send_date: at(i), mes, title: '',
    gen_started: new Date(T0 + i * 141000 - 8000).toISOString(), gen_finished: at(i),
    extra: { api: 'custom', model: 'fixture-model', ...extra },
    swipes: [mes], swipe_id: 0, ...more,
  };
}
function header(card, meta = {}) {
  return {
    user_name: 'unused', character_name: 'unused',
    chat_metadata: {
      integrity: `hard-${card}`, note_prompt: '', note_interval: 1, note_position: 1,
      note_depth: 4, note_role: 0, timedWorldInfo: { sticky: {}, cooldown: {} },
      variables: {}, tainted: true, lastInContextMessageId: 0, ...meta,
    },
  };
}

/* =======================================================================
 * Noise blocks. Each returns a string; the caller counts its lines.
 * ======================================================================= */

const thinkBlock = (rng) => `<think>
先确认${pick(rng, CAST)}这一轮的动机，再决定推进节奏。
用户上一条的情绪是压抑的，回应不要过度渲染。
检查是否与前文的时间线冲突，避免出现穿帮。
</think>`;

const reasoningTrace = (rng) => `我需要保持推进节奏，同时避免穿帮。\n先回顾用户的动机，再决定这一轮写到哪里。\n${pick(rng, CAST)}这时候应该还在${pick(rng, PLACES)}。`;

const statusTable = (rng) => `| 项目 | 数值 |
|---|---|
| 当前时间 | ${pick(rng, TIMES)} |
| 当前地点 | ${pick(rng, PLACES)} |
| 好感度 | ${40 + Math.floor(rng() * 50)} |
| 体力值 | ${50 + Math.floor(rng() * 40)} |
| 所持物品 | ${pick(rng, THINGS)} |`;

const statusKv = (rng) => `时间：${pick(rng, TIMES)}
地点：${pick(rng, PLACES)}
心情：平稳
好感：${30 + Math.floor(rng() * 60)}
体力：充沛`;

const statusBracket = (rng) => `[当前时间] ${pick(rng, TIMES)}
[当前地点] 锈港-${pick(rng, PLACES)}
[当前状态] 待命
[持有道具] ${pick(rng, THINGS)}`;

/**
 * World Info injected with the `wi_format` wrapper, echoed back into the reply.
 * Which entries fire depends on the keywords in the turn, so the block is NOT
 * byte-identical between messages — that is the point: `stripRepeatedLines`
 * only catches scaffolding that repeats verbatim.
 */
const WI_ENTRIES = [
  '灯塔守则第一条：每晚十点必须点灯，值夜人不得离岗。',
  '锈港潮汐表由港务处每周公布一次，误差不超过十分钟。',
  '缆车站在大雾天停运，需改走引桥。',
  '值夜人换班在港务处的登记簿上签字。',
  '潮汐表上标红的日子禁止小船出港。',
  '灯塔守则第七条：值夜人交接必须当面清点。',
  '港务处每月复核一次潮汐表的误差。',
];
const worldInfoLeak = (rng) => {
  const n = 2 + Math.floor(rng() * 2);
  const picked = [];
  while (picked.length < n) {
    const e = pick(rng, WI_ENTRIES);
    if (!picked.includes(e)) picked.push(e);
  }
  return `[Details of the fictional world the RP is set in:\n${picked.join('\n')}\n]`;
};

const worldInfoTagged = () => `<world_info>
条目「灯塔守则」：值夜人不得离岗。
条目「潮汐表」：港务处每周公布。
</world_info>`;

/** Instruct-mode sequences leaking into the visible message. */
const instructLeak = () => `### Instruction:
继续这一轮的叙述，保持第三人称。

### Response:`;
const instructLeakTail = () => `<|im_start|>assistant
[INST] 保持人称一致 [/INST]
</s>`;

/** A regex script that half-fired: opening tag replaced, closing tag left behind, `$1` literal. */
const regexHalf = (rng) => `<状态栏 data-v="2">
$1
</状态栏
【面板】${pick(rng, PLACES)} · ${pick(rng, TIMES)}
<司辰面板>
剩余电量：${Math.floor(rng() * 100)}
</司辰面板>`;

/** An invented plugin nobody could enumerate: unknown tags, unknown container, unknown fence. */
const unknownPlugin = (rng) => `<潮汐引擎_v3 mode="strict">
::潮位
{潮|${pick(rng, TIMES)}|${(rng() * 4).toFixed(2)}m|上涨}
{潮|${pick(rng, TIMES)}|${(rng() * 4).toFixed(2)}m|回落}
::
</潮汐引擎_v3>`;

const htmlPanel = (rng) => `.mes_text .tide-panel {
  color: #123456;
  padding: 10px;
}
@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
<style>
#tide-root { background: linear-gradient(90deg, #0af, #f0a); }
</style>
<script type="module">
function renderPanel(rows) {
  let html = '';
  rows.forEach((r) => { html += '<li>' + r + '</li>'; });
  $('#tide-root').html(html);
}
</script>
<div id="tide-root"><span class="tide-label">潮位</span><span>${pick(rng, PLACES)}</span></div>`;

const macroSoup = (rng) => `{{user}}走进${pick(rng, PLACES)}的时候，{{char}}正在擦拭${pick(rng, THINGS)}。掷骰结果 {{roll:1d20}}，随机事件 {{random:起雾,涨潮,断电}}。{{getvar::好感度}} 点好感。{{// 这里是给作者看的注释}}`;

/**
 * A file attachment. SillyTavern prepends the file text to `mes` and records its
 * length in `extra.fileLength`, so the correct read is `mes.slice(fileLength)`.
 * A user attaches different files across a chat, so the text varies per turn —
 * the batch-level repeated-line filter cannot save us here.
 */
const attachmentText = (rng = () => 0.5, i = 0) => `锈港港务处年度报告 第${i + 1}号（节选）
第一章 泊位统计
本季度泊位周转 ${100 + Math.floor((rng?.() ?? 0.5) * 400)} 次，泊位周转的统计口径与上一季度一致。
第二章 设备检修
检修记录显示，${pick(rng, PLACES)}设备检修共计 ${1 + Math.floor((rng?.() ?? 0.5) * 8)} 次。
第三章 结论
泊位周转与设备检修的次数均在港务处的预期区间内。`;

/* =======================================================================
 * Fixture builders. Each returns { lines, expected }.
 * `expected.droppedLines` is derived from the noise we injected, never from
 * running the cleaner — otherwise the test would only assert "unchanged".
 * ======================================================================= */

const TURNS = 24;   // 24 user + 24 char = 48 messages, past every batch threshold

/**
 * @param opts.charNoise  (rng, i) => string appended to the char message (block noise)
 * @param opts.userNoise  (rng, i) => string appended to the user message
 * @param opts.charExtra  (rng, i) => extra fields merged into extra
 * @param opts.inline     true when the noise is inline, so no whole lines disappear
 */
function build(id, title, opts) {
  const rng = mulberry32(opts.seed);
  const lines = [JSON.stringify(header(id, opts.meta))];
  let noiseLines = 0;
  let storyLines = 0;
  for (let i = 0; i < TURNS; i++) {
    const uBody = story(rng, 170 + Math.floor(rng() * 100));
    const uNoise = opts.userNoise ? opts.userNoise(rng, i) : '';
    storyLines += nonEmpty(uBody);
    noiseLines += opts.inline ? 0 : nonEmpty(uNoise);
    lines.push(JSON.stringify(
      opts.userMsg ? opts.userMsg(rng, i, uBody, uNoise) : userMsg(i * 2, uNoise ? `${uBody}\n\n${uNoise}` : uBody),
    ));

    const cBody = story(rng, 240 + Math.floor(rng() * 140));
    const cNoise = opts.charNoise ? opts.charNoise(rng, i) : '';
    storyLines += nonEmpty(cBody);
    noiseLines += opts.inline ? 0 : nonEmpty(cNoise);
    lines.push(JSON.stringify(
      opts.charMsg
        ? opts.charMsg(rng, i, cBody, cNoise)
        : charMsg(i * 2 + 1, opts.card, cNoise ? `${cNoise}\n\n${cBody}` : `${cBody}\n\n${cNoise}`, opts.charExtra ? opts.charExtra(rng, i) : {}),
    ));
  }
  // A story sentence that must survive, planted once in the last user turn.
  const keep = opts.keep ?? '守夜人把煤油灯挂回了铁钩上。';
  lines.push(JSON.stringify(userMsg(TURNS * 2 + 2, `${story(rng, 200)}\n\n${keep}`)));
  storyLines += 1;

  return {
    lines,
    expected: {
      id,
      title,
      roles: opts.roles ?? ['user', 'char'],
      /** [min, max] non-empty lines that must disappear between `raw` and `text`. */
      droppedLines: opts.droppedLines ?? [
        Math.round(noiseLines * 0.8),
        Math.round(noiseLines + storyLines * 0.1),
      ],
      mustKeep: [keep, ...(opts.mustKeep ?? [])],
      mustNotTop: opts.mustNotTop,
      /** Free-text note: what the failure would mean for a user. */
      why: opts.why,
    },
  };
}

const FIXTURES = [
  /* 1. Chain of thought: <think> in the body plus a real extra.reasoning trace. */
  build('01-cot', '思维链：<think> 块 + extra.reasoning', {
    seed: 101, card: '锈港灯塔',
    charNoise: (rng) => thinkBlock(rng),
    charExtra: (rng) => ({ reasoning: reasoningTrace(rng), reasoning_type: 'model', reasoning_duration: 2400 }),
    mustNotTop: ['推进', '节奏', '穿帮', '用户', '时间线', '过度'],
    why: '思维链没清掉的话，TOP 里会出现「用户/节奏/穿帮」这类模型自言自语的词。',
  }),

  /* 2. Status bars in all three shapes at once. */
  build('02-statusbar', '状态栏：markdown 表格 + key:value + [标签] 三种形态', {
    seed: 102, card: '锈港灯塔',
    charNoise: (rng) => `${statusTable(rng)}\n\n${statusKv(rng)}\n\n${statusBracket(rng)}`,
    mustNotTop: ['好感度', '当前时间', '当前地点', '体力值', '所持', '待命', '数值'],
    why: '状态栏每楼一份，不清掉就是 TOP 的前几名，词云变成属性表。',
  }),

  /* 3. World Info residue: the default wi_format wrapper and a tagged variant. */
  build('03-worldinfo', 'World Info 注入残留：wi_format 包裹 + <world_info> 标签', {
    seed: 103, card: '锈港灯塔',
    charNoise: (rng) => `${worldInfoLeak(rng)}\n\n${worldInfoTagged(rng)}`,
    mustNotTop: ['守则', '值夜人', '潮汐表', '港务处', '缆车站', '公布'],
    why: '世界书正文被复读进每一楼，词云统计的就是设定集而不是剧情。',
  }),

  /* 4. Instruct-mode sequences leaking into the visible text. */
  build('04-instruct', 'Instruct 前后缀泄漏：### Instruction / <|im_start|> / [INST]', {
    seed: 104, card: '锈港灯塔',
    charNoise: () => `${instructLeak()}\n\n${instructLeakTail()}`,
    mustNotTop: ['Instruction', 'Response', 'assistant', 'INST', 'im_start', '人称'],
    why: '模板前后缀是每楼固定出现的，一旦漏进来必然进 TOP。',
  }),

  /* 5. A regex script that only half-fired, plus a plugin nobody can enumerate. */
  build('05-regex-half', '正则脚本半成品 + 未知插件自定义块', {
    seed: 105, card: '锈港灯塔',
    charNoise: (rng) => `${regexHalf(rng)}\n\n${unknownPlugin(rng)}`,
    mustNotTop: ['状态栏', '司辰', '面板', '电量', '潮汐引擎', '潮位', '回落'],
    why: '正则只替换了一半时会留下孤立的开/闭标签，白名单结构判据是唯一的兜底。',
  }),

  /* 6. Group chat: several speakers, /sys narrator lines, /hide-ed lines. */
  build('06-group', '群聊：多角色 + /sys 旁白 + /hide 隐藏楼', {
    seed: 106, card: '锈港灯塔',
    charMsg: (rng, i, body) => {
      const speaker = CAST[i % 3];
      if (i % 5 === 4) {
        return charMsg(i * 2 + 1, 'System', `旁白：雾从引桥那头压过来，能见度不足二十米。旁白提示：本轮由系统托管。`, { type: 'narrator' });
      }
      if (i % 7 === 6) {
        return charMsg(i * 2 + 1, speaker, body, {}, { is_system: true });
      }
      return charMsg(i * 2 + 1, speaker, body, {}, { force_avatar: `/thumbnail?type=avatar&file=${speaker}.png`, original_avatar: `${speaker}.png` });
    },
    droppedLines: [0, 4],
    mustNotTop: ['旁白', '托管', '系统'],
    why: '群聊里 /sys 旁白必须算 system 角色；算进 char 就会把系统提示词统计成剧情。',
  }),

  /* 7. Swipes: three alternatives, swipe_id pointing at the last one. */
  build('07-swipes', 'swipes 混合：swipe_id 指向第三条，前两条含独有词', {
    seed: 107, card: '锈港灯塔',
    charMsg: (rng, i, body) => {
      const chosen = body;
      const alt1 = `${story(rng, 300)}\n\n他们讨论了整整一个下午的赔偿方案，赔偿方案迟迟没有定下来。赔偿方案又被推翻了一次。`;
      const alt2 = `${story(rng, 300)}\n\n窗外的信号塔闪了三下，信号塔的红灯在雾里发虚，信号塔又灭了。`;
      return charMsg(i * 2 + 1, '锈港灯塔', chosen, {}, {
        swipes: [alt1, alt2, chosen], swipe_id: 2,
        swipe_info: [{ send_date: at(i) }, { send_date: at(i) }, { send_date: at(i) }],
      });
    },
    droppedLines: [0, 4],
    mustNotTop: ['赔偿', '方案', '信号塔'],
    why: '默认只统计被选中的那条；把未选 swipe 也算进去等于把没发生的剧情算成剧情。',
  }),

  /* 8. Translation extension: extra.display_text holds what the user saw. */
  build('08-translate', '翻译插件：extra.display_text 双语（入站译文 / 出站原文）', {
    seed: 108, card: '锈港灯塔',
    userMsg: (rng, i, body) => userMsg(i * 2,
      `The keeper walked into the boathouse and checked the lantern brackets carefully again.`,
      { display_text: body }),
    charMsg: (rng, i, body) => charMsg(i * 2 + 1, '锈港灯塔',
      `The harbour fog thickened around the pier while the winch cable creaked overhead constantly.`,
      { display_text: body }),
    droppedLines: [0, 4],
    mustNotTop: ['keeper', 'boathouse', 'lantern', 'harbour', 'winch', 'thickened'],
    mustKeep: [],
    why: '入站消息 mes 是原文、display_text 是译文；出站消息反过来。取错就统计了用户没看见的那一份。',
  }),

  /* 9. File attachment: the file text is PREPENDED to `mes`, length in extra.fileLength. */
  build('09-attachment', '文件附件正文：附件文本被前置进 mes（extra.fileLength）', {
    seed: 109, card: '锈港灯塔',
    userMsg: (rng, i, body) => {
      const text = attachmentText(rng, i);
      const file = text + '\n\n';
      return userMsg(i * 2, file + body, {
        fileLength: file.length,
        file: { url: `user/files/report-${i}.txt`, name: `report-${i}.txt`, size: file.length, created: T0, text },
      });
    },
    droppedLines: [Math.round(7 * TURNS * 0.8), 7 * TURNS + 12],
    mustNotTop: ['泊位', '周转', '检修', '港务处', '统计', '口径'],
    why: '附件正文是用户上传的文档，不是他说的话。不切掉的话一份 PDF 就能主宰整张词云。',
  }),

  /* 10. Image caption: extra.image / extra.title / inline base64 / <img title>. */
  build('10-image', '图片 caption：extra.title + <img title> + 内联 base64', {
    seed: 110, card: '锈港灯塔',
    charNoise: () => `<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg${'QUJDREVGR0hJSktM'.repeat(20)}=" title="生成图：雾中的缆车站全景，色调偏冷" alt="缆车站全景">`,
    charExtra: () => ({
      image: 'user/images/scene.png',
      title: '生成图：雾中的缆车站全景，色调偏冷',
      append_title: true,
      inline_image: true,
    }),
    droppedLines: [0, TURNS + 4],
    mustNotTop: ['生成图', '全景', '色调', 'base64', 'iVBORw'],
    why: 'caption 是画图插件写的提示词，不是对话；base64 一旦被分词会造出一堆垃圾词。',
  }),

  /* 11. Unexpanded macros. */
  build('11-macros', '宏未展开：{{user}} / {{char}} / {{roll:}} / {{random:}} / {{getvar::}}', {
    seed: 111, card: '锈港灯塔', inline: true,
    charNoise: (rng) => macroSoup(rng),
    droppedLines: [0, 4],
    mustNotTop: ['roll', 'random', 'getvar', 'user', 'char', '好感度'],
    why: '宏没展开说明这段是模板而不是正文；把 {{user}} 当词统计出来是最显眼的低级错误。',
  }),

  /* 12. A full HTML/CSS/JS status panel pasted into the message. */
  build('12-html', 'HTML/CSS/JS 片段：裸 CSS + <style> + <script> + 面板 DOM', {
    seed: 112, card: '锈港灯塔',
    charNoise: (rng) => htmlPanel(rng),
    mustNotTop: ['opacity', 'keyframes', 'padding', 'function', 'html', 'forEach', 'linear'],
    why: '面板 HTML 是显示层，词云统计到 padding / opacity 就说明清洗漏了整块代码。',
  }),
];

/* ---------- Write ---------- */
fs.mkdirSync(OUT, { recursive: true });
const made = [];
for (const f of FIXTURES) {
  const body = f.lines.join('\n') + '\n';
  const name = `${f.expected.id}.jsonl`;
  fs.writeFileSync(path.join(OUT, name), body);
  fs.writeFileSync(path.join(OUT, `${f.expected.id}.expected.json`), JSON.stringify(f.expected, null, 2) + '\n');
  made.push([name, f.lines.length - 1, body.length, f.expected.title]);
}

console.log('生成到', path.resolve(OUT));
for (const [n, msgs, bytes, title] of made) {
  console.log(`  ${String(msgs).padStart(3)} 条  ${String((bytes / 1024).toFixed(0)).padStart(5)} KB  ${n.padEnd(20)} ${title}`);
}
console.log(`\n共 ${made.length} 份。跑 \`npx vitest run test/hard-fixtures.test.ts\` 看通过率。`);

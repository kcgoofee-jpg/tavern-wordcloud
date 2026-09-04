/**
 * Generate test chat logs in the SillyTavern export format (metadata line, then
 * one message per line with swipes, extra.reasoning, gen_started / gen_finished).
 * Plugin noise (<fate_ui>, <UpdateVariable>, HTML panels, bare CSS, tables,
 * reasoning, OOC) is mixed in at roughly the real 40% share.
 *
 * Usage: node tools/make-fixtures.mjs [outDir]
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] ?? 'fixtures';
const SIZES = [100, 200, 500, 1000, 1500];

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

/* ---------- Vocabulary: long-tailed (Zipf-like) so the cloud has structure ---------- */
const CAST = ['沈砚秋', '周敬亭', '尹昭', '苏挽', '韩野', '佟慧', '霁明', '秦川', '淑漪', '柳明章'];
const HERO = '高飞';
const PLACES = ['排练厅', '会议室', '办公室', '走廊', '片场', '客厅', '厨房', '阳台', '化妆间', '停车场', '天台', '录音棚', '道具棚', '休息室'];
const THINGS = ['本子', '合同', '手机', '茶杯', '文件袋', '监视器', '通告单', '复印件', '钥匙', '信封', '台词本', '保温杯', '笔记本', '折叠椅'];
const VERBS = ['推开', '合上', '递给', '接过', '放下', '拿起', '翻到', '塞进', '掏出', '按住', '拨开', '抬起'];
const MOVES = ['站起来', '坐下', '走过去', '停住', '转过身', '低下头', '抬起头', '靠在墙上', '走到窗边', '退了半步'];
const EMOS = ['没说话', '笑了一下', '皱了皱眉', '叹了口气', '愣了两秒', '摇摇头', '点点头', '别过脸去'];
const ABSTRACT = ['分寸', '底线', '筹码', '默契', '尺度', '交代', '路数', '章程', '眉目', '风向'];
const TIMES = ['早上八点', '中午十二点', '下午三点', '傍晚六点', '晚上九点', '凌晨两点'];

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];
// Protagonists follow a power law; supporting cast decays
const someone = (rng) => {
  const r = rng();
  if (r < 0.34) return HERO;
  const i = Math.min(CAST.length - 1, Math.floor(Math.abs(Math.log(1 - r)) * 2.4));
  return CAST[i];
};

function sentence(rng) {
  const a = someone(rng), b = someone(rng);
  const t = [
    () => `${a}${pick(rng, VERBS)}${pick(rng, THINGS)}，${pick(rng, EMOS)}。`,
    () => `${a}${pick(rng, MOVES)}，${b}跟着${pick(rng, MOVES)}。`,
    () => `${pick(rng, PLACES)}里只剩下${a}和${b}两个人。`,
    () => `"这事得有个${pick(rng, ABSTRACT)}。"${a}说。`,
    () => `${a}把${pick(rng, THINGS)}${pick(rng, VERBS)}${b}，"${pick(rng, TIMES)}之前给我回话。"`,
    () => `${b}${pick(rng, EMOS)}，过了很久才开口："${pick(rng, ABSTRACT)}我懂，但这次不一样。"`,
    () => `${pick(rng, TIMES)}，${a}到了${pick(rng, PLACES)}。`,
    () => `窗外的光落在${pick(rng, THINGS)}上，${a}盯着看了一会儿。`,
    () => `${a}想起${b}说过的那句话，${pick(rng, EMOS)}。`,
    () => `${pick(rng, PLACES)}的门被推开，${b}走了进来，手里拿着${pick(rng, THINGS)}。`,
  ];
  return pick(rng, t)();
}

function narrative(rng, targetChars) {
  let out = '';
  while (out.length < targetChars) {
    let para = '';
    const n = 3 + Math.floor(rng() * 4);
    for (let i = 0; i < n; i++) para += sentence(rng);
    out += para + '\n\n';
  }
  return out.trim();
}

/* ---------- Plugin noise, modelled on real exports ---------- */
function fateUi(rng) {
  return `\n\n<fate_ui>\n:::schedule\n[周期|2008-0${1 + Math.floor(rng() * 9)}-1${Math.floor(rng() * 9)}]\n{程|${pick(rng, TIMES)}|${pick(rng, PLACES)}|${pick(rng, THINGS)}}\n{程|${pick(rng, TIMES)}|${pick(rng, PLACES)}|待定}\n:::\n</fate_ui>`;
}
function updateVariable(rng) {
  return `\n\n<UpdateVariable>\n<Analysis>\n- 叙事.标题: ${pick(rng, ABSTRACT)}\n- time passed: about ${Math.floor(rng() * 5)} hours, single scene\n- dramatic updates allowed: ${rng() > 0.5 ? 'yes' : 'no'}\n- variables changed this reply:\n  - /世界/当前地点 (set to ${pick(rng, PLACES)})\n</Analysis>\n<JSONPatch>\n[{"op":"replace","path":"/叙事/标题","value":"${pick(rng, ABSTRACT)}"}]\n</JSONPatch>\n</UpdateVariable>`;
}
function statusHtml(rng) {
  // Worst real-world shape: full HTML page plus bare CSS
  return `\n\n.mes_text .status-panel {\n  color: #1f2937;\n  padding: 12px;\n  border-radius: 8px;\n}\n\n.mes_text .status-panel li {\n  margin: 3px 0;\n}\n\n@keyframes slideUp {\n  from {\n    opacity: 0;\n  }\n  to {\n    opacity: 1;\n  }\n}\n<!DOCTYPE html>\n<html>\n<head>\n<style>\n#render-root {\n  background: linear-gradient(135deg, #ffb6c1, #e6a8d7);\n  overflow: hidden;\n}\n</style>\n<script type="module">\nfunction renderList(selector, dataObj) {\n  let html = '';\n  Object.entries(dataObj).forEach(([name, data]) => {\n    html += '<span>' + name + '</span>';\n  });\n  $(selector).html(html);\n}\n</script>\n</head>\n<body>\n<div id="render-root">\n<div class="section-header"><span>状态</span></div>\n<div class="section-content">${pick(rng, PLACES)}</div>\n</div>\n</body>\n</html>`;
}
function mdTable(rng) {
  return `\n\n| 属性 | 值 |\n|---|---|\n| 地点 | ${pick(rng, PLACES)} |\n| 时间 | ${pick(rng, TIMES)} |\n| 状态 | 正常 |`;
}
function thinking(rng) {
  return `<thinking>\n先确认${pick(rng, CAST)}的动机，再决定这一轮推进到哪里。\n</thinking>\n\n`;
}

/* ---------- Assembly ---------- */
function makeChat({ turns, charName, model, seed, withImages }) {
  const rng = mulberry32(seed);
  const t0 = Date.UTC(2026, 7, 20, 9, 0, 0);
  const lines = [];
  lines.push(JSON.stringify({
    user_name: 'unused',
    character_name: 'unused',
    chat_metadata: {
      integrity: `fixture-${seed}`,
      note_prompt: '', note_interval: 1, note_position: 1, note_depth: 4, note_role: 0,
      timedWorldInfo: { sticky: {}, cooldown: {} },
      variables: {},
      world_info: charName,
      tainted: true,
      lastInContextMessageId: Math.max(0, turns - 6),
    },
  }));

  for (let i = 0; i < turns; i++) {
    const isUser = i % 2 === 0;
    const at = new Date(t0 + i * 137000).toISOString();
    if (isUser) {
      // Around 1000 characters per turn so user messages are long enough to test
      let mes = narrative(rng, 700 + Math.floor(rng() * 620));
      if (withImages && rng() < 0.08) {
        mes += `\n\n![截图](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk${'QF9fX18'.repeat(30)}=)`;
      }
      lines.push(JSON.stringify({
        name: 'goofy', is_user: true, is_system: false, send_date: at, mes,
        extra: { isSmallSys: false }, swipes: [], variables: [], variables_initialized: [], is_ejs_processed: [],
      }));
    } else {
      const body = narrative(rng, 700 + Math.floor(rng() * 620));
      let mes = (rng() < 0.12 ? thinking(rng) : '') + body;
      if (rng() < 0.75) mes += fateUi(rng);
      if (rng() < 0.7) mes += updateVariable(rng);
      if (rng() < 0.18) mes += statusHtml(rng);
      if (rng() < 0.15) mes += mdTable(rng);
      mes += '\n\n<StatusPlaceHolderImpl/>';
      const alt = narrative(rng, 400);
      const gen0 = new Date(t0 + i * 137000 - 9000).toISOString();
      lines.push(JSON.stringify({
        name: charName, is_user: false, send_date: at, mes, title: '',
        gen_started: gen0, gen_finished: at,
        extra: {
          api: 'custom', model,
          reasoning: `（${pick(rng, CAST)}这时候应该还在${pick(rng, PLACES)}，先把这条线收住。）`,
          reasoning_duration: 1200 + Math.floor(rng() * 5000),
          reasoning_signature: null,
          time_to_first_token: 600 + Math.floor(rng() * 2500),
          reasoning_type: 'model',
        },
        swipes: [mes, alt],
        swipe_id: 0,
        swipe_info: [
          { send_date: at, gen_started: gen0, gen_finished: at, extra: { api: 'custom', model } },
          { send_date: at, gen_started: gen0, gen_finished: at, extra: { api: 'custom', model } },
        ],
        variables: [], variables_initialized: [], is_ejs_processed: [],
      }));
    }
  }
  return lines.join('\n') + '\n';
}

fs.mkdirSync(OUT, { recursive: true });
const stamp = (i) => `2026-08-2${i % 9}@1${i % 9}h0${i % 6}m0${i % 9}s${100 + i}ms`;

const made = [];
// Main card: five sizes for performance and tokenization tests
SIZES.forEach((turns, i) => {
  const name = `逐梦演艺圈4.2 - ${stamp(i)}.jsonl`;
  const body = makeChat({ turns, charName: '逐梦演艺圈4.2', model: 'deepseek-v4-flash', seed: 1000 + turns, withImages: turns >= 500 });
  fs.writeFileSync(path.join(OUT, name), body);
  made.push([name, turns, body.length]);
});
// Second card: for multi-card grouping and merging
[120, 300].forEach((turns, i) => {
  const name = `狐狸海风与家人 - ${stamp(20 + i)}.jsonl`;
  const body = makeChat({ turns, charName: '狐狸海风与家人', model: 'gemini-3-pro', seed: 7000 + turns, withImages: false });
  fs.writeFileSync(path.join(OUT, name), body);
  made.push([name, turns, body.length]);
});

console.log('生成到', path.resolve(OUT));
for (const [n, t, b] of made) console.log(`  ${String(t).padStart(5)} 层  ${(b / 1024 / 1024).toFixed(2)} MB  ${n}`);

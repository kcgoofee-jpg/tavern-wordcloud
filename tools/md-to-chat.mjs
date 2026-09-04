#!/usr/bin/env node
/**
 * Convert one-paragraph-per-turn Markdown into a SillyTavern .jsonl export.
 * Writing and formatting are separate steps so a bad quote cannot break the file.
 *
 * Usage: node tools/md-to-chat.mjs fixtures/src/ceo-zh.md "陆时衍" > fixtures/ceo-zh.jsonl
 */
import fs from 'node:fs';

const [, , srcPath, charName = 'Character'] = process.argv;
if (!srcPath) {
  console.error('用法: node tools/md-to-chat.mjs <素材.md> [角色名]');
  process.exit(1);
}

const raw = fs.readFileSync(srcPath, 'utf8')
  // The outline at the top is for the writer, not chat content
  .replace(/<!--[\s\S]*?-->/g, '');

/** A line like `## 12 A` starts a new turn */
const HEAD = /^##\s+(\d+)\s+([UA])\s*$/;
const turns = [];
let cur = null;
for (const line of raw.split('\n')) {
  const m = HEAD.exec(line.trim());
  if (m) {
    if (cur) turns.push(cur);
    cur = { n: Number(m[1]), role: m[2], lines: [] };
  } else if (cur) {
    cur.lines.push(line);
  }
}
if (cur) turns.push(cur);

// Check numbering and alternation; skipped numbers or two consecutive A turns shift every speaker
const problems = [];
turns.forEach((t, i) => {
  if (t.n !== i + 1) problems.push(`第 ${i + 1} 段的编号是 ${t.n}`);
  const want = i % 2 === 0 ? 'U' : 'A';
  if (t.role !== want) problems.push(`第 ${t.n} 层应该是 ${want}，写的是 ${t.role}`);
});
if (problems.length) {
  console.error(`素材有 ${problems.length} 处问题：`);
  for (const p of problems.slice(0, 10)) console.error('  ' + p);
  process.exit(1);
}

const out = [];
out.push(JSON.stringify({
  chat_metadata: {
    integrity: 'f1x7ure0-0000-4000-8000-000000000001',
    note_prompt: '', note_interval: 1, note_position: 1, note_depth: 4, note_role: 0,
    variables: {}, timedWorldInfo: { sticky: {}, cooldown: {} },
    tainted: true, lastInContextMessageId: 0,
  },
  user_name: 'unused', character_name: 'unused',
}));

// Timestamps start three months ago with irregular gaps
let t = Date.UTC(2026, 2, 1, 9, 12, 4, 221);
// Seeded PRNG: fixtures must be reproducible
let seed = 20260301;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

/**
 * Plugin blocks as found in real exports, copied verbatim. Sampled from 22 real
 * logs: fate_ui x299, StatusPlaceHolderImpl x244, UpdateVariable x217, Analysis x217, JSONPatch x216.
 */
const NOISE = [
  `<fate_ui>\n:::schedule\n[cycle|2026-03-14 Sat|week 11]\n{plan|03-14|09:30-11:00|board review|Level 42}\n{plan|03-14|13:00-14:30|due diligence|Aurelian floor 9}\n{plan|03-15|08:00-09:00|press prep|media room}\n:::\n:::relation\n[trust|3|+1]\n[tension|7|-2]\n[leverage|5|0]\n:::\n:::inventory\n{item|silver cufflink|worn}\n{item|fountain pen|carried}\n:::\n</fate_ui>`,
  `<UpdateVariable>\n<Analysis>\n- time passed: one afternoon, no jump\n- dramatic updates allowed: no\n</Analysis>\n<JSONPatch>\n[{"op":"replace","path":"/trust","value":3}]\n</JSONPatch>\n</UpdateVariable>`,
  `<StatusPlaceHolderImpl>\n<style>\n.status-root{display:flex;flex-direction:column;padding:8px 12px;background:rgba(0,0,0,.35);border-radius:12px;font-family:system-ui}\n.status-root .row{display:flex;align-items:center;justify-content:space-between;margin:2px 0}\n.status-root .bar{width:120px;height:6px;border-radius:3px;background:linear-gradient(90deg,#c8a06a,#7a5c33)}\n.status-root .label{opacity:.72;font-size:11px;letter-spacing:.02em}\n.status-root .value{font-variant-numeric:tabular-nums;color:#e8dcc8}\n@keyframes slideup{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}\n.status-root{animation:slideup .3s ease backwards}\n</style>\n<div class="status-root"><div class="row"><span class="label">trust</span><span class="bar"></span><span class="value">3</span></div><div class="row"><span class="label">tension</span><span class="bar"></span><span class="value">7</span></div></div>\n</StatusPlaceHolderImpl>`,
  `<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" />`,
  `<thinking>\nShe is testing whether he will flinch. Hold the beat.\n</thinking>`,
];

for (const turn of turns) {
  let text = turn.lines.join('\n').trim();
  if (!text) { console.error(`第 ${turn.n} 层是空的`); process.exit(1); }
  // Injected at the real ratio (about 39% of characters are not dialogue), so the "no plugin strings in TOP 60" check is meaningful.
  if (turn.role === 'A') {
    // Proportional to text length, not a fixed block count, so long messages are not diluted.
    const TARGET = 0.42;                       // ~39% measured on real logs
    const avgBlock = NOISE.reduce((a, b) => a + b.length, 0) / NOISE.length;
    const want = Math.max(1, Math.round((TARGET * text.length) / ((1 - TARGET) * avgBlock)));
    for (let k = 0; k < want; k++) {
      const block = NOISE[Math.floor(rnd() * NOISE.length)];
      text = rnd() < 0.5 ? `${block}\n\n${text}` : `${text}\n\n${block}`;
    }
  }
  t += Math.round((2 + rnd() * 900) * 1000);
  const isUser = turn.role === 'U';
  const msg = {
    name: isUser ? 'goofy' : charName,
    is_user: isUser,
    is_system: false,
    send_date: new Date(t).toISOString(),
    mes: text,
    extra: { isSmallSys: false, reasoning: '' },
  };
  if (!isUser) {
    Object.assign(msg.extra, {
      api: 'custom', model: 'deepseek-v4-flash',
      time_to_first_token: 1200 + Math.round(rnd() * 4000),
    });
    // 15% carry swipes; mes must equal swipes[swipe_id]
    if (rnd() < 0.15) {
      msg.swipe_id = 1;
      msg.swipes = [text.slice(0, Math.max(40, Math.floor(text.length * 0.6))) + '……', text];
    }
    // 10% carry reasoning traces
    if (rnd() < 0.10) {
      msg.extra.reasoning = `这一轮要推进的是${turn.n}层的节点。`
        + `先确认上一轮留下的悬念有没有回收，再决定这次是推进还是延宕。`
        + `语气上保持克制，不要把话说满。`;
    }
  }
  out.push(JSON.stringify(msg));
}

process.stdout.write(out.join('\n') + '\n');
console.error(`✅ ${turns.length} 层 · ${turns.reduce((a, x) => a + x.lines.join('').length, 0)} 字`);

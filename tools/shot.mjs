#!/usr/bin/env node
/**
 * Screenshot the UI with a real headless Chrome over CDP: load a corpus, open
 * every panel, capture each state.
 *
 * Usage: node tools/shot.mjs [width] [height]
 */
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { createServer } from 'node:http';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
/** Random CDP port: a leaked Chrome on a fixed port would be attached to instead of a fresh profile (happened once; it carried localStorage across runs). */
const PORT = Number(process.env.SHOT_PORT) || 9300 + Math.floor(Math.random() * 600);
/** Without SHOT_URL the tool serves dist-single/index.html itself on a random port, so it never audits a stale or
 *  dev-injected page left running elsewhere (npm start injects the .env.local endpoint into localStorage). */
let URL_ = process.env.SHOT_URL || '';
const W = Number(process.argv[2]) || 1440;
const H = Number(process.argv[3]) || 900;
const OUT = process.env.SHOT_DIR || '/tmp/shot';

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

/** Build first so the screenshots always show the current code. */
if (!process.env.SHOT_NO_BUILD) {
  process.stderr.write('构建中…');
  const r = spawnSync('npm', ['run', 'build:single'], { encoding: 'utf8' });
  if (r.status !== 0) { console.error('\n构建失败\n' + (r.stderr || r.stdout)); process.exit(1); }
  process.stderr.write('好了\n');
}

let staticServer = null;
if (!URL_) {
  const html = readFileSync(path.join(process.cwd(), 'dist-single', 'index.html'));
  staticServer = createServer((req, res) => {
    if (req.url?.startsWith('/api/')) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise((r) => staticServer.listen(0, '127.0.0.1', r));
  URL_ = `http://127.0.0.1:${staticServer.address().port}/`;
  console.error(`serving dist-single at ${URL_}`);
}

/** Fresh profile every run so no localStorage state leaks between runs. */
const PROFILE = `/tmp/shot-profile-${Date.now()}`;
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--remote-debugging-port=${PORT}`, `--window-size=${W},${H}`,
  `--user-data-dir=${PROFILE}`,
], { stdio: 'ignore' });

/**
 * Always take Chrome down with us. A crash or a killed parent used to leave the headless
 * browser (and its renderer helpers) running: 65 of them piled up on 2026-09-04 and pushed
 * the load average past 20.
 */
let cleaned = false;
function cleanup() {
  if (cleaned) return; cleaned = true;
  try { chrome.kill('SIGKILL'); } catch { /* already gone */ }
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* best effort */ }
}
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { cleanup(); process.exit(130); });
process.on('uncaughtException', (e) => { console.error(e); cleanup(); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error(e); cleanup(); process.exit(1); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait for Chrome's debugging port */
async function targetUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Chrome 调试端口没起来');
}

const ws = new WebSocket(await targetUrl());
await new Promise((r) => { ws.onopen = r; });

let id = 0;
const waiting = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id;
  waiting.set(i, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
  ws.send(JSON.stringify({ id: i, method, params }));
});

/** Run JS in the page and await its promise */
const run = async (expr) => {
  const r = await send('Runtime.evaluate', {
    expression: `(async()=>{${expr}})()`, awaitPromise: true, returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception?.description ?? ''));
  return r.result.value;
};

/**
 * SHOT_FAST=1: the layout checks still run, but no PNG is written and click auditing is
 * sampled. A full pass costs ~3.5 min per viewport and was being run dozens of times a day;
 * the fast pass is for iterating, `npm run audit` before pushing is still the gate.
 */
const FAST = process.env.SHOT_FAST === '1';
/** Only audit panels whose title matches, e.g. SHOT_PANELS='导出|词频表'. */
const PANEL_FILTER = process.env.SHOT_PANELS ? new RegExp(process.env.SHOT_PANELS) : null;

const shot = async (name) => {
  if (FAST) return name;
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  return name;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: W, height: H, deviceScaleFactor: 2, mobile: W < 720,
});

/** Endpoint configuration is written by the tool itself rather than relying on npm start injection. */
await send('Page.navigate', { url: URL_ });
await sleep(1500);
if (process.env.SHOT_CURATE) {
  const env = readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
  const g = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1].trim() ?? '';
  await run(`
    const K='tw-settings', s=JSON.parse(localStorage.getItem(K)||'{}');
    s.options=s.options||{}; s.options.ai={...(s.options.ai||{}),
      enabled:false,
      endpoint:${JSON.stringify(g('VITE_DEV_AI_ENDPOINT'))},
      model:${JSON.stringify(g('VITE_DEV_AI_MODEL'))},
      apiKey:${JSON.stringify(g('VITE_DEV_AI_KEY'))},
      chunkChars:1200, concurrency:2};
    localStorage.setItem(K, JSON.stringify(s));
    location.reload();
  `);
  await sleep(2500);
}
/** UI language is pinned (default zh) so screenshots do not depend on the headless browser's locale. SHOT_LANG=en for English. */
{
  const lang = process.env.SHOT_LANG || 'zh';
  await run(`
    const K='tw-settings', s=JSON.parse(localStorage.getItem(K)||'{}');
    s.lang=${JSON.stringify(lang)}; localStorage.setItem(K, JSON.stringify(s)); location.reload();
  `);
  await sleep(2500);
}
await sleep(1200);


/**
 * Layout audit for every open container (sheet, import card, card info, toast):
 *   1. horizontal overflow beyond the container's content box;
 *   2. clipping: overflow hidden with content larger than the element (scroll containers excluded);
 *   3. page level: any element extending past the viewport.
 * Violations are printed and the process exits non-zero (npm run audit).
 */
const auditFailures = [];
const auditLayout = async (label) => {
  const issues = await run(`
    const out = [];
    const vw = innerWidth;
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const nameOf = (el) => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).join('.') : '');
    const containers = [...document.querySelectorAll('.sheet-body, .community-body, .community-head, .import-body, .import-foot, .import-head, .cardinfo-body, .toast, .legal-body, .land-hero, .land-feats, .foot')].filter(vis);
    for (const c of containers) {
      const cs = getComputedStyle(c); const cr = c.getBoundingClientRect();
      const left = cr.left + parseFloat(cs.paddingLeft), right = cr.right - parseFloat(cs.paddingRight);
      for (const el of c.querySelectorAll('*')) {
        if (!vis(el) || (el.closest('svg') && el.tagName !== 'svg')) continue;
        // Inside a horizontal scroller (preset chip row) an element past the right edge is reachable by scrolling, not a leak.
        let scroller = null;
        for (let a = el.parentElement; a && a !== c; a = a.parentElement) { if (/auto|scroll/.test(getComputedStyle(a).overflowX)) { scroller = a; break; } }
        if (scroller) continue;
        const r = el.getBoundingClientRect(); const es = getComputedStyle(el);
        if (r.right > right + 1.5) out.push('[越界右] ' + nameOf(el) + ' 超出 ' + (r.right - right).toFixed(0) + 'px（容器 ' + c.className + '）');
        if (r.left < left - 1.5) out.push('[越界左] ' + nameOf(el) + ' 超出 ' + (left - r.left).toFixed(0) + 'px（容器 ' + c.className + '）');
        if (es.overflowX === 'hidden' && el.scrollWidth > el.clientWidth + 1 && es.textOverflow !== 'ellipsis') out.push('[横向被裁] ' + nameOf(el) + ' 内容 ' + el.scrollWidth + ' > 可见 ' + el.clientWidth);
        if (es.overflowY === 'hidden' && el.scrollHeight > el.clientHeight + 1) out.push('[纵向被裁] ' + nameOf(el) + ' 内容 ' + el.scrollHeight + ' > 可见 ' + el.clientHeight);
      }
    }
    // 孤儿：直接挂在卡片/弹层上、没进任何带内边距的区块的元素——这次「导入确认」两段说明就是这么错位的
    for (const [card, allowed] of [['.import-card', ['import-head', 'import-body', 'import-foot']], ['.sheet', ['sheet-bar', 'sheet-body']]]) {
      for (const c of document.querySelectorAll(card)) for (const el of c.children) {
        if (vis(el) && !allowed.some((k) => el.classList.contains(k))) out.push('[孤儿] ' + nameOf(el) + ' 直接挂在 ' + card + ' 上，没有内边距');
      }
    }
    const inScroller = (el) => { for (let a = el.parentElement; a; a = a.parentElement) if (/auto|scroll/.test(getComputedStyle(a).overflowX)) return true; return false; };
    for (const el of document.querySelectorAll('body *')) {
      if (!vis(el) || el.closest('svg') || inScroller(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1.5 && getComputedStyle(el).position !== 'fixed') out.push('[超出视口] ' + nameOf(el) + ' 右边 ' + (r.right - vw).toFixed(0) + 'px');
    }
    // 文字重叠：两段本该各占一行的文字压在一起。落地页在矮视口上就是这样——一个可收缩的
    // flex 盒被压得比内容还短，justify-content: center 把内容朝上下两头挤出去，而越界检查
    // 只看容器边界，看不出这种压叠（2026-09-05 用户手机截图）。
    {
      const textLeaves = [...document.querySelectorAll('body *')].filter((el) => {
        if (!vis(el) || el.closest('svg') || el.closest('.land-steps, .toast, .sheet, .dialog, .note')) return false;
        const cs = getComputedStyle(el);
        if (cs.pointerEvents === 'none' || parseFloat(cs.opacity) < 0.05) return false;
        // Anything inside a positioned popover (the footer's Links menu, the export steps) is
        // meant to cover the page; only elements laid out in normal flow can be squeezed.
        for (let a = el; a && a !== document.body; a = a.parentElement) {
          const p = getComputedStyle(a).position;
          if (p === 'absolute' || p === 'fixed') return false;
        }
        // Only leaves that carry their own text; a wrapper legitimately covers its children.
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        return own && ![...el.children].some((k) => k.textContent.trim());
      });
      for (let i = 0; i < textLeaves.length; i++) for (let j = i + 1; j < textLeaves.length; j++) {
        const a = textLeaves[i], b = textLeaves[j];
        if (a.contains(b) || b.contains(a)) continue;
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (w <= 1 || h <= 1) continue;
        const small = Math.min(ra.width * ra.height, rb.width * rb.height);
        if (!small || (w * h) / small < 0.18) continue;
        const cx = Math.max(ra.left, rb.left) + w / 2, cy = Math.max(ra.top, rb.top) + h / 2;
        const top = document.elementFromPoint(cx, cy);
        // Only a real collision if one of the two is what actually paints there; a third element
        // covering both (a popover, a scrim) is a stacking decision, not a squeezed layout.
        if (!top || !(a.contains(top) || b.contains(top) || top === a || top === b)) continue;
        const say = (el) => nameOf(el) + '「' + el.textContent.trim().slice(0, 14) + '」';
        out.push('[文字重叠] ' + say(a) + ' 与 ' + say(b) + ' 压住 ' + (w * h / small * 100).toFixed(0) + '%');
      }
    }

    // 间距异常：同一容器里相邻的同类控件，间距突然是中位数的两倍以上——多半是一个残留的空占位
    for (const c of [...document.querySelectorAll('.rail, .dock, .sheet-body, .seg, .kinds, .ai-line, .sheet-acts')].filter(vis)) {
      const kids = [...c.children].filter(vis);
      if (kids.length < 3) continue;
      const col = getComputedStyle(c).flexDirection === 'column';
      const gaps = [];
      for (let i = 1; i < kids.length; i++) {
        if (kids[i].tagName !== kids[i - 1].tagName) { gaps.push(null); continue; }
        const a = kids[i - 1].getBoundingClientRect(), b = kids[i].getBoundingClientRect();
        gaps.push(col ? b.top - a.bottom : b.left - a.right);
      }
      const real = gaps.filter((g) => g !== null && g >= 0).sort((x, y) => x - y);
      if (real.length < 2) continue;
      const med = real[Math.floor(real.length / 2)];
      for (let i = 0; i < gaps.length; i++) {
        if (gaps[i] === null) continue;
        if (med >= 1 && gaps[i] > med * 2 + 2) out.push('[间距异常] ' + nameOf(c) + ' 第 ' + i + '/' + (i + 1) + ' 个之间 ' + gaps[i].toFixed(0) + 'px，中位数 ' + med.toFixed(0) + 'px');
        else if (med < 1 && gaps[i] > 6) out.push('[间距异常] ' + nameOf(c) + ' 第 ' + i + '/' + (i + 1) + ' 个之间 ' + gaps[i].toFixed(0) + 'px，其余贴合');
      }
    }
    // 说明段落：面板里超过 60 字的正文。长解释归 ⓘ（.note-pop），不占版面
    for (const c of [...document.querySelectorAll('.sheet-body')].filter(vis)) {
      for (const el of c.querySelectorAll('p, div, span, li')) {
        if (!vis(el) || el.closest('.note-pop') || el.querySelector('p, div, span, li, button, input, select, textarea')) continue;
        const txt = (el.textContent || '').trim();
        // 一个汉字算一格，两个西文字符算一格：同一句话译成英文会长一倍，阈值要跟着走
        const cjk = (txt.match(/[\u4e00-\u9fff]/g) || []).length;
        const width = cjk + (txt.length - cjk) / 2;
        if (width > 60) out.push('[说明段落] ' + nameOf(el) + ' ' + txt.length + ' 字：' + txt.slice(0, 24) + '…');
      }
    }
    // 按钮断行：分段控件里的选项换了行——按钮文案太长，数字应该挪进小字或 ⓘ
    for (const c of [...document.querySelectorAll('.seg, .ratio, .kinds, .cloudmode')].filter(vis)) {
      for (const el of c.querySelectorAll('button')) {
        if (!vis(el)) continue;
        const lh = parseFloat(getComputedStyle(el).lineHeight) || 16;
        if (el.getClientRects().length && el.scrollHeight > lh * 1.6 + parseFloat(getComputedStyle(el).paddingTop) * 2 + 2) {
          out.push('[按钮断行] ' + nameOf(el) + ' 「' + (el.textContent || '').trim().slice(0, 20) + '」占了两行');
        }
      }
    }
    // 图标按钮：只有图标没有文字的按钮必须有 title 或 aria-label，靠悬停说明，不加文字说明
    for (const el of document.querySelectorAll('button, a[role="button"], summary')) {
      if (!vis(el)) continue;
      if ((el.textContent || '').trim() || !el.querySelector('svg, img')) continue;
      if (!(el.getAttribute('title') || '').trim() && !(el.getAttribute('aria-label') || '').trim()) {
        out.push('[图标无说明] ' + nameOf(el) + ' 只有图标，没有 title/aria-label');
      }
    }
    // 孤立小标题：面板里一个 group-label 底下只带一个控件——这种标题是废话，删掉标题即可
    for (const el of document.querySelectorAll('.sheet-body .group-label, .import-body .group-label')) {
      if (!vis(el)) continue;
      let n = 0;
      for (let sib = el.nextElementSibling; sib && !sib.classList.contains('group-label'); sib = sib.nextElementSibling) {
        if (!vis(sib)) continue;
        const hits = sib.querySelectorAll('button, input, select, textarea, a[href]');
        n += hits.length || 1;
      }
      if (n <= 1) out.push('[孤立小标题] ' + nameOf(el) + ' 「' + (el.textContent || '').trim().slice(0, 12) + '」底下只有 ' + n + ' 个控件');
    }
    // 删除提示：按钮文案里不该出现「立即删除」「记得删除」这类吓人的话
    for (const el of document.querySelectorAll('button, label, .note, p')) {
      if (!vis(el)) continue;
      const txt = (el.textContent || '').trim();
      for (const bad of ['立即删除', '记得删除']) {
        if (txt.includes(bad)) out.push('[删除提示] ' + nameOf(el) + ' 文案含「' + bad + '」：' + txt.slice(0, 24));
      }
    }
    // 面板透明或不能滚：一次错误的 CSS 编辑把 .sheet 规则从中间截断，背景、max-height、overflow 全丢，
    // 词云透过面板显示且面板内容撑出屏幕不能滑（2026-09-04 线上事故）。
    for (const el of document.querySelectorAll('.sheet, .community-page, .import-card, .cardinfo-body')) {
      if (!el.clientHeight) continue;
      const cs = getComputedStyle(el);
      const m = /rgba?\(([^)]+)\)/.exec(cs.backgroundColor);
      const alpha = m ? (m[1].split(',').map(Number)[3] ?? 1) : 1;
      if (!m || alpha < 0.9) out.push('[面板透明] ' + nameOf(el) + ' 背景 ' + cs.backgroundColor);
      const r = el.getBoundingClientRect();
      if (r.bottom > innerHeight + 1 || r.top < -1) out.push('[面板出屏] ' + nameOf(el) + ' ' + r.top.toFixed(0) + '…' + r.bottom.toFixed(0) + ' / ' + innerHeight);
      const body = el.querySelector('.sheet-body, .community-body, .import-body') || el;
      const bcs = getComputedStyle(body);
      if (body.scrollHeight > body.clientHeight + 2 && !/auto|scroll/.test(bcs.overflowY)) out.push('[面板不能滚] ' + nameOf(body) + ' 内容 ' + body.scrollHeight + ' > 可视 ' + body.clientHeight);
    }
    // 文字截断：省略号截掉了文字、又没有 title 给全文（英文卡片标签曾显示成 "Charact…"）
    for (const el of document.querySelectorAll('dt, dd, label > span, .group-label, .field > span, th, td, button, .swatch-name, .src-name')) {
      const cs = getComputedStyle(el);
      if (cs.textOverflow !== 'ellipsis' || !el.clientWidth) continue;
      if (el.scrollWidth > el.clientWidth + 1 && !el.getAttribute('title') && !el.closest('[title]')) out.push('[文字截断] ' + nameOf(el) + ' 「' + (el.textContent || '').trim().slice(0, 24) + '」');
    }
    // 词云被挡：浮动控件压在词的外接框上（手机上圆按钮和角落数字曾经盖住词）
    const b = window.__cloudBounds;
    if (b && b.right > b.left) {
      for (const el of document.querySelectorAll('.cloudmode, .mode-quick, .lang-quick, .community-quick, .dock, .dock-stats, .rail')) {
        if (!vis(el)) continue;
        const r = el.getBoundingClientRect();
        const ox = Math.min(r.right, b.right) - Math.max(r.left, b.left);
        const oy = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top);
        if (ox > 1 && oy > 1) out.push('[词云被挡] ' + nameOf(el) + ' 压住词云 ' + ox.toFixed(0) + '×' + oy.toFixed(0) + 'px');
      }
    }
    return [...new Set(out)].slice(0, 30);
  `);
  if (issues.length) { auditFailures.push(...issues.map((i) => label + ': ' + i)); console.log('  ✗ ' + label + '：' + issues.length + ' 处'); for (const i of issues) console.log('     ' + i); }
  else console.log('  ✓ ' + label + ' 布局干净');
  if (process.env.SHOT_A11Y) await auditA11y(label);
};

/**
 * Accessibility audit (SHOT_A11Y=1): controls without an accessible name, images without alt,
 * clickable roles that cannot take focus. Reported as `[a11y] label: N` lines; never fails the run.
 */
const auditA11y = async (label) => {
  const issues = await run(`
    const out = [];
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const nameOf = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim();
    for (const el of document.querySelectorAll('button, a, [role=button]')) {
      if (!vis(el)) continue;
      if (!nameOf(el) && !el.querySelector('img[alt]')) out.push('[无名称] ' + el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]);
      if (el.getAttribute('role') === 'button' && el.tagName !== 'BUTTON' && el.tabIndex < 0) out.push('[不可聚焦] ' + el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]);
    }
    for (const el of document.querySelectorAll('img')) if (vis(el) && !el.hasAttribute('alt')) out.push('[无alt] img.' + String(el.className).split(' ')[0]);
    for (const el of document.querySelectorAll('input:not([type=hidden])')) {
      if (!vis(el)) continue;
      const labelled = el.labels?.length || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title');
      if (!labelled) out.push('[无标签] input[type=' + (el.type || 'text') + ']');
    }
    return [...new Set(out)].slice(0, 30);
  `);
  console.log('[a11y] ' + label + ': ' + issues.length + (issues.length ? ' → ' + issues.join(' / ') : ''));
};

const shots = [];
// First view: the sample cloud; a click leads to the landing (import page)
shots.push(await shot('01-示例词云'));
await auditLayout('示例词云');
await run(`document.querySelector('.demo-hint')?.click(); await new Promise(r=>setTimeout(r,700));`);
shots.push(await shot('01-空状态'));
await auditLayout('空状态');
// Legal pages: long prose and a table; audited for overflow, then back to the main page
for (const [route, name] of [['terms', '服务条款'], ['enforcement', '执法政策']]) {
  await run(`location.hash='#/${route}'; await new Promise(r=>setTimeout(r,600));`);
  shots.push(await shot(`01c-法律页-${name}`));
  await auditLayout(`法律页 ${name}`);
}
await run(`location.hash=''; await new Promise(r=>setTimeout(r,500));`);

// Load 3 files to trigger the confirmation panel (shown for >= 3 files), audit, then start
{
  const dir = path.join(process.cwd(), 'fixtures');
  const names = readdirSync(dir).filter((f) => f.endsWith('.jsonl') && !f.startsWith('ceo')).slice(0, 3);
  if (names.length === 3) {
    const payload = names.map((n) => [n, readFileSync(path.join(dir, n), 'utf8')]);
    await run(`
      const inp=document.querySelector('input[type=file]');
      const dt=new DataTransfer();
      for (const [n, c] of ${JSON.stringify(payload)}) dt.items.add(new File([c], n));
      Object.defineProperty(inp,'files',{value:dt.files,configurable:true});
      inp.dispatchEvent(new Event('change',{bubbles:true}));
      await new Promise(r=>setTimeout(r,3000));
    `);
    shots.push(await shot('01b-导入确认'));
    await auditLayout('导入确认面板');
    await run(`document.querySelector('.import-go')?.click(); await new Promise(r=>setTimeout(r,4000));`);
    await run(`document.querySelector('.rail .tool[title*="清空"], .rail .tool[title*="Clear"]')?.click(); await new Promise(r=>setTimeout(r,600));`);
  }
}

/** The corpus is read from disk and injected; the single-file server returns the same HTML for every path, so page fetches would fail. */
const fixtureText = readFileSync(process.env.SHOT_FILE
  || path.join(process.cwd(), 'fixtures', 'ceo-zh.jsonl'), 'utf8');

// Load the corpus
await run(`
  const inp=document.querySelector('input[type=file]');
  const buf=${JSON.stringify(fixtureText)};
  const dt=new DataTransfer(); dt.items.add(new File([buf],'陆时衍 - 2026-03-01@09h12m04s221ms.jsonl'));
  Object.defineProperty(inp,'files',{value:dt.files,configurable:true});
  inp.dispatchEvent(new Event('change',{bubbles:true}));
  await new Promise(r=>setTimeout(r,6000));
`);
shots.push(await shot('02-词云'));

/**
 * Click audit: every visible, enabled button in the given scope is clicked once.
 * A click that changes nothing observable (no DOM change, no aria state change,
 * no dialog/panel opened, no download) is reported. Buttons whose title matches
 * `skip` (destructive or file pickers) are left alone. After each click the state
 * is restored by clicking again or pressing Escape.
 */
const clickFailures = [];
// 清洗规则按钮会调模型（付费）——和 测试连接 / 拉取 一样跳过；「立即删除」清密钥后自己变灰，也算副作用按钮
async function auditClicks(label, scope, skip = /清空|Clear|添加|Add|导出|Export|存成|Save|复制|Copy|发送|Send|反馈|report|拉取|Fetch|测试连接|Test|清洗规则|cleaning rules|立即删除|Delete now|验证水印|Check a watermark|导入字体|Import font/i) {
  const bad = await run(`
    const scope = ${JSON.stringify(scope)};
    const skip = ${skip.toString()};
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.pointerEvents !== 'none'; };
    const sig = () => {
      const root = document.body;
      const pressed = [...root.querySelectorAll('[aria-pressed],[aria-checked],input')].map((e) => (e.getAttribute('aria-pressed') ?? '') + (e.getAttribute('aria-checked') ?? '') + (e.checked ?? '') + (e.value ?? '')).join('|');
      // Hash, not length: replacing "1560 × 3376 px" with "1920 × 1080 px" keeps the length and looked like a dead button.
      let h = 0; const html = root.innerHTML; for (let k = 0; k < html.length; k++) h = (h * 31 + html.charCodeAt(k)) | 0;
      return h + '#' + pressed + '#' + location.hash + '#' + document.title;
    };
    window.__downloads = window.__downloads || 0;
    if (!window.__dlHooked) { window.__dlHooked = true; const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__downloads++; return orig.call(this); }; }
    const out = [];
    const inScrollView = (b) => {
      // A button scrolled out of its horizontal scroller cannot be hit by a coordinate click; that is not a dead button.
      for (let a = b.parentElement; a; a = a.parentElement) {
        if (/auto|scroll/.test(getComputedStyle(a).overflowX)) { const r = b.getBoundingClientRect(), s = a.getBoundingClientRect(); return r.left >= s.left - 1 && r.right <= s.right + 1; }
      }
      return true;
    };
    const list = () => [...document.querySelectorAll(scope + ' button')].filter((b) => !b.disabled && vis(b) && inScrollView(b) && !skip.test(b.title || b.textContent || '') && !b.closest('.export-chips') && !(b.classList.contains('on') && b.closest('.seg, .cloudmode')));
    // Preset chips change the preview canvas and the size line; the size line can keep its length, so their reaction is asserted in test/ui/export-panel.test.tsx instead.
    // Click the buttons that were there at the start, by reference: re-listing by index shifted
    // after a chip became selected (excluded) and reported a phantom gone button.
    let initial = list();
    // Fast pass: click a spread-out sample rather than every control.
    if (${FAST}) initial = initial.filter((_, k) => k % 4 === 0);
    const total = initial.length;
    for (let i = 0; i < total; i++) {
      const b = initial[i];
      if (!b.isConnected || !vis(b)) continue; // hid itself after an earlier click: that is a reaction
      const name = (b.title || b.getAttribute('aria-label') || b.textContent || b.className).trim().slice(0, 40);
      const before = sig(); const dl = window.__downloads;
      b.click(); await new Promise((r) => setTimeout(r, 450));
      const changed = sig() !== before || window.__downloads !== dl;
      if (!changed) out.push(name);
      // Restore: click again while the element is still in the DOM; otherwise close whatever opened.
      if (document.contains(b)) { b.click(); await new Promise((r) => setTimeout(r, 300)); }
      else { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise((r) => setTimeout(r, 150)); }
      if (!document.querySelector(scope)) break;
    }
    return { total, dead: out };
  `);
  if (bad.dead.length) { clickFailures.push(...bad.dead.map((n) => `${label}: ${n}`)); console.log(`  ✗ 点击自检 ${label}: ${bad.dead.length}/${bad.total} 个按钮点了没反应 → ${bad.dead.join(' / ')}`); }
  else console.log(`  ✓ 点击自检 ${label}: ${bad.total} 个按钮都有反应`);
}


// Each panel (destructive buttons skipped)
const panels = await run(`
  return [...document.querySelectorAll('.rail .tool')]
    .filter(b=>!b.disabled && /筛选|高级|词频表|优先词|密钥|导出|社区|Filters|Advanced|Word table|Priority|endpoint|Export|Community/.test(b.title))
    .map(b=>b.title);
`);
for (const title of panels) {
  if (PANEL_FILTER && !PANEL_FILTER.test(title)) continue;
  await run(`
    const b=[...document.querySelectorAll('.rail .tool')].find(x=>x.title===${JSON.stringify(title)});
    b.click(); await new Promise(r=>setTimeout(r,600));
  `);
  const slug = title.replace(/[^\w一-鿿]+/g, '');
  shots.push(await shot(`03-面板-${slug}`));
  await auditLayout(`面板 ${title}`);
  await auditClicks(`面板 ${title}`, '.sheet-body');
  // Also capture the bottom of each panel; several sections sit below the fold
  const scrolls = await run(`
    const b=document.querySelector('.sheet-body'); if(!b||b.scrollHeight<=b.clientHeight+8) return false;
    b.scrollTop=b.scrollHeight; await new Promise(r=>setTimeout(r,250)); return true;
  `);
  if (scrolls) { shots.push(await shot(`03-面板-${slug}-底`)); await auditLayout(`面板 ${title}（底部）`); }
  await run(`document.querySelector('.sheet-close')?.click(); await new Promise(r=>setTimeout(r,300));`);
}

// Community page (top button, full page)
await run(`document.querySelector('.community-quick')?.click(); await new Promise(r=>setTimeout(r,800));`);
shots.push(await shot('03b-社区排行榜'));
await auditLayout('社区排行榜');
await auditClicks('社区排行榜', '.community-body');
await run(`document.querySelector('.community-page .sheet-close')?.click(); await new Promise(r=>setTimeout(r,300));`);

// Main screen last: it may switch modes, so restore frequency mode afterwards
await auditClicks('主界面', '.app > :not(.sheet):not(.community-page)');
await run(`[...document.querySelectorAll('.cloudmode button')].find(b=>/词频|Frequency/.test(b.innerText))?.click(); await new Promise(r=>setTimeout(r,400));`);

// Bottom-left buttons
for (const [sel, name] of [['风格与配色', '配色'], ['词云字体', '字体']]) {
  await run(`
    const b=[...document.querySelectorAll('.dock button')].find(x=>x.title===${JSON.stringify(sel)});
    if(b){b.click(); await new Promise(r=>setTimeout(r,600));}
  `);
  shots.push(await shot(`04-${name}`));
  await auditLayout(`面板 ${name}`);
  await run(`document.querySelector('.sheet-close')?.click(); await new Promise(r=>setTimeout(r,300));`);
}

// Card info
await run(`document.querySelector('.cardinfo-head')?.click(); await new Promise(r=>setTimeout(r,600));`);
shots.push(await shot('05-角色卡'));
await auditLayout('角色卡详情');
await run(`document.querySelector('.cardinfo-head')?.click(); await new Promise(r=>setTimeout(r,300));`);

// Keyword mode running: stop button, log, speed
if (process.env.SHOT_CURATE) {
  await run(`
    [...document.querySelectorAll('.cloudmode button')].find(b=>/关键词|Keywords/.test(b.innerText))?.click();
    await new Promise(r=>setTimeout(r,600));
    document.querySelector('.cloudmode-run')?.click();
    await new Promise(r=>setTimeout(r,14000));
  `);
  shots.push(await shot('06-关键词跑起来'));
  // Press stop and check it responds
  const stopped = await run(`
    const b=document.querySelector('.progress-cancel');
    if(!b) return '没有停止按钮';
    const r=b.getBoundingClientRect();
    const top=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);
    const clickable = b.contains(top) || top===b;
    b.click(); await new Promise(r=>setTimeout(r,2500));
    return clickable ? '可点击，已点' : '被别的元素挡住了：'+(top?.className||top?.tagName);
  `);
  console.error('停止按钮:', stopped);
  shots.push(await shot('07-点了停止之后'));
}

console.log(shots.map((s) => path.join(OUT, s + '.png')).join('\n'));
ws.close();
cleanup();
staticServer?.close();

if (auditFailures.length) {
  console.log('\n布局自检：' + auditFailures.length + ' 处问题（见上）');
  process.exitCode = 2;
} else console.log('\n布局自检：全部干净');
if (clickFailures.length) { console.log('点击自检：' + clickFailures.length + ' 个按钮点了没反应'); process.exitCode = 2; }

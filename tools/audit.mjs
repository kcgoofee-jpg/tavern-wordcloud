/**
 * The full layout audit, both languages at once.
 *
 *   npm run audit              # build once, then zh and en in parallel, desktop + phone each
 *   SHOT_NO_BUILD=1 npm run audit
 *
 * The old script ran four shot.mjs passes back to back — zh desktop, zh phone, en desktop,
 * en phone — about 16 minutes, and it was the single biggest cost of every push (the CI
 * itself takes 4). The two languages share nothing but the built file, so they run as two
 * chains side by side, each with its own screenshot directory and its own Chrome profile.
 * Exit code is non-zero if any pass is, and each chain's verdict lines are printed under
 * its own heading so the two logs never interleave.
 */
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const t0 = Date.now();
const secs = () => ((Date.now() - t0) / 1000).toFixed(0);

if (!process.env.SHOT_NO_BUILD) {
  const b = spawnSync('npm', ['run', 'build:single'], { cwd: ROOT, stdio: 'inherit' });
  if (b.status !== 0) process.exit(b.status ?? 1);
}

const VIEWPORTS = [['1440', '900'], ['390', '844']];
const chains = ['zh', 'en'].map((lang) => new Promise((resolve) => {
  const out = [];
  const env = { ...process.env, SHOT_NO_BUILD: '1', SHOT_LANG: lang, SHOT_DIR: `/tmp/shot-${lang}` };
  let i = 0; let failed = 0;
  const next = () => {
    if (i >= VIEWPORTS.length) return resolve({ lang, failed, out });
    const [w, h] = VIEWPORTS[i++];
    const p = spawn(process.execPath, [path.join(ROOT, 'tools', 'shot.mjs'), w, h], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    p.stdout.on('data', (d) => { buf += d; });
    p.stderr.on('data', (d) => { buf += d; });
    p.on('close', (code) => {
      out.push(`--- ${lang} ${w}×${h} · exit ${code} · ${secs()}s`);
      // Verdicts and problems only; the per-panel ticks are in the full log if anyone wants them.
      for (const line of buf.split('\n')) if (/布局自检|点击自检.*没反应|\[.+\]|Error|错误/.test(line)) out.push('  ' + line.trim());
      if (code !== 0) failed++;
      next();
    });
  };
  next();
}));

const results = await Promise.all(chains);
for (const r of results) { console.log(`\n===== ${r.lang} ${r.failed ? '✗' : '✓'}`); console.log(r.out.join('\n')); }
const bad = results.reduce((n, r) => n + r.failed, 0);
console.log(`\n审计 ${bad ? '未通过' : '全部通过'} · ${secs()}s · 截图在 /tmp/shot-zh 与 /tmp/shot-en`);
process.exit(bad ? 2 : 0);

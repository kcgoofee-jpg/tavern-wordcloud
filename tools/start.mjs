#!/usr/bin/env node
/**
 * `npm start` — build, serve the single-file build (LAN accessible) and open the browser.
 * Serves the same artifact that gets deployed.
 */
import { spawnSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = path.join(ROOT, 'dist-single', 'index.html');
const PORT = Number(process.env.PORT) || 5180;

/** LAN address for phones */
function lanAddress() {
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list ?? []) {
      if (n.family === 'IPv4' && !n.internal) return n.address;
    }
  }
  return null;
}

// ── 1. Build (only when sources are newer than the output) ──
const stale = !existsSync(FILE)
  || statSync(FILE).mtimeMs < Math.max(
    ...['src', 'index.html', 'package.json']
      .map((p) => path.join(ROOT, p))
      .filter(existsSync)
      .map((p) => statSync(p).mtimeMs),
  );

if (stale) {
  process.stdout.write('正在构建…');
  const r = spawnSync('npm', ['run', 'build:single'], { cwd: ROOT, stdio: 'pipe' });
  if (r.status !== 0) {
    console.error('\n构建失败：\n' + (r.stderr?.toString() || r.stdout?.toString() || ''));
    process.exit(1);
  }
  console.log('好了');
}

// ── 2. Serve ──
/** Re-read the file when it changes so a rebuild is served immediately. */
let cached = { mtime: 0, raw: '', local: '' };

/**
 * Inject the endpoint configuration from .env.local at response time rather than
 * into the build, so the artifact never contains keys. Only for localhost
 * requests; LAN clients get the clean file.
 */
function devConfigScript() {
  const env = path.join(ROOT, '.env.local');
  if (!existsSync(env)) return '';
  const get = (k) => {
    const m = readFileSync(env, 'utf8').match(new RegExp(`^${k}=(.*)$`, 'm'));
    return m ? m[1].trim() : '';
  };
  const cfg = {
    endpoint: get('VITE_DEV_AI_ENDPOINT'),
    model: get('VITE_DEV_AI_MODEL'),
    apiKey: get('VITE_DEV_AI_KEY'),
  };
  if (!cfg.endpoint || !cfg.apiKey) return '';
  return `<script>(function(){try{
    var K='tw-settings', s=JSON.parse(localStorage.getItem(K)||'{}');
    s.options=s.options||{}; var a=s.options.ai||{};
    // 只补空的，不覆盖你自己改过的
    if(!a.endpoint) a.endpoint=${JSON.stringify(cfg.endpoint)};
    if(!a.model)    a.model=${JSON.stringify(cfg.model)};
    if(!a.apiKey)   a.apiKey=${JSON.stringify(cfg.apiKey)};
    s.options.ai=a; localStorage.setItem(K, JSON.stringify(s));
  }catch(e){}})();</script>`;
}
const injected = devConfigScript();

/** Current HTML; re-read and re-injected when the file changes */
function current() {
  const m = statSync(FILE).mtimeMs;
  if (m !== cached.mtime) {
    const raw = readFileSync(FILE, 'utf8');
    cached = {
      mtime: m,
      raw,
      /** Injected at the start of <head>, before the inlined app, so localStorage is set before components initialize. */
      local: injected ? raw.replace(/(<head[^>]*>)/i, `$1${injected}`) : raw,
    };
  }
  return cached;
}
const server = createServer((req, res) => {
  // Inject only for localhost; LAN clients get the clean file
  const host = (req.headers.host || '').split(':')[0];
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  // Single-file app: every path returns the same HTML
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  const c = current();
  res.end(isLocal ? c.local : c.raw);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 被占用了。换一个：PORT=5181 npm start`);
    process.exit(1);
  }
  throw e;
});

// 0.0.0.0 so phones on the LAN can connect
server.listen(PORT, '0.0.0.0', () => {
  const lan = lanAddress();
  const size = (Buffer.byteLength(current().raw) / 1024).toFixed(0);
  console.log('');
  console.log(`  酒馆词云已启动（单文件 ${size} KB）`);
  console.log('');
  console.log(`  这台电脑    http://localhost:${PORT}`);
  if (lan) console.log(`  同一个 WiFi  http://${lan}:${PORT}   ← 手机用这个`);
  console.log('');
  if (injected) console.log('  （已从 .env.local 预填接口配置，只对本机生效）');
  console.log('  按 Ctrl+C 停止');
  console.log('');

  // ── 3. Open the browser ──
  const opener = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(opener, [`http://localhost:${PORT}`], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
});

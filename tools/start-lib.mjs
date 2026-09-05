/**
 * Helpers for `npm start` (tools/start.mjs), split out so the port fallback and
 * the printed banner can be tested without launching a browser.
 *
 * On language: there is no language signal for a CLI here — `SHOT_LANG` belongs
 * to the screenshot tool and means "which UI language to render", not "which
 * language to talk to the operator in". So every user-facing line is printed in
 * both languages, English first, on one line. No table, no locale guessing, no
 * new i18n mechanism: `npm start` is the path the English README sends people
 * down, and it used to answer them only in Chinese.
 */

/**
 * Listen on the first free port at or after `from`, and resolve with the port
 * that was actually taken.
 *
 * `npm start` used to print "port N is busy, try PORT=… " and exit(1), which is
 * a dead end for anyone who already runs something on 5180 — the common case,
 * since SillyTavern itself and most dev servers sit in that range.
 */
export function listenFrom(server, from, host = '0.0.0.0', tries = 20) {
  return new Promise((resolve, reject) => {
    let port = from;
    let left = tries;
    const cleanup = () => {
      server.removeListener('error', onError);
      server.removeListener('listening', onListening);
    };
    const onError = (e) => {
      // Only a taken port is retried; a permissions or address error is real.
      if (e.code !== 'EADDRINUSE' || left <= 1) { cleanup(); reject(e); return; }
      left -= 1;
      port += 1;
      server.listen(port, host);
    };
    const onListening = () => {
      cleanup();
      const a = server.address();
      resolve(typeof a === 'object' && a ? a.port : port);
    };
    server.on('error', onError);
    server.on('listening', onListening);
    server.listen(port, host);
  });
}

/**
 * The lines printed once the server is up. Returned rather than printed so a
 * test can read them.
 *
 * @param {{ port: number, requested: number, lan: string | null, sizeKb: string, injected: boolean }} o
 * @returns {string[]}
 */
export function banner({ port, requested, lan, sizeKb, injected }) {
  const out = [''];
  out.push(`  Tavern WordCloud is running  /  酒馆词云已启动   (single file / 单文件 ${sizeKb} KB)`);
  if (port !== requested) {
    out.push('');
    out.push(`  Port ${requested} was busy, so this one picked ${port} instead.`);
    out.push(`  端口 ${requested} 被占用，改用了 ${port}。`);
  }
  out.push('');
  out.push(`  This computer / 这台电脑     http://localhost:${port}`);
  if (lan) out.push(`  Same Wi-Fi / 同一个 WiFi    http://${lan}:${port}   <- open this one on a phone / 手机用这个`);
  out.push('');
  if (injected) out.push('  (endpoint settings pre-filled from .env.local, localhost only / 已从 .env.local 预填接口配置，只对本机生效)');
  out.push('  Press Ctrl+C to stop  /  按 Ctrl+C 停止');
  out.push('');
  return out;
}

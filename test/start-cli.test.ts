/**
 * `npm start` (tools/start.mjs) behaviour that an English visitor runs into on
 * the first minute: a port that is already taken, and output they can read.
 *
 * The helpers live in tools/start-lib.mjs so this can exercise them without
 * building the app or opening a browser.
 */
import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { banner, listenFrom } from '../tools/start-lib.mjs';

/** Start a throwaway server and resolve with its port and a close function. */
function occupy(): Promise<{ port: number; close: () => Promise<void> }> {
  const s = createServer((_req, res) => res.end('ok'));
  return new Promise((resolve) => {
    s.listen(0, '127.0.0.1', () => {
      const a = s.address() as { port: number };
      resolve({ port: a.port, close: () => new Promise<void>((r) => s.close(() => r())) });
    });
  });
}

/** Close a server started by listenFrom. */
const shut = (s: ReturnType<typeof createServer>) => new Promise<void>((r) => s.close(() => r()));

describe('npm start: port selection', () => {
  it('uses the requested port when it is free', async () => {
    const taken = await occupy();
    const free = taken.port;
    await taken.close();                     // the kernel just told us this one is unused

    const s = createServer((_req, res) => res.end('ok'));
    const port = await listenFrom(s, free, '127.0.0.1');
    expect(port).toBe(free);
    await shut(s);
  });

  it('moves to the next free port instead of exiting when the port is busy', async () => {
    const taken = await occupy();
    const s = createServer((_req, res) => res.end('ok'));
    const port = await listenFrom(s, taken.port, '127.0.0.1');

    expect(port).toBeGreaterThan(taken.port);
    // and it really is listening, not just a number
    const res = await fetch(`http://127.0.0.1:${port}/`).catch(() => null);
    expect(res).not.toBeNull();

    await shut(s);
    await taken.close();
  });

  it('gives up rather than scanning forever', async () => {
    const taken = await occupy();
    const s = createServer((_req, res) => res.end('ok'));
    // One try means: this port or nothing.
    await expect(listenFrom(s, taken.port, '127.0.0.1', 1)).rejects.toMatchObject({ code: 'EADDRINUSE' });
    await taken.close();
  });
});

describe('npm start: what it prints', () => {
  const base = { port: 5180, requested: 5180, lan: '192.168.1.9', sizeKb: '277', injected: false };

  it('says both languages, so the English README does not lead to a Chinese-only console', () => {
    const text = banner(base).join('\n');
    expect(text).toContain('Tavern WordCloud is running');
    expect(text).toContain('酒馆词云已启动');
    expect(text).toContain('This computer');
    expect(text).toContain('这台电脑');
    expect(text).toContain('Same Wi-Fi');
    expect(text).toContain('Press Ctrl+C to stop');
  });

  it('names the port it actually picked when the requested one was busy', () => {
    const text = banner({ ...base, port: 5183 }).join('\n');
    expect(text).toContain('Port 5180 was busy');
    expect(text).toContain('picked 5183');
    expect(text).toContain('端口 5180 被占用');
    expect(text).toContain('http://localhost:5183');
    expect(text).toContain('http://192.168.1.9:5183');
  });

  it('says nothing about ports when the requested one was used', () => {
    expect(banner(base).join('\n')).not.toContain('was busy');
  });

  it('drops the LAN line when there is no LAN address', () => {
    expect(banner({ ...base, lan: null }).join('\n')).not.toContain('Same Wi-Fi');
  });
});

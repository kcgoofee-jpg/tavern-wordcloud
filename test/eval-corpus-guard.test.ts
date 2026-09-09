/**
 * `npm run eval` (tools/eval/cli.ts) used to call corpusSentences(), get an empty array back
 * because WC_LOCAL_CORPUS pointed at directories that no longer exist (the 2026-09-08
 * decommission), and still print a table and exit 0 — 0/108 read as a clean pass to anything
 * that only checks the exit code, silently defeating AGENTS hard rule 3 ("改分词先跑 eval，
 * 基线 108/108"). This asserts the fixed behaviour: a clear one-line reason on stderr and
 * exit code 2, distinguishable from both a real pass (0) and a real assertion failure (1).
 *
 * Runs cli.ts as an actual child process the way `npm run eval` does, with WC_LOCAL_CORPUS
 * pointed at a directory that is guaranteed not to exist, so this is independent of whatever
 * is or isn't configured on the machine running the test.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();

describe('eval corpus guard', () => {
  it('cli.ts exits 2 with a one-line reason when WC_LOCAL_CORPUS points nowhere', () => {
    const r = spawnSync('npx', ['vite-node', 'tools/eval/cli.ts'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, WC_LOCAL_CORPUS: '/nonexistent-wc-corpus-root-does-not-exist' },
    });

    expect(r.status, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`).toBe(2);
    expect(r.stderr).toContain('WC_LOCAL_CORPUS');
    expect(r.stderr).toContain('不存在');
    // The message names the directory by basename only, never the full path (privacy: a
    // full path on this machine carries the OS user name).
    expect(r.stderr).not.toContain('/nonexistent-wc-corpus-root-does-not-exist');
    expect(r.stderr).toContain('nonexistent-wc-corpus-root-does-not-exist');
  });
});

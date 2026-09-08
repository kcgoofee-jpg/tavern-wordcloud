/**
 * No merge-conflict markers may reach the repository. One merge this week resolved two of
 * three conflicted files and committed the third with its `<<<<<<<` block intact; the
 * failure was discovered by `tsc` on the next run, not by the person committing (2026-09-08).
 * The scan uses the same file walk as no-nul.test.ts: every text file git tracks.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const TEXT = /\.(ts|tsx|mjs|js|css|md|json|yml|yaml|html|txt|svg|sh|ps1)$/;
const MARK = /^(<{7}|={7}|>{7})( |$)/m;

describe('merge-conflict markers', () => {
  it('appear in no tracked text file', () => {
    const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter((f) => TEXT.test(f));
    const hits: string[] = [];
    for (const f of files) {
      if (f.endsWith('no-conflict-markers.test.ts')) continue;
      let s: string;
      try { s = fs.readFileSync(f, 'utf8'); } catch { continue; }
      const m = MARK.exec(s);
      if (m) hits.push(`${f}:${s.slice(0, m.index).split('\n').length}`);
    }
    expect(hits, 'files carrying <<<<<<< / ======= / >>>>>>> at line start').toEqual([]);
  });
});

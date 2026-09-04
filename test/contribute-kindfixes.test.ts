/**
 * F13: `kindFixes` (words the visitor manually re-filed in the Review / Word-table panel,
 * sent as `{ w, from, to }` only — no context) rides inside the same `/api/contribute`
 * request the community-stats feature already sends, gated by `settings.contribute`.
 * There is no separate switch for it, so the only thing worth pinning is that its
 * construction lives *inside* that gate — not a second effect that could fire on its own.
 * Same source-inspection style as test/costly-actions.test.ts: mounting the full app just
 * to watch a fetch not happen would be far more code for the same guarantee.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const app = fs.readFileSync(path.join(ROOT, 'src/ui/App.tsx'), 'utf8');

describe('kindFixes is gated by the same contribute switch as the rest of the contribution', () => {
  const start = app.indexOf('const contributedFor = useRef');
  const end = app.indexOf("void fetch('/api/contribute'", start);
  const effect = app.slice(start, end);

  it('the effect bails out before building the body when contribute is off', () => {
    expect(effect).toMatch(/if \(!settings\.contribute[^)]*\)\s*return;/);
  });

  it('kindFixes is computed after that check, not in a separate effect', () => {
    const gateAt = effect.search(/if \(!settings\.contribute[^)]*\)\s*return;/);
    const kindFixesAt = effect.indexOf('kindFixes:');
    expect(gateAt).toBeGreaterThan(-1);
    expect(kindFixesAt).toBeGreaterThan(gateAt);
  });

  it('only the word and the two kind ids are sent, never context', () => {
    const at = effect.indexOf('kindFixes:');
    const snippet = effect.slice(at, effect.indexOf('}).slice(0, 50)', at) + 20);
    expect(snippet).toContain('w: orig?.text ?? word');
    expect(snippet).toMatch(/from(,|:)/);
    expect(snippet).toMatch(/to: ov\.kind/);
    // Capped the same way the server also caps it (server/index.ts KIND_FIXES_MAX)
    expect(snippet).toMatch(/\.slice\(0, 50\)/);
  });
});

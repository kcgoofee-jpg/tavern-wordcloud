/**
 * Progress values, not rendering. Stages that cannot report progress must send
 * an indeterminate signal (total: 0) rather than a static denominator.
 */
import { describe, expect, it } from 'vitest';
import { readDataBundle } from '../src/core/bundle';
import { zipSync, strToU8 } from 'fflate';

type P = { phase: string; done: number; total: number; label: string };

/** Minimal SillyTavern full export */
function makeZip() {
  return zipSync({
    'default-user/chats/角色卡/聊天 - 2026-01-01@00h00m00s000ms.jsonl': strToU8(
      [JSON.stringify({ user_name: 'u', character_name: 'c' }),
        JSON.stringify({ name: 'u', is_user: true, mes: '通告单递给制片主任。' })].join('\n'),
    ),
  });
}

describe('progress reporting', () => {
  const seen: P[] = [];
  readDataBundle(makeZip(), (p) => seen.push(p as P));

  it('unzip sends an indeterminate signal', () => {
    const unzip = seen.filter((p) => p.phase === 'unzip');
    expect(unzip.length).toBeGreaterThan(0);
    // total > 0 would render as 0% for the whole unzip
    for (const p of unzip) expect(p.total).toBe(0);
  });

  it('stages with known totals report them', () => {
    const counted = seen.filter((p) => p.phase === 'read' || p.phase === 'scan');
    expect(counted.length).toBeGreaterThan(0);
    for (const p of counted) expect(p.total).toBeGreaterThan(0);
  });

  it('every report has readable text', () => {
    for (const p of seen) expect(p.label.length).toBeGreaterThan(0);
  });
});

describe('determinate vs indeterminate progress', () => {
  // Same criterion as Progress.tsx
  const known = (done?: number, total?: number) =>
    typeof done === 'number' && typeof total === 'number' && total > 0;

  it.each([
    [0, 0, false],      // Unknown total -> spinner
    [undefined, undefined, false],
    [0, 5, true],       // Known total -> arc, even at 0
    [3, 5, true],
  ])('done=%s total=%s → 定量=%s', (d, t, want) => {
    expect(known(d as number, t as number)).toBe(want);
  });
});


/** Stream-only events must not reset the numbers (the cause of a flickering ring). Mirrors the merge logic in the app. */
type Prog = { phase: string; done: number; total: number; label: string; detail?: string; stream?: string };

function merger() {
  let cur: Prog | null = null;
  return {
    apply(p: Partial<Prog> & { phase: string }) {
      const prev = cur;
      const same = prev?.phase === p.phase;
      cur = {
        phase: p.phase,
        done: p.done ?? (same ? prev?.done ?? 0 : 0),
        total: p.total ?? (same ? prev?.total ?? 0 : 0),
        label: p.label ?? (same ? prev?.label ?? '' : ''),
        detail: p.detail ?? (same ? prev?.detail : undefined),
        stream: p.stream ?? prev?.stream,
      };
      return cur;
    },
  };
}

describe('stream events do not reset progress', () => {
  it('missing fields keep their previous values within a phase', () => {
    const m = merger();
    m.apply({ phase: 'curate', done: 23, total: 40, label: '正在挑词', detail: '已用 5 秒' });
    const after = m.apply({ phase: 'curate', stream: '苏念安' });   // Stream only
    expect(after.done).toBe(23);
    expect(after.total).toBe(40);
    expect(after.label).toBe('正在挑词');
    expect(after.detail).toBe('已用 5 秒');
    expect(after.stream).toBe('苏念安');
  });

  it('a new phase resets the counts', () => {
    const m = merger();
    m.apply({ phase: 'parse', done: 9, total: 9, label: '解析完', detail: '已用 1 秒' });
    const after = m.apply({ phase: 'curate', label: '开始挑词' });
    expect(after.done).toBe(0);
    expect(after.total).toBe(0);
    expect(after.detail).toBeUndefined();
  });
});


/**
 * What a queued visitor is shown.
 *
 * Before the server sent `event: queued`, the browser had nothing to go on between the end
 * of the upload and the start of the analysis, so it said "the server received it, parsing
 * now" and let the ring creep — for up to 17.5 s of pure waiting (notes/docs/37 §2). Two
 * things have to hold now: the ring must sit still while nothing is happening, and the label
 * must carry the real position.
 */
import { describe, expect, it } from 'vitest';
import { PHASE_BANDS, phaseFraction, isPhase } from '../../src/ui/hooks/progressModel';
import { translate } from '../../src/ui/i18n';

describe('the queued phase parks the ring instead of creeping', () => {
  it('is a real phase with a zero-width band at the top of upload', () => {
    expect(isPhase('queued')).toBe(true);
    // Sitting exactly where the upload finished: no jump forward, no jump back.
    expect(PHASE_BANDS.queued[0]).toBe(PHASE_BANDS.upload[1]);
    expect(PHASE_BANDS.queued[1]).toBe(PHASE_BANDS.upload[1]);
    expect(PHASE_BANDS.parse[0]).toBe(PHASE_BANDS.queued[1]);
  });

  it('does not advance however long the wait lasts', () => {
    const at = (ms: number) => phaseFraction('queued', 0, 1, ms);
    expect(at(0)).toBeCloseTo(0.2, 6);
    expect(at(5_000)).toBeCloseTo(0.2, 6);
    // Longer than the indeterminate ramp any other phase would have used by now
    expect(at(60_000)).toBeCloseTo(0.2, 6);
  });

  it('never reads as further along than the parsing that follows it', () => {
    expect(phaseFraction('queued', 0, 1, 60_000)).toBeLessThanOrEqual(phaseFraction('parse', 0, 1, 0));
  });
});

describe('the queue label says the position, in both languages', () => {
  it('names the number of people ahead', () => {
    expect(translate('zh', '前面还有 {n} 人在排队', { n: 3 })).toBe('前面还有 3 人在排队');
    expect(translate('en', '前面还有 {n} 人在排队', { n: 3 })).toBe('3 ahead of you in the queue');
  });

  it('offers the local edition, which never queues', () => {
    expect(translate('zh', '本地版不用排队，下载后在自己电脑上算')).toContain('本地版');
    expect(translate('en', '本地版不用排队，下载后在自己电脑上算')).toMatch(/local edition/i);
  });

  it('has a plain fallback for the phase itself', () => {
    expect(translate('en', '正在排队')).toBe('Waiting in the queue');
  });
});

// @vitest-environment happy-dom
/** Community board: chart axes and the one key number under each chart. */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CommunityPanel, type CommunityStats } from '../../src/ui/panels';

afterEach(cleanup);

/** 30 days of views; the last day is today. Hours peak at 21:00. */
const STATS: CommunityStats = {
  contributors: 7, contributions: 12, messages: 900, chars: 123456,
  views30d: 300, analyses30d: 40, minContributors: 3,
  words: [{ text: '西德妮', count: 9, people: 4 }],
  trend: Array.from({ length: 30 }, (_, i) => ({
    day: `2026-08-${String(i + 1).padStart(2, '0')}`,
    contributions: 0, analyses: 0, views: i === 29 ? 40 : 10,
  })),
  // 100 samples total; 21:00 holds 50 of them.
  hours: Array.from({ length: 24 }, (_, h) => (h === 21 ? 50 : h < 10 ? 5 : 0)),
  sizes: [{ label: '<1万', n: 2 }, { label: '1-5万', n: 8 }, { label: '>5万', n: 2 }],
  zhRatio: 0.8, updated: 0,
};

const view = (s: CommunityStats = STATS) =>
  render(<CommunityPanel stats={s} contribute={false} setContribute={() => {}} loading={false} offline={false} />);

describe('CommunityPanel charts', () => {
  it('every chart carries a y axis with the max and 0 ticks', () => {
    const { container } = view();
    const charts = container.querySelectorAll('svg.mini-bars');
    expect(charts.length).toBe(3);
    for (const svg of charts) {
      const texts = [...svg.querySelectorAll('text')].map((n) => n.textContent);
      expect(texts).toContain('0');
    }
    // Views trend: max is today's 40.
    const trendTexts = [...charts[0].querySelectorAll('text')].map((n) => n.textContent);
    expect(trendTexts).toContain('40');
  });

  it('the 30-day trend labels the first, middle and last date', () => {
    const { container } = view();
    const texts = [...container.querySelectorAll('svg.mini-bars')[0].querySelectorAll('text')]
      .map((n) => n.textContent);
    expect(texts).toContain('08-01');
    expect(texts).toContain('08-15');
    expect(texts).toContain('08-30');
  });

  it('the hour chart labels 0/6/12/18 and nothing else', () => {
    const { container } = view();
    const svg = container.querySelectorAll('svg.mini-bars')[2];
    const texts = [...svg.querySelectorAll('text')].map((n) => n.textContent);
    for (const h of ['0', '6', '12', '18']) expect(texts).toContain(h);
    expect(texts).not.toContain('7');
    expect(texts).not.toContain('21');
  });

  it('each section states a key number', () => {
    view();
    // Trend: today 40, daily average (29*10 + 40) / 30 = 11.
    expect(screen.getByText('今日 40 次 · 日均 11 次')).toBeTruthy();
    // Hours: 21:00 holds 50 of 100 samples.
    expect(screen.getByText('21 点最热闹，占全天 50%')).toBeTruthy();
    // Sizes: the median of 12 contributions falls in the middle bucket.
    expect(screen.getByText('中位数落在 1-5万')).toBeTruthy();
  });

  it('with no data the hour and size lines say so instead of showing NaN', () => {
    view({ ...STATS, hours: new Array(24).fill(0), sizes: [{ label: '<1万', n: 0 }] });
    expect(screen.getAllByText('还没有数据').length).toBeGreaterThanOrEqual(2);
  });
});

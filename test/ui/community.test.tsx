// @vitest-environment happy-dom
/** Community board: chart axes and the one key number under each chart. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommunityPanel, type CommunityStats } from '../../src/ui/panels';
import { setCurrentLang } from '../../src/ui/i18n';

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
  zhRatio: 0.8,
  models: [
    { name: 'gemini-2.5-pro', n: 6, share: 0.5, low: 0.25, high: 0.75 },
    { name: '其他', n: 6, share: 0.5, low: 0.25, high: 0.75 },
  ],
  endpoints: [{ name: 'relay', n: 12, share: 1, low: 0.76, high: 1 }],
  kinds: [{ kind: 'person', words: 5, share: 0.5 }, { kind: 'plain', words: 5, share: 0.5 }],
  genMs: 4200,
  updated: 0,
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

describe('CommunityPanel model board', () => {
  it('ranks models with share, count and the confidence interval', () => {
    const { container } = view();
    expect(screen.getByText('模型榜')).toBeTruthy();
    const rows = container.querySelectorAll('.board-row');
    expect(rows.length).toBe(3);   // two models + one endpoint row
    expect(rows[0].textContent).toContain('gemini-2.5-pro');
    expect(rows[0].textContent).toContain('50%');
    expect(rows[0].textContent).toContain('6 份');
    expect(rows[0].textContent).toContain('95% 25–75%');
    // Bars are scaled to the leader
    expect((rows[0].querySelector('.board-bar i') as HTMLElement).style.width).toBe('100%');
    expect(screen.getByText('生成耗时中位数 4.2 秒')).toBeTruthy();
  });

  it('says why nothing is named when no model clears the minimum', () => {
    view({ ...STATS, models: [] });
    expect(screen.getByText(/一个模型要有至少 3 个不同的人用过/)).toBeTruthy();
  });

  it('shows the endpoint class and the word-kind split, folding the rest into 其他', () => {
    view();
    expect(screen.getByText('第三方中转')).toBeTruthy();
    expect(screen.getByText('人物')).toBeTruthy();
    // plain is not a public kind; it lands in the catch-all row (as does the merged model row)
    expect(screen.getAllByText('其他').length).toBe(2);
  });
});

describe('CommunityPanel author claim', () => {
  beforeEach(() => { sessionStorage.clear(); });
  afterEach(() => { vi.restoreAllMocks(); });

  const open = () => {
    view();
    fireEvent.click(screen.getByText('认领我的角色卡'));
  };

  it('hands out a 16-hex challenge string and keeps it in sessionStorage', () => {
    open();
    const tok = (screen.getByLabelText('校验串') as HTMLInputElement).value;
    expect(tok).toMatch(/^[0-9a-f]{16}$/);
    expect(sessionStorage.getItem('wc-claim-token')).toBe(tok);
  });

  it('offers a copy button for the challenge string', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    open();
    const tok = (screen.getByLabelText('校验串') as HTMLInputElement).value;
    const copy = screen.getByTitle('复制');
    fireEvent.click(copy);
    await waitFor(() => expect(screen.getByText('已复制')).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith(tok);
  });

  it('shows the payload first and only sends after confirmation', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal('fetch', fetchMock);
    open();
    fireEvent.change(screen.getByLabelText('卡名'), { target: { value: '小红' } });
    fireEvent.change(screen.getByLabelText('公开链接'), { target: { value: 'https://example.com/card' } });
    fireEvent.click(screen.getByText('提交认领'));
    // Nothing has been sent yet; the three items are shown for review
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText('将发送这三项，别的什么都不发：')).toBeTruthy();
    fireEvent.click(screen.getByText('发送'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/claim');
    const body = JSON.parse(String(init.body)) as Record<string, string>;
    expect(Object.keys(body).sort()).toEqual(['card', 'token', 'url']);   // no identity fields
    expect(body.card).toBe('小红');
    await waitFor(() => expect(screen.getByText('已收到，站长核对后加入榜单')).toBeTruthy());
  });

  it('words a rejection through the shared error classifier', async () => {
    // txv() reads the module-level language (useSettings syncs it in the app), not the context.
    setCurrentLang('zh');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, json: () => Promise.resolve({ code: 'claim_bad_url', error: '链接要是完整的 https 网址' }),
    } as unknown as Response));
    open();
    fireEvent.change(screen.getByLabelText('卡名'), { target: { value: '小红' } });
    fireEvent.change(screen.getByLabelText('公开链接'), { target: { value: 'https://example.com/card' } });
    fireEvent.click(screen.getByText('提交认领'));
    fireEvent.click(screen.getByText('发送'));
    await waitFor(() => expect(screen.getByText('链接要是完整的 https 网址')).toBeTruthy());
  });
});

describe('CommunityPanel claimed cards', () => {
  it('is not rendered at all when no card has been claimed', () => {
    view();
    expect(screen.queryByText('已认领的角色卡')).toBeNull();
    view({ ...STATS, claimedCards: [] });
    expect(screen.queryByText('已认领的角色卡')).toBeNull();
  });

  it('lists the names only — no link, no submitter', () => {
    const { container } = view({ ...STATS, claimedCards: ['排练厅的下午', '雨夜咖啡店'] });
    expect(screen.getByText('已认领的角色卡')).toBeTruthy();
    const items = [...container.querySelectorAll('.claimed-cards li')].map((n) => n.textContent);
    expect(items).toEqual(['排练厅的下午', '雨夜咖啡店']);
    expect(container.querySelector('.claimed-cards a')).toBeNull();
  });
});

describe('CommunityPanel import composition', () => {
  it('renders nothing when the operator has not published the numbers', () => {
    view();
    expect(screen.queryByText('大家导入了什么')).toBeNull();
  });

  it('shows the shares and averages, with no card, preset or world-info name', () => {
    view({ ...STATS, cardStats: { reports: 20, withCards: 0.6, withWorlds: 0.25, withPreset: 0.5, avgCards: 1.5, avgWorlds: 0.4 } });
    expect(screen.getByText('大家导入了什么')).toBeTruthy();
    expect(screen.getByText('带角色卡')).toBeTruthy();
    expect(screen.getByText('带世界书')).toBeTruthy();
    expect(screen.getByText('带预设')).toBeTruthy();
    expect(screen.getByText('60%')).toBeTruthy();
    expect(screen.getByText('只统计数量，不记录任何卡名、预设名或世界书名。共 20 份。')).toBeTruthy();
    expect(screen.getByText('平均每份 1.5 张卡 · 0.4 本世界书')).toBeTruthy();
  });
});

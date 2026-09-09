// @vitest-environment happy-dom
/** Community board: chart axes and the one key number under each chart. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommunityPanel, type CommunityStats } from '../../src/ui/panels';

/** Only the button-cycle describe below mounts the whole App; the panel describes do not. */
class StubWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  postMessage() {}
  terminate() {}
  addEventListener() {}
  removeEventListener() {}
}
vi.mock('../../src/worker/analyze.worker?worker&inline', () => ({ default: StubWorker }));
if (!('ResizeObserver' in globalThis)) {
  class RO { observe() {} unobserve() {} disconnect() {} }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO;
}

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

  it('folds org and document into 文书与组织', () => {
    view({
      ...STATS,
      kinds: [
        { kind: 'person', words: 2, share: 0.2 },
        { kind: 'org', words: 3, share: 0.3 },
        { kind: 'document', words: 1, share: 0.05 },
        { kind: 'plain', words: 4, share: 0.45 },
      ],
    });
    const row = screen.getByText('文书与组织').closest('li');
    expect(row?.textContent).toContain('35%');
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

/**
 * The community button's three-state cycle (useOverlay.cycleCommunity, AGENTS.md): off →
 * leaderboard page → aggregate cloud only → off. Asserted through `aria-pressed` and `role`
 * rather than the page shell's class name, which differs between branches mid-refactor
 * (`.community-page` here, `.sheet.page.community` on main) — the state machine itself is
 * covered exhaustively in `test/ui/hooks.test.tsx`; this pins that the real button in App.tsx
 * is wired to it and that each state shows the content a visitor would actually see.
 */
describe('the community button cycles through three states', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

  const open = async () => {
    // `detectLang()` reads `navigator.language` once at module load, before a test can
    // override it, so the saved settings are the reliable way to force Chinese here.
    localStorage.setItem('tw-settings', JSON.stringify({ lang: 'zh' }));
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))));
    const { default: App } = await import('../../src/ui/App');
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector('.community-quick')).toBeTruthy());
    return container;
  };

  it('off: not pressed, no board, no aggregate-cloud hint', async () => {
    const container = await open();
    const button = container.querySelector('.community-quick')!;
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('dialog', { name: '社区排行榜' })).toBeNull();
    expect(screen.queryByText('社区词云 · 点这里回到自己的词云')).toBeNull();
  });

  it('first click: pressed, the leaderboard page opens as a dialog', async () => {
    const container = await open();
    const button = container.querySelector('.community-quick')!;
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('dialog', { name: '社区排行榜' })).toBeTruthy());
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText('社区词云 · 点这里回到自己的词云')).toBeNull();
  });

  it('second click: still pressed, the board closes and only the aggregate cloud remains', async () => {
    const container = await open();
    const button = container.querySelector('.community-quick')!;
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('dialog', { name: '社区排行榜' })).toBeTruthy());
    fireEvent.click(button);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '社区排行榜' })).toBeNull());
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('社区词云 · 点这里回到自己的词云')).toBeTruthy();
  });

  it('third click: back to off, neither the board nor the aggregate-cloud hint remain', async () => {
    const container = await open();
    fireEvent.click(container.querySelector('.community-quick')!);
    await waitFor(() => expect(screen.getByRole('dialog', { name: '社区排行榜' })).toBeTruthy());
    fireEvent.click(container.querySelector('.community-quick')!);
    // Entering the aggregate-cloud-only state drops `sampleOpen`, which brings the landing
    // view's own top bar back and replaces the quick-cluster's community button with the
    // canvas hint — that hint is the third click's real target (cycleCommunity is wired to
    // both), not the original button, which is no longer in the DOM.
    await waitFor(() => expect(screen.getByText('社区词云 · 点这里回到自己的词云')).toBeTruthy());
    expect(container.querySelector('.community-quick')).toBeNull();
    fireEvent.click(screen.getByText('社区词云 · 点这里回到自己的词云'));
    await waitFor(() => expect(screen.queryByText('社区词云 · 点这里回到自己的词云')).toBeNull());
    expect(screen.queryByRole('dialog', { name: '社区排行榜' })).toBeNull();
    await waitFor(() => expect(container.querySelector('.community-quick')?.getAttribute('aria-pressed')).toBe('false'));
  });
});

/**
 * The shell the board lives in (plan B3, 2026-09-08). It used to be `.community-page`, a third
 * kind of layer with its own head and body; it is now a `.sheet.page` with the same
 * `.sheet-bar` / `.sheet-body` as every other panel, which is what the outside-click list, the
 * focus shell, the focus-ring reset and four selectors in tools/shot.mjs all key off.
 */
describe('the community board is a sheet', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

  const open = async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))));
    const { default: App } = await import('../../src/ui/App');
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector('.community-quick')).toBeTruthy());
    fireEvent.click(container.querySelector('.community-quick')!);
    return container;
  };

  it('opens as .sheet.page.community, with a sheet bar and a sheet body', async () => {
    const container = await open();
    await waitFor(() => expect(document.querySelector('.sheet.page.community')).toBeTruthy());
    const board = document.querySelector('.sheet.page.community')!;
    expect(board.querySelector('.sheet-bar')).toBeTruthy();
    expect(board.querySelector('.sheet-body')).toBeTruthy();
    // The audit's 孤儿 check: a sheet's children are its bar and its body, nothing else.
    expect([...board.children].every((el) => el.classList.contains('sheet-bar') || el.classList.contains('sheet-body'))).toBe(true);
    expect(board.getAttribute('role')).toBe('dialog');
    expect(container.querySelector('.community-page')).toBeNull();
  });

  it('leaves no .community-page anywhere, opened or closed', async () => {
    const container = await open();
    await waitFor(() => expect(document.querySelector('.sheet.page.community')).toBeTruthy());
    expect(document.querySelectorAll('.community-page, .community-head, .community-body').length).toBe(0);
    // Second press of the three-state cycle: the board closes, the aggregate cloud stays.
    fireEvent.click(container.querySelector('.community-quick')!);
    await waitFor(() => expect(document.querySelector('.sheet.page.community')).toBeNull());
    expect(document.querySelectorAll('.community-page').length).toBe(0);
  });

  it('the close button in its bar shuts the board', async () => {
    const container = await open();
    await waitFor(() => expect(document.querySelector('.sheet.page.community')).toBeTruthy());
    fireEvent.click(document.querySelector('.sheet.page.community .sheet-bar .sheet-close')!);
    await waitFor(() => expect(document.querySelector('.sheet.page.community')).toBeNull());
    expect(container.querySelector('.sheet')).toBeNull();
  });
});

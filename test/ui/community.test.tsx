// @vitest-environment happy-dom
/** Community board: chart axes and the one key number under each chart. */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setCurrentLang } from '../../src/ui/i18n';
import { CommunityPanel, type CommunityStats } from '../../src/ui/panels';

// `tx()` (the fine-kind labels, via ENTITY_LABEL) reads a module-level language, not
// LangContext; happy-dom's navigator would otherwise make it English (test/ui/review.test.tsx).
setCurrentLang('zh');

/** Only the button-cycle / integration describes below mount the whole App; the panel describes do not. */
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

/** 30 days of views; the last day is today. */
const STATS: CommunityStats = {
  contributors: 7, contributions: 12, messages: 900, chars: 123456,
  views30d: 300, analyses30d: 40, minContributors: 3,
  words: [{ text: '西德妮', count: 9, people: 4 }],
  trend: Array.from({ length: 30 }, (_, i) => ({
    day: `2026-08-${String(i + 1).padStart(2, '0')}`,
    contributions: 0, analyses: 0, views: i === 29 ? 40 : 10,
  })),
  // 12 contributions: 2 under 50 turns, 8 in 50-200, 2 in 200-500 — median falls in the middle bucket.
  turns: [{ label: '<50', n: 2 }, { label: '50-200', n: 8 }, { label: '200-500', n: 2 }],
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

const view = (s: CommunityStats = STATS, onExpandCloud: () => void = () => {}) =>
  render(<CommunityPanel stats={s} contribute={false} setContribute={() => {}} loading={false} offline={false} onExpandCloud={onExpandCloud} />);

describe('CommunityPanel charts', () => {
  it('every chart carries a y axis with the max and 0 ticks', () => {
    const { container } = view();
    // Views trend + turn-count distribution; hours was removed (2026-09-11 redesign).
    const charts = container.querySelectorAll('svg.mini-bars');
    expect(charts.length).toBe(2);
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

  it('each section states a key number', () => {
    view();
    // Trend: today 40, daily average (29*10 + 40) / 30 = 11.
    expect(screen.getByText('今日 40 次 · 日均 11 次')).toBeTruthy();
    // Turns: the median of 12 contributions falls in the middle bucket.
    expect(screen.getByText('中位数落在 50-200 层')).toBeTruthy();
  });

  it('with no data the turn-count line says so instead of showing NaN', () => {
    view({ ...STATS, turns: [{ label: '<50', n: 0 }] });
    expect(screen.getByText('还没有数据')).toBeTruthy();
  });
});

describe('CommunityPanel model board', () => {
  it('ranks models with share, count and the confidence interval', () => {
    const { container } = view();
    expect(screen.getByText('模型榜')).toBeTruthy();
    // 接口类型 was removed (2026-09-11): only the model board renders `.board-row`s now.
    const rows = container.querySelectorAll('.board-row');
    expect(rows.length).toBe(2);
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
});

describe('CommunityPanel removed sections', () => {
  it('no longer shows 接口类型 or 什么时候有人在用', () => {
    view();
    expect(screen.queryByText('接口类型')).toBeNull();
    expect(screen.queryByText('什么时候有人在用')).toBeNull();
    expect(screen.queryByText('第三方中转')).toBeNull();
  });
});

describe('CommunityPanel 词都是些什么: fine kinds, not the five-bucket filter scheme', () => {
  it('names each fine kind by its own label and folds "plain" into 其他 regardless of its rank', () => {
    view({
      ...STATS,
      kinds: [
        { kind: 'person', words: 30, share: 0.30 },
        { kind: 'place', words: 20, share: 0.20 },
        { kind: 'org', words: 15, share: 0.15 },
        { kind: 'document', words: 10, share: 0.10 },
        // The highest share of all, but `plain` (ENTITY_LABEL: 其他) still folds into the
        // catch-all tail rather than becoming a normal named row that also reads "其他".
        { kind: 'plain', words: 25, share: 0.25 },
      ],
    });
    const section = screen.getByText('词都是些什么').closest('section')!;
    expect(within(section).getByText('人物')).toBeTruthy();
    expect(within(section).getByText('地点')).toBeTruthy();
    expect(within(section).getByText('机构')).toBeTruthy();
    expect(within(section).getByText('文书')).toBeTruthy();
    // The models board also has a raw (untranslated) "其他" catch-all row elsewhere on the
    // page — scope to this section so the two do not collide.
    const other = within(section).getByText('其他').closest('li');
    expect(other?.textContent).toContain('25%');
  });

  it('shows at most the top 8 named kinds and sums the tail into one 其他 row', () => {
    view({
      ...STATS,
      kinds: [
        { kind: 'person', words: 30, share: 0.30 },
        { kind: 'place', words: 15, share: 0.15 },
        { kind: 'time', words: 12, share: 0.12 },
        { kind: 'org', words: 10, share: 0.10 },
        { kind: 'document', words: 8, share: 0.08 },
        { kind: 'money', words: 7, share: 0.07 },
        { kind: 'festival', words: 6, share: 0.06 },
        { kind: 'building', words: 5, share: 0.05 },
        // Past the top 8: folded into 其他 together, not shown by name.
        { kind: 'room', words: 4, share: 0.04 },
        { kind: 'path', words: 3, share: 0.03 },
      ],
    });
    const section = screen.getByText('词都是些什么').closest('section')!;
    const rows = section.querySelectorAll('.found li');
    expect(rows.length).toBe(9); // 8 named + 1 folded tail
    expect(within(section).queryByText('室内空间')).toBeNull();
    expect(within(section).queryByText('道路与交通设施')).toBeNull();
    const other = within(section).getByText('其他').closest('li');
    expect(other?.textContent).toContain('7.0%'); // 0.04 + 0.03; pct() keeps one decimal below 10%
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

/** The new top-to-bottom order (2026-09-11 redesign), read straight off the DOM. */
describe('CommunityPanel section order', () => {
  it('lists 这30天 / 总词云 / 模型榜 / 大家导入了什么 / 词都是些什么 / 大家聊了多少层 / 我的参与 in that order', () => {
    const { container } = view({ ...STATS, cardStats: { reports: 1, withCards: 0, withWorlds: 0, withPreset: 0, avgCards: 0, avgWorlds: 0 } });
    const labels = [...container.querySelectorAll('.group-label')].map((n) => n.textContent);
    expect(labels).toEqual(['这 30 天', '总词云', '模型榜', '大家导入了什么', '词都是些什么', '大家聊了多少层', '我的参与']);
  });

  it('every section is stacked full width, one per row (no side-by-side pairing)', () => {
    const { container } = view();
    for (const sec of container.querySelectorAll('.community-sec')) {
      expect(sec.className).not.toContain('community-sec-wide');
    }
  });
});

describe('CommunityPanel 总词云: collapses to a card that expands the aggregate cloud', () => {
  it('is a click target that calls onExpandCloud when there is a cloud to show', () => {
    const onExpandCloud = vi.fn();
    view(STATS, onExpandCloud);
    const card = screen.getByText('点开看整张词云').closest('button')!;
    expect(card).toBeTruthy();
    fireEvent.click(card);
    expect(onExpandCloud).toHaveBeenCalledTimes(1);
  });

  it('offers no click target when there are no words yet', () => {
    const onExpandCloud = vi.fn();
    view({ ...STATS, words: [] }, onExpandCloud);
    // Same empty-state copy as before; not a button, so nothing to click.
    expect(screen.getByText(/一个词要有至少 3 个不同的人都用过才会出现/)).toBeTruthy();
    expect(screen.queryByText('点开看整张词云')).toBeNull();
    expect(document.querySelector('.community-cloud-card')).toBeNull();
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
    // `showLanding` now excludes `communityCloud` (2026-09-11 fix — it used to omit this and
    // the Landing hero would silently cover the aggregate cloud for anyone with no file
    // imported yet), so the main toolbar — and the community-quick button on it — stays
    // mounted the whole time; the canvas hint is an additional click target, not a replacement.
    await waitFor(() => expect(screen.getByText('社区词云 · 点这里回到自己的词云')).toBeTruthy());
    expect(screen.queryByText('把酒馆的聊天记录，变成一张词云')).toBeNull();
    const button = container.querySelector('.community-quick')!;
    expect(button).toBeTruthy();
    expect(button.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByText('社区词云 · 点这里回到自己的词云'));
    await waitFor(() => expect(screen.queryByText('社区词云 · 点这里回到自己的词云')).toBeNull());
    expect(screen.queryByRole('dialog', { name: '社区排行榜' })).toBeNull();
    await waitFor(() => expect(container.querySelector('.community-quick')?.getAttribute('aria-pressed')).toBe('false'));
  });
});

/**
 * The compact 总词云 card is a second entry point into the exact same aggregate-cloud state
 * the top button's second click reaches (useOverlay.cycleCommunity) — not a separate overlay.
 * This drives the whole pipeline for real: a successful health check and a `/api/community`
 * response with words, opened through the button, then expanded through the card.
 */
describe('the 总词云 card reaches the same fullscreen aggregate cloud as the button cycle', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

  it('closes the leaderboard dialog and shows the canvas hint when clicked', async () => {
    localStorage.setItem('tw-settings', JSON.stringify({ lang: 'zh' }));
    vi.stubGlobal('fetch', vi.fn((input: unknown) => {
      const url = String(input);
      if (url === '/api/health') return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) } as Response);
      if (url === '/api/community') return Promise.resolve({ ok: true, json: () => Promise.resolve(STATS) } as Response);
      return Promise.reject(new TypeError('offline'));
    }));
    const { default: App } = await import('../../src/ui/App');
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector('.community-quick')).toBeTruthy());
    fireEvent.click(container.querySelector('.community-quick')!);
    const card = await screen.findByText('点开看整张词云');
    fireEvent.click(card.closest('button')!);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '社区排行榜' })).toBeNull());
    expect(screen.getByText('社区词云 · 点这里回到自己的词云')).toBeTruthy();
    // Regression guard: on a fresh visit (no file ever imported), `showLanding` used to stay
    // true through this whole flow and the Landing hero silently covered the cloud (2026-09-11).
    expect(screen.queryByText('把酒馆的聊天记录，变成一张词云')).toBeNull();
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

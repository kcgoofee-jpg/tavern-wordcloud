import { ENTITY_LABEL, type EntityKind } from '../../core/entities';
import { tenK, tx, useT } from '../i18n';

/** One leaderboard row: count, share, and the 95% Wilson bounds the server computed. */
export interface BoardRow { name: string; n: number; share: number; low: number; high: number }

export interface CommunityStats {
  contributors: number; contributions: number; messages: number; chars: number;
  views30d: number; analyses30d: number; minContributors: number;
  words: { text: string; count: number; people: number }[];
  trend: { day: string; contributions: number; analyses: number; views: number }[];
  /** Turn-count (对话楼层数) distribution, over c.messages. */
  turns: { label: string; n: number }[];
  zhRatio: number | null;
  /** Model leaderboard; only models >= minContributors people used are named. */
  models: BoardRow[];
  /**
   * Endpoint classes, same k-anonymity rule. Still computed and returned by the server (a
   * dedicated test exercises the k-anonymity gate through it), but no longer shown here —
   * `接口类型` was removed from this panel (community redesign, 2026-09-11).
   */
  endpoints: BoardRow[];
  /** Word counts per entity kind, over everyone; no k-anonymity gate (an aggregate share, not a named row). */
  kinds: { kind: string; words: number; share: number }[];
  /** Median generation time in ms, when logs carried timings. */
  genMs: number | null;
  /**
   * How much of a data export people import, as shares and averages. Present only while
   * the operator publishes it; counts only, never a card / preset / world-book name.
   */
  cardStats?: { reports: number; withCards: number; withWorlds: number; withPreset: number; avgCards: number; avgWorlds: number };
  updated: number;
}

/**
 * Inline mini bar chart with a two-tick y axis (max and 0) and an x baseline.
 * `ticks` marks which bars get an x label — sparse by design, so 30 days or a handful of
 * buckets stay readable at this size. Text is `currentColor` so both themes work.
 */
function Bars({ values, labels, ticks, color = 'var(--accent)' }: {
  values: number[]; labels?: string[]; ticks?: (string | null)[]; color?: string;
}) {
  const W = 320, H = 78;
  const L = 26, R = 4, T = 6, B = 16; // gutters: y labels left, x labels below
  const plotW = W - L - R, plotH = H - T - B;
  const max = Math.max(1, ...values);
  const bw = plotW / Math.max(1, values.length);
  const xTicks = ticks ?? (labels && labels.length <= 6 ? labels : undefined);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mini-bars" role="img" aria-label={labels ? labels.join(',') : ''}>
      {/* y axis: only the extremes are labelled; a mid gridline would crowd this size. */}
      <path d={`M${L} ${T} V${T + plotH}`} stroke="currentColor" strokeWidth=".6" opacity=".35" fill="none" />
      <text x={L - 4} y={T + 4} fontSize="8" textAnchor="end" fill="currentColor" opacity=".7">{max}</text>
      <text x={L - 4} y={T + plotH} fontSize="8" textAnchor="end" fill="currentColor" opacity=".7">0</text>
      {values.map((v, i) => {
        const h = Math.round((v / max) * plotH);
        return (
          <rect key={i} x={L + i * bw} y={T + plotH - h} width={Math.max(1, bw - 1.5)} height={h} rx="1.5" fill={color}>
            <title>{(labels?.[i] ?? i) + '：' + v}</title>
          </rect>
        );
      })}
      {/* x baseline plus its ticks */}
      <path d={`M${L} ${T + plotH} H${W - R}`} stroke="currentColor" strokeWidth=".6" opacity=".35" fill="none" />
      {xTicks?.map((l, i) => {
        if (l === null || l === undefined) return null;
        const x = L + (i + 0.5) * bw;
        // Anchor the outermost labels inward, or a wide one (a date) is clipped by the viewBox.
        const anchor = x < L + 16 ? 'start' : x > W - R - 16 ? 'end' : 'middle';
        return (
          <g key={i}>
            <path d={`M${x} ${T + plotH} v3`} stroke="currentColor" strokeWidth=".6" opacity=".5" />
            <text x={x} y={H - 3} fontSize="8" textAnchor={anchor} fill="currentColor" opacity=".7">{l}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** '2026-09-04' -> '09-04'; anything else is passed through. */
const shortDay = (d: string) => (d.length >= 10 ? d.slice(5) : d);

/** First / middle / last day get a label; the rest are blank. */
function dayTicks(days: string[]): (string | null)[] {
  const n = days.length;
  if (n === 0) return [];
  const marks = new Set([0, Math.floor((n - 1) / 2), n - 1]);
  return days.map((d, i) => (marks.has(i) ? shortDay(d) : null));
}

/** The bucket label holding the median contribution, from bucket counts in order. */
function medianBucket(buckets: { label: string; n: number }[]): string | null {
  const total = buckets.reduce((s, b) => s + b.n, 0);
  if (total === 0) return null;
  let seen = 0;
  for (const b of buckets) {
    seen += b.n;
    if (seen >= total / 2) return b.label;
  }
  return buckets[buckets.length - 1]?.label ?? null;
}

/** How many fine kinds to name before folding the tail into 其他 (spec range 8–10; 8 keeps the list scannable). */
const TOP_KIND_COUNT = 8;

/**
 * Fine-kind shares for "词都是些什么": unlike the five-bucket compact filter buttons
 * (`kindBuckets.ts` — a different, deliberately coarse scheme built for a different purpose,
 * out of scope here), this shows the real per-`EntityKind` breakdown `server/admin.ts`
 * already sums with no k-anonymity gate (an aggregate share across everyone, not a named
 * leaderboard row). `plain` (ENTITY_LABEL: 其他) always folds into the tail alongside
 * anything past the top N, rather than surfacing as an ordinary named row that also reads
 * "其他" — one catch-all row, not two.
 */
function topFineKinds(kinds: { kind: string; share: number }[], topN = TOP_KIND_COUNT):
  { top: { kind: EntityKind; share: number }[]; restShare: number } {
  const plainShare = kinds.find((k) => k.kind === 'plain')?.share ?? 0;
  const named = kinds.filter((k) => k.kind !== 'plain').sort((a, b) => b.share - a.share);
  const top = named.slice(0, topN) as { kind: EntityKind; share: number }[];
  const restShare = named.slice(topN).reduce((a, k) => a + k.share, 0) + plainShare;
  return { top, restShare };
}

/** A share as a percentage; one decimal below 10% so small rows are not all "0%". */
const pct = (x: number) => (x * 100 < 10 ? (x * 100).toFixed(1) : String(Math.round(x * 100)));

/**
 * Ranked list: place, name, a bar for the share, the count, and the 95% interval in
 * grey. Bars are scaled to the leader, not to 100%, so the tail stays readable.
 */
function Board({ rows, label }: { rows: BoardRow[]; label?: (name: string) => string }) {
  const t = useT();
  const max = Math.max(1e-4, ...rows.map((r) => r.share));
  return (
    <ol className="board">
      {rows.map((r, i) => (
        <li key={r.name} className="board-row">
          <span className="board-rank">{i + 1}</span>
          <span className="board-name">{label ? label(r.name) : r.name}</span>
          <span className="board-bar"><i style={{ width: `${Math.max(2, (r.share / max) * 100)}%` }} /></span>
          <span className="board-n">{pct(r.share)}%<em>{t('{n} 份', { n: r.n })}</em></span>
          <span className="board-ci">{t('95% {a}–{b}%', { a: pct(r.low), b: pct(r.high) })}</span>
        </li>
      ))}
    </ol>
  );
}

/** Community board: aggregate cloud on the canvas; counts and trend. Words only, each shared by >= N contributors; card names are not collected. */
export function CommunityPanel({ stats, contribute, setContribute, loading, offline, onExpandCloud }: {
  stats: CommunityStats | null; contribute: boolean; setContribute: (v: boolean) => void; loading: boolean;
  /** No server in the single-file / local version. */
  offline: boolean;
  /**
   * Expand the aggregate community cloud to fill the canvas. Wired to `useOverlay.cycleCommunity`
   * at the call site: calling it while this panel is open (panel === 'community') closes the panel
   * and turns on `communityCloud`, the exact state the top-right button's second click already
   * reaches — the same overlay-mutex state and the same cloud-rendering pipeline, just a second
   * entry point into it, not a separate ad-hoc flag.
   */
  onExpandCloud: () => void;
}) {
  const t = useT();
  if (offline) return <p className="note">{t('社区排行榜只在网页版有：它要从服务器取所有人的统计。')}</p>;
  if (loading) return <p className="note">{t('正在取社区数据…')}</p>;
  if (!stats) return <p className="note">{t('社区数据暂时取不到，稍后再试。')}</p>;
  const empty = stats.words.length === 0;
  const views = stats.trend.map((d) => d.views);
  const today = views.length ? views[views.length - 1] : 0;
  const avg = views.length ? Math.round(views.reduce((a, b) => a + b, 0) / views.length) : 0;
  const median = medianBucket(stats.turns);
  // A server one deploy behind returns none of the leaderboard fields; render the rest.
  const models = stats.models ?? [];
  const { top: topKinds, restShare } = topFineKinds(stats.kinds ?? []);
  const cardStats = stats.cardStats;
  // "大家导入了什么" only exists while the operator publishes cardStats; when it does not,
  // 模型榜 pairs with nothing and renders full width instead of an empty half-row.
  const modelSection = (
    <section className="community-sec">
    <div className="group-label">{t('模型榜')}</div>
    {models.length === 0
      ? <p className="note">{t('还没有足够的人填过模型名：一个模型要有至少 {n} 个不同的人用过才会具名上榜，其余并进「其他」。', { n: stats.minContributors })}</p>
      : <>
        <Board rows={models} />
        <p className="note">{t('按贡献份数排名；括号里是 95% 置信区间（Wilson）。少于 {n} 人用过的模型并进「其他」，不具名。', { n: stats.minContributors })}</p>
        {stats.genMs != null && <p className="stat-line">{t('生成耗时中位数 {s} 秒', { s: (stats.genMs / 1000).toFixed(1) })}</p>}
      </>}
    </section>
  );
  // Every share at 0 means no contribution has carried these fields yet: three 0.0% rows
  // read as a broken panel, so say so instead (seen live 2026-09-05).
  const cardSection = cardStats ? (
    <section className="community-sec">
    <div className="group-label">{t('大家导入了什么')}</div>
    {cardStats.withCards + cardStats.withWorlds + cardStats.withPreset > 0 ? (
      <>
        <ul className="found">
          <li><b>{pct(cardStats.withCards)}%</b> {t('带角色卡')}</li>
          <li><b>{pct(cardStats.withWorlds)}%</b> {t('带世界书')}</li>
          <li><b>{pct(cardStats.withPreset)}%</b> {t('带预设')}</li>
        </ul>
        <p className="note">{t('只统计数量，不记录任何卡名、预设名或世界书名。共 {n} 份。', { n: cardStats.reports })}</p>
        <p className="stat-line">{t('平均每份 {c} 张卡 · {w} 本世界书', { c: cardStats.avgCards.toFixed(1), w: cardStats.avgWorlds.toFixed(1) })}</p>
      </>
    ) : <p className="note">{t('还没有带角色卡或世界书的记录。')}</p>}
    </section>
  ) : null;
  return (
    <>
      {empty ? (
        <p className="note community-cloud-empty">{t('画布上暂时没有词：一个词要有至少 {n} 个不同的人都用过才会出现', { n: stats.minContributors })}</p>
      ) : (
        <button type="button" className="community-cloud-link" onClick={onExpandCloud}>
          {t('查看社区词云（{n} 个词）', { n: stats.words.length })}
        </button>
      )}
      <div className="community-row">
      <section className="community-sec">
      <div className="group-label">{t('这 30 天')}</div>
      <ul className="found">
        <li><b>{stats.views30d}</b> {t('次打开')}</li>
        <li><b>{stats.analyses30d}</b> {t('次分析')}</li>
        <li><b>{stats.contributors}</b> {t('人贡献了统计')}<em>{t('共 {n} 份 · {m} 万字', { n: stats.contributions, m: tenK(stats.chars) })}</em></li>
      </ul>
      <Bars values={views} labels={stats.trend.map((d) => shortDay(d.day))} ticks={dayTicks(stats.trend.map((d) => d.day))} />
      <p className="note">{t('每天打开次数，最近 30 天')}</p>
      <p className="stat-line">{t('今日 {n} 次 · 日均 {m} 次', { n: today, m: avg })}</p>
      </section>
      <section className="community-sec">
      <div className="group-label">{t('大家聊了多少层')}</div>
      <Bars values={stats.turns.map((s) => s.n)} labels={stats.turns.map((s) => s.label)} />
      <p className="note">{t('每份聊天的对话楼层数分布。{zh}', { zh: stats.zhRatio === null ? '' : t('中文词占 {p}%', { p: Math.round(stats.zhRatio * 100) }) })}</p>
      <p className="stat-line">{median === null ? t('还没有数据') : t('中位数落在 {b} 层', { b: median })}</p>
      </section>
      </div>
      {cardSection ? <div className="community-row">{modelSection}{cardSection}</div> : modelSection}
      {(topKinds.length > 0 || restShare > 0) && (
      <section className="community-sec">
      <div className="group-label">{t('词都是些什么')}</div>
      <ul className="found">
        {topKinds.map((k) => <li key={k.kind}><b>{pct(k.share)}%</b> {tx(ENTITY_LABEL[k.kind] ?? ENTITY_LABEL.plain)}</li>)}
        {restShare > 0 && <li key="__rest"><b>{pct(restShare)}%</b> {t('其他')}</li>}
      </ul>
      <p className="note">{t('所有人加起来的词类占比。')}</p>
      </section>
      )}
      <section className="community-sec">
      <div className="group-label">{t('我的参与')}</div>
      <label className="check">
        <input type="checkbox" checked={contribute} onChange={(e) => setContribute(e.target.checked)} />
        <span>{t('把我的匿名统计贡献给排行榜')}<em>{t('只发前 100 个词及次数、条数和字数；不发正文、不发角色卡名、不存 IP。请仅在您有权分享这份记录的统计时参与。')} <a href="#/privacy">{t('详见《隐私政策》')}</a></em></span>
      </label>
      </section>
    </>
  );
}

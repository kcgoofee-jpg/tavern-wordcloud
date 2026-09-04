import { useT } from '../i18n';

export interface CommunityStats {
  contributors: number; contributions: number; messages: number; chars: number;
  views30d: number; analyses30d: number; minContributors: number;
  words: { text: string; count: number; people: number }[];
  trend: { day: string; contributions: number; analyses: number; views: number }[];
  hours: number[];
  sizes: { label: string; n: number }[];
  zhRatio: number | null;
  updated: number;
}

/**
 * Inline mini bar chart with a two-tick y axis (max and 0) and an x baseline.
 * `ticks` marks which bars get an x label — sparse by design, so 30 days or 24 hours
 * stay readable at this size. Text is `currentColor` so both themes work.
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

/** Hours: 0 / 6 / 12 / 18 only. */
const HOUR_TICKS = Array.from({ length: 24 }, (_, i) => (i % 6 === 0 ? String(i) : null));

/** The bucket label holding the median contribution, from bucket counts in order. */
function medianBucket(sizes: { label: string; n: number }[]): string | null {
  const total = sizes.reduce((s, b) => s + b.n, 0);
  if (total === 0) return null;
  let seen = 0;
  for (const b of sizes) {
    seen += b.n;
    if (seen >= total / 2) return b.label;
  }
  return sizes[sizes.length - 1]?.label ?? null;
}

/** Community board: aggregate cloud on the canvas; counts and trend. Words only, each shared by >= N contributors; card names are not collected. */
export function CommunityPanel({ stats, contribute, setContribute, loading, offline }: {
  stats: CommunityStats | null; contribute: boolean; setContribute: (v: boolean) => void; loading: boolean;
  /** No server in the single-file / local version. */
  offline: boolean;
}) {
  const t = useT();
  if (offline) return <p className="note">{t('社区排行榜只在网页版有：它要从服务器取所有人的统计。')}</p>;
  if (loading) return <p className="note">{t('正在取社区数据…')}</p>;
  if (!stats) return <p className="note">{t('社区数据暂时取不到，稍后再试。')}</p>;
  const empty = stats.words.length === 0;
  const hourTotal = stats.hours.reduce((a, b) => a + b, 0);
  const peak = hourTotal > 0 ? stats.hours.indexOf(Math.max(...stats.hours)) : null;
  const peakShare = peak === null ? 0 : Math.round((stats.hours[peak] / hourTotal) * 100);
  const views = stats.trend.map((d) => d.views);
  const today = views.length ? views[views.length - 1] : 0;
  const avg = views.length ? Math.round(views.reduce((a, b) => a + b, 0) / views.length) : 0;
  const median = medianBucket(stats.sizes);
  return (
    <>
      <section className="community-sec">
      <div className="group-label">{t('这 30 天')}</div>
      <ul className="found">
        <li><b>{stats.views30d}</b> {t('次打开')}</li>
        <li><b>{stats.analyses30d}</b> {t('次分析')}</li>
        <li><b>{stats.contributors}</b> {t('人贡献了统计')}<em>{t('共 {n} 份 · {m} 万字', { n: stats.contributions, m: (stats.chars / 1e4).toFixed(1) })}</em></li>
      </ul>
      <Bars values={views} labels={stats.trend.map((d) => shortDay(d.day))} ticks={dayTicks(stats.trend.map((d) => d.day))} />
      <p className="note">{t('每天打开次数，最近 30 天')}</p>
      <p className="stat-line">{t('今日 {n} 次 · 日均 {m} 次', { n: today, m: avg })}</p>
      </section>
      <section className="community-sec">
      <div className="group-label">{t('总词云')}</div>
      <p className="note">{empty
        ? t('画布上暂时没有词：一个词要有至少 {n} 个不同的人都用过才会出现', { n: stats.minContributors })
        : t('画布上是 {n} 个词，每个都至少 {m} 个人用过；字号是所有人加起来的次数', { n: stats.words.length, m: stats.minContributors })}</p>
      </section>
      <section className="community-sec">
      <div className="group-label">{t('大家写多长')}</div>
      <Bars values={stats.sizes.map((s) => s.n)} labels={stats.sizes.map((s) => s.label)} />
      <p className="note">{t('每份聊天的字数分布。{zh}', { zh: stats.zhRatio === null ? '' : t('中文词占 {p}%', { p: Math.round(stats.zhRatio * 100) }) })}</p>
      <p className="stat-line">{median === null ? t('还没有数据') : t('中位数落在 {b}', { b: median })}</p>
      </section>
      <section className="community-sec">
      <div className="group-label">{t('什么时候有人在用')}</div>
      <Bars values={stats.hours} ticks={HOUR_TICKS} labels={stats.hours.map((_, h) => `${h}:00`)} color="var(--fg-dim)" />
      <p className="note">{peak === null ? t('还没有数据') : t('按小时（北京时间），最活跃是 {h} 点', { h: peak })}</p>
      <p className="stat-line">{peak === null ? t('还没有数据') : t('{h} 点最热闹，占全天 {p}%', { h: peak, p: peakShare })}</p>
      </section>
      <section className="community-sec community-sec-wide">
      <div className="group-label">{t('我的参与')}</div>
      <label className="check">
        <input type="checkbox" checked={contribute} onChange={(e) => setContribute(e.target.checked)} />
        <span>{t('把我的匿名统计贡献给排行榜')}<em>{t('只发前 100 个词及次数、条数和字数；不发正文、不发角色卡名、不存 IP。请仅在您有权分享这份记录的统计时参与。')} <a href="#/privacy">{t('详见《隐私政策》')}</a></em></span>
      </label>
      <p className="note">{t('榜单只统计词，不显示角色卡名。若您是某张卡的作者、希望它出现在榜单上：请在您公开发布这张卡的页面（角色卡站、频道帖）里临时加一行本站给的校验串，再把该页面链接贴到 issue。只需要公开链接，不要发身份证件、聊天记录或卡文件。')} <a href="https://github.com/kcgoofee-jpg/tavern-wordcloud/issues" target="_blank" rel="noopener noreferrer">{t('GitHub Issues')}</a></p>
      </section>
    </>
  );
}

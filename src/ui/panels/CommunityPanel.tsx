import { useState } from 'react';
import { classifyError } from '../../core/errors';
import { copyText } from '../clipboard';
import { BUCKET_ORDER, foldCommunityKind } from '../../core/kindBuckets';
import { useT, txv } from '../i18n';

/** One leaderboard row: count, share, and the 95% Wilson bounds the server computed. */
export interface BoardRow { name: string; n: number; share: number; low: number; high: number }

export interface CommunityStats {
  contributors: number; contributions: number; messages: number; chars: number;
  views30d: number; analyses30d: number; minContributors: number;
  words: { text: string; count: number; people: number }[];
  trend: { day: string; contributions: number; analyses: number; views: number }[];
  hours: number[];
  sizes: { label: string; n: number }[];
  zhRatio: number | null;
  /** Model leaderboard; only models >= minContributors people used are named. */
  models: BoardRow[];
  /** Endpoint classes, same k-anonymity rule. */
  endpoints: BoardRow[];
  /** Word counts per entity kind, over everyone. */
  kinds: { kind: string; words: number; share: number }[];
  /** Median generation time in ms, when logs carried timings. */
  genMs: number | null;
  /**
   * How much of a data export people import, as shares and averages. Present only while
   * the operator publishes it; counts only, never a card / preset / world-book name.
   */
  cardStats?: { reports: number; withCards: number; withWorlds: number; withPreset: number; avgCards: number; avgWorlds: number };
  /** Card names an approved author claim vouched for. Names only — no links, no submitter. */
  claimedCards?: string[];
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

type T = ReturnType<typeof useT>;
/** Endpoint classes and entity kinds arrive as stable machine strings; translate for display. */
function endpointLabel(t: T, kind: string): string {
  switch (kind) {
    case 'official': return t('厂商官方');
    case 'openrouter': return t('OpenRouter');
    case 'relay': return t('第三方中转');
    case 'local': return t('本机 / 局域网');
    default: return t('其他');
  }
}
/** Same five ops buckets as the compact filter; flags already collapsed by foldCommunityKind. */
function foldKinds(kinds: { kind: string; share: number }[]): { kind: string; share: number }[] {
  return BUCKET_ORDER
    .map((k) => ({
      kind: k,
      share: kinds.filter((x) => foldCommunityKind(x.kind) === k).reduce((a, b) => a + b.share, 0),
    }))
    .filter((r) => r.share > 0);
}
function kindLabel(t: T, kind: string): string {
  switch (kind) {
    case 'person': return t('人物');
    case 'place': return t('地点');
    case 'time': return t('时间');
    case 'social': return t('文书与组织');
    default: return t('其他');
  }
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

/** 16 hex characters, stable for the session so a reopened form keeps the same string. */
function claimToken(): string {
  try {
    const cached = sessionStorage.getItem('wc-claim-token');
    if (cached && /^[0-9a-f]{16}$/.test(cached)) return cached;
  } catch { /* storage can be blocked; fall through to a fresh one */ }
  const bytes = new Uint8Array(8);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  const tok = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  try { sessionStorage.setItem('wc-claim-token', tok); } catch { /* ignore */ }
  return tok;
}

/**
 * Author claim: card name, a public link that proves authorship, and the challenge
 * string this site hands out. No e-mail, no identity — the operator opens the link.
 * The payload is shown before it is sent, like the cleaning-feedback dialog.
 */
function ClaimForm() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [card, setCard] = useState('');
  const [url, setUrl] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState<'idle' | 'sent' | 'failed'>('idle');
  const [failure, setFailure] = useState('');
  const [copied, setCopied] = useState(false);
  const toggle = () => {
    setOpen((v) => {
      if (!v) setToken(claimToken());
      return !v;
    });
  };
  /** Translate a rejection through the shared classifier, so a server `code` is worded once. */
  const fail = (raw: unknown) => {
    const e = classifyError(raw);
    setFailure(e.titleTpl ? txv(e.titleTpl) : txv(e.title));
    setState('failed');
  };
  const send = () => {
    setConfirming(false);
    fetch('/api/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ card: card.trim(), url: url.trim(), token }) })
      .then(async (r) => {
        if (r.ok) { setState('sent'); return; }
        const body = await r.json().catch(() => ({})) as { code?: string; error?: string };
        fail(Object.assign(new Error(body.error ?? 'claim failed'), { code: body.code }));
      })
      .catch((e: unknown) => fail(e));
  };
  return (
    <div className="claim">
      <button type="button" className="claim-toggle" aria-expanded={open} title={t('认领我的角色卡')} onClick={toggle}>
        {t('认领我的角色卡')}
      </button>
      {open && (
        <div className="claim-body">
          <p className="note">{t('只需要一个公开链接：在您公开发布这张卡的页面里临时加一行下面的校验串，再把该页面链接填进来。不要发邮箱、身份证件、聊天记录或卡文件。')}</p>
          <label className="claim-field"><span>{t('卡名')}</span>
            <input type="text" value={card} maxLength={60} onChange={(e) => { setCard(e.target.value); setState('idle'); }} />
          </label>
          <label className="claim-field"><span>{t('公开链接')}</span>
            <input type="url" value={url} maxLength={300} placeholder="https://" onChange={(e) => { setUrl(e.target.value); setState('idle'); }} />
          </label>
          {/* The copy button sits outside the label: a label wrapping two controls
              makes the field ambiguous to assistive tech and to getByLabelText. */}
          <div className="claim-field">
            <label htmlFor="claim-token">{t('校验串')}</label>
            <input id="claim-token" type="text" readOnly value={token} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="claim-copy" title={t('复制')} onClick={() => { void copyText(token).then(setCopied); }}>
              {copied ? t('已复制') : t('复制')}
            </button>
          </div>
          {confirming ? (
            <div className="claim-confirm">
              <p className="note">{t('将发送这三项，别的什么都不发：')}</p>
              <ul className="claim-preview">
                <li>{t('卡名')}：{card.trim()}</li>
                <li>{t('公开链接')}：{url.trim()}</li>
                <li>{t('校验串')}：{token}</li>
              </ul>
              <div className="claim-actions">
                <button type="button" className="claim-btn" onClick={() => setConfirming(false)}>{t('取消')}</button>
                <button type="button" className="claim-btn primary" onClick={send}>{t('发送')}</button>
              </div>
            </div>
          ) : (
            <div className="claim-actions">
              <button type="button" className="claim-btn primary" disabled={!card.trim() || !url.trim()} onClick={() => setConfirming(true)}>{t('提交认领')}</button>
            </div>
          )}
          {state === 'sent' && <p className="stat-line">{t('已收到，站长核对后加入榜单')}</p>}
          {state === 'failed' && <p className="note">{failure || t('没发出去，检查一下链接是不是完整的 https 网址')}</p>}
        </div>
      )}
    </div>
  );
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
  // A server one deploy behind returns none of the leaderboard fields; render the rest.
  const models = stats.models ?? [], endpoints = stats.endpoints ?? [], kinds = foldKinds(stats.kinds ?? []);
  const claimed = stats.claimedCards ?? [];
  const cardStats = stats.cardStats;
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
      <section className="community-sec community-sec-wide">
      <div className="group-label">{t('模型榜')}</div>
      {models.length === 0
        ? <p className="note">{t('还没有足够的人填过模型名：一个模型要有至少 {n} 个不同的人用过才会具名上榜，其余并进「其他」。', { n: stats.minContributors })}</p>
        : <>
          <Board rows={models} />
          <p className="note">{t('按贡献份数排名；括号里是 95% 置信区间（Wilson）。少于 {n} 人用过的模型并进「其他」，不具名。', { n: stats.minContributors })}</p>
          {stats.genMs != null && <p className="stat-line">{t('生成耗时中位数 {s} 秒', { s: (stats.genMs / 1000).toFixed(1) })}</p>}
        </>}
      </section>
      {endpoints.length > 0 && (
      <section className="community-sec">
      <div className="group-label">{t('接口类型')}</div>
      <Board rows={endpoints} label={(n) => endpointLabel(t, n)} />
      <p className="note">{t('只记地址的粗类，不记地址本身。')}</p>
      </section>
      )}
      {kinds.length > 0 && (
      <section className="community-sec">
      <div className="group-label">{t('词都是些什么')}</div>
      <ul className="found">
        {kinds.map((k) => <li key={k.kind}><b>{pct(k.share)}%</b> {kindLabel(t, k.kind)}</li>)}
      </ul>
      <p className="note">{t('所有人加起来的词类占比。')}</p>
      </section>
      )}
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
      {/* Every share at 0 means no contribution has carried these fields yet: three 0.0% rows
          read as a broken panel, so say so instead (seen live 2026-09-05). */}
      {cardStats && (cardStats.withCards + cardStats.withWorlds + cardStats.withPreset > 0 ? (
      <section className="community-sec">
      <div className="group-label">{t('大家导入了什么')}</div>
      <ul className="found">
        <li><b>{pct(cardStats.withCards)}%</b> {t('带角色卡')}</li>
        <li><b>{pct(cardStats.withWorlds)}%</b> {t('带世界书')}</li>
        <li><b>{pct(cardStats.withPreset)}%</b> {t('带预设')}</li>
      </ul>
      <p className="note">{t('只统计数量，不记录任何卡名、预设名或世界书名。共 {n} 份。', { n: cardStats.reports })}</p>
      <p className="stat-line">{t('平均每份 {c} 张卡 · {w} 本世界书', { c: cardStats.avgCards.toFixed(1), w: cardStats.avgWorlds.toFixed(1) })}</p>
      </section>
      ) : (
      <section className="community-sec">
      <div className="group-label">{t('大家导入了什么')}</div>
      <p className="note">{t('还没有带角色卡或世界书的记录。')}</p>
      </section>
      ))}
      {claimed.length > 0 && (
      <section className="community-sec">
      <div className="group-label">{t('已认领的角色卡')}</div>
      <ul className="claimed-cards">
        {claimed.map((name) => <li key={name}>{name}</li>)}
      </ul>
      <p className="note">{t('作者自己提交、站长核对过的卡名；不显示链接，也不显示是谁提交的。')}</p>
      </section>
      )}
      <section className="community-sec community-sec-wide">
      <div className="group-label">{t('我的参与')}</div>
      <label className="check">
        <input type="checkbox" checked={contribute} onChange={(e) => setContribute(e.target.checked)} />
        <span>{t('把我的匿名统计贡献给排行榜')}<em>{t('只发前 100 个词及次数、条数和字数；不发正文、不发角色卡名、不存 IP。请仅在您有权分享这份记录的统计时参与。')} <a href="#/privacy">{t('详见《隐私政策》')}</a></em></span>
      </label>
      <p className="note">{t('榜单只统计词，不显示角色卡名。若您是某张卡的作者、希望它出现在榜单上：请在您公开发布这张卡的页面（角色卡站、频道帖）里临时加一行本站给的校验串，再把该页面链接贴到 issue。只需要公开链接，不要发身份证件、聊天记录或卡文件。')} <a href="https://github.com/kcgoofee-jpg/tavern-wordcloud/issues" target="_blank" rel="noopener noreferrer">{t('GitHub Issues')}</a></p>
      <ClaimForm />
      </section>
    </>
  );
}

import { useMemo, useState } from 'react';
import { useT, tx } from '../i18n';
import { ENTITY_LABEL, type EntityKind } from '../../core/entities';
import type { WordCount, WordOverride } from '../../core/types';
import Icon from '../Icons';

/** Overrides are keyed by the lowercased original word (core/overrides.ts). */
const key = (w: string) => w.toLowerCase();

/** Same order as the filter panel's kind grid, so the two pages read alike. */
const REVIEW_KINDS: EntityKind[] = ['plain', 'person', 'place', 'time', 'generic', 'brand', 'wear', 'title'];

const PAGE = 100;

/** What a word looked like before this session touched it, so «undo all» can put it back. */
interface Before {
  ov: WordOverride | undefined;
  stopped: boolean;
}

/** Every kind a word carries: a hand-filed kind wins outright, else the core's tags. */
function kindsOf(w: WordCount, ov: Record<string, WordOverride>): EntityKind[] {
  const own = ov[key(w.text)]?.kind;
  if (own) return [own];
  const tags = w.kinds?.map((x) => x.kind) ?? (w.kind ? [w.kind] : []);
  return tags.length ? tags : ['plain'];
}

/**
 * The review page (notes/docs/27 F11): walk one kind at a time and correct what the
 * classifier got wrong. Everything it writes goes to `overrides[word].kind` — the old
 * `settings.kindOverrides` is migrated away on load (hooks/useSettings).
 */
export function ReviewPanel({
  words, overrides, setOverrides, extraStopwords, setExtraStopwords,
}: {
  /** The full word table, not just what fits on the cloud. */
  words: WordCount[];
  overrides: Record<string, WordOverride>;
  setOverrides: (fn: (o: Record<string, WordOverride>) => Record<string, WordOverride>) => void;
  extraStopwords: string[];
  setExtraStopwords: (v: string[]) => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<EntityKind | 'all'>('all');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  /** Which row's kind menu is open; one at a time. */
  const [menuWord, setMenuWord] = useState<string | null>(null);
  /** Words changed in this session, with the state to restore. */
  const [before, setBefore] = useState<Record<string, Before>>({});

  const stopped = useMemo(() => new Set(extraStopwords), [extraStopwords]);

  /** Records the pre-change state once per word, so repeated edits still undo to the start. */
  const remember = (w: string) => setBefore((b) => (
    w in b ? b : { ...b, [w]: { ov: overrides[key(w)], stopped: stopped.has(w) } }
  ));

  const setKind = (w: string, k: EntityKind) => {
    remember(w);
    setOverrides((o) => ({ ...o, [key(w)]: { ...o[key(w)], kind: k } }));
    setMenuWord(null);
  };
  const markStop = (w: string) => {
    remember(w);
    setExtraStopwords([...new Set([...extraStopwords, w])]);
  };

  const undoAll = () => {
    const entries = Object.entries(before);
    if (!entries.length) return;
    setOverrides((o) => {
      const next = { ...o };
      for (const [w, b] of entries) {
        if (b.ov) next[key(w)] = b.ov; else delete next[key(w)];
      }
      return next;
    });
    const back = new Set(entries.filter(([, b]) => !b.stopped).map(([w]) => w));
    setExtraStopwords(extraStopwords.filter((w) => !back.has(w)));
    setBefore({});
  };

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return words
      .filter((w) => (tab === 'all' || kindsOf(w, overrides).includes(tab))
        && (!needle || w.text.toLowerCase().includes(needle)))
      .sort((a, b) => b.count - a.count);
  }, [words, overrides, tab, q]);

  const shown = list.slice(0, limit);
  const rest = list.length - shown.length;
  const changed = Object.keys(before).length;

  return (
    <div className="review">
      <div className="review-tabs">
        <button type="button" className={tab === 'all' ? 'on' : ''} aria-pressed={tab === 'all'}
          onClick={() => { setTab('all'); setLimit(PAGE); }}>{t('全部')}</button>
        {REVIEW_KINDS.map((k) => (
          <button key={k} type="button" className={tab === k ? 'on' : ''} aria-pressed={tab === k}
            onClick={() => { setTab(k); setLimit(PAGE); }}>{tx(ENTITY_LABEL[k])}</button>
        ))}
      </div>

      <input className="review-q" type="search" value={q} aria-label={t('搜词')}
        placeholder={t('搜词')} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} />

      <div className="review-bar">
        <span>{t('本次改了 {n} 个', { n: changed })}</span>
        <button type="button" className="field-act" disabled={changed === 0} onClick={undoAll}>
          {t('全部撤销')}
        </button>
      </div>

      {shown.length === 0 && <p className="note">{t('这一类还没有词')}</p>}

      <ul className="review-list">
        {shown.map((w) => {
          const ks = kindsOf(w, overrides);
          const isStopped = stopped.has(w.text);
          return (
            <li key={w.text} className={isStopped ? 'review-row off' : 'review-row'}>
              <b>{w.text}</b>
              <em className="review-n">{w.count}</em>
              <span className="review-kinds">
                {isStopped ? t('已标为非词') : ks.map((k) => tx(ENTITY_LABEL[k])).join(' · ')}
              </span>
              <button type="button" className="review-act" title={t('改类别')}
                aria-expanded={menuWord === w.text}
                onClick={() => setMenuWord(menuWord === w.text ? null : w.text)}>
                <Icon name="pencil" size={15} />
              </button>
              <button type="button" className="review-act" title={t('移出分类')}
                onClick={() => setKind(w.text, 'plain')}>
                <Icon name="unsplit" size={15} />
              </button>
              <button type="button" className="review-act" title={t('标为非词')}
                disabled={isStopped} onClick={() => markStop(w.text)}>
                <Icon name="trash" size={15} />
              </button>
              {menuWord === w.text && (
                <span className="review-menu" role="menu">
                  {REVIEW_KINDS.map((k) => (
                    <button key={k} type="button" role="menuitem"
                      className={ks.includes(k) ? 'on' : ''}
                      onClick={() => setKind(w.text, k)}>{tx(ENTITY_LABEL[k])}</button>
                  ))}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {rest > 0 && (
        <button type="button" className="field-act" onClick={() => setLimit((n) => n + PAGE)}>
          {t('还有 {n} 个', { n: rest })}
        </button>
      )}

      <p className="note">{t('这些修改只存在你的浏览器里，同一张卡下次导入自动套用')}</p>
    </div>
  );
}

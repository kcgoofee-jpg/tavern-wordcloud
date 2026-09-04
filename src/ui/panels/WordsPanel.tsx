import { useMemo, useState } from 'react';
import { useT } from '../i18n';
import type { AnalyzeOptions } from '../../core/analyze';
import type { WordCount, WordOverride } from '../../core/types';
import { hasAliasCycle } from '../../core/overrides';
import { rankAliasCandidates } from '../../core/aliasScore';
import type { Cooccur } from '../../core/cooccur';
import Icon from '../Icons';
import { NSFW_EXPLICIT_KINDS } from '../../core/nsfw';
import { nsfwLabel } from '../nsfwLabels';
import { toTraditional } from '../../theme/s2t';

/** Overrides are keyed by the lowercased original word (core/overrides.ts). */
const key = (w: string) => w.toLowerCase();

export function WordsPanel({
  words, options, setOptions, onHover, hovered, onReport, overrides, setOverrides, priority = [], cooccur,
}: {
  /** Report a word as noise: sends the word and a few context snippets. Hidden without a server. */
  onReport?: (word: string) => void;
  words: WordCount[];
  options: AnalyzeOptions;
  setOptions: (fn: (o: AnalyzeOptions) => AnalyzeOptions) => void;
  onHover: (w: string | null) => void;
  hovered: string | null;
  overrides: Record<string, WordOverride>;
  setOverrides: (fn: (o: Record<string, WordOverride>) => Record<string, WordOverride>) => void;
  /** Parsed priority words; they outrank a hide, so those hide chips are shown greyed. */
  priority?: string[];
  /** Co-occurrence index from the analysis; drives the equivalence candidate ranking. */
  cooccur?: Cooccur | null;
}) {
  const t = useT();
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(60);
  /** Original word currently being renamed in place, plus its draft text. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  /**
   * Equivalence mode (experimental, notes/docs/27 s2.2, simplified): the word whose bucket
   * other words are being merged into. The search box doubles as its input.
   */
  const [aliasInto, setAliasInto] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const list = useMemo(() => {
    // In equivalence mode the box feeds the candidate list, so the table stays put.
    const needle = aliasInto ? '' : q.trim().toLowerCase();
    // Matches both Simplified and Traditional queries regardless of the display toggle:
    // the original text is always Simplified, so also check its Traditional form.
    return needle
      ? words.filter((w) => w.text.toLowerCase().includes(needle) || toTraditional(w.text).toLowerCase().includes(needle))
      : words;
  }, [words, q, aliasInto]);

  const tok = options.tokenize;
  const setTok = <K extends keyof AnalyzeOptions['tokenize']>(k: K, v: AnalyzeOptions['tokenize'][K]) =>
    setOptions((o) => ({ ...o, tokenize: { ...o.tokenize, [k]: v } }));

  const splitWord = (w: string) => {
    setTok('splitWords', [...new Set([...tok.splitWords, w])]);
    setTok('forceWords', tok.forceWords.filter((x) => x !== w));
  };
  const hideWord = (w: string) =>
    setTok('extraStopwords', [...new Set([...tok.extraStopwords, w])]);
  const undo = (w: string) => {
    setTok('forceWords', tok.forceWords.filter((x) => x !== w));
    setTok('splitWords', tok.splitWords.filter((x) => x !== w));
    setTok('extraStopwords', tok.extraStopwords.filter((x) => x !== w));
  };

  /** Merge one field into a word's override; an emptied override is deleted, not left behind. */
  const patchOv = (w: string, field: Partial<WordOverride>) => setOverrides((o) => {
    const k = key(w);
    const next: WordOverride = { ...o[k], ...field };
    for (const f of Object.keys(next) as (keyof WordOverride)[]) {
      if (next[f] === undefined || next[f] === '') delete next[f];
    }
    const out = { ...o };
    if (Object.keys(next).length === 0) delete out[k]; else out[k] = next;
    return out;
  });

  const startEdit = (w: WordCount) => {
    setEditing(w.text);
    setDraft(overrides[key(w.text)]?.display ?? w.text);
  };
  const commitEdit = (w: string) => {
    const v = draft.trim();
    patchOv(w, { display: v && v !== w ? v : undefined });
    setEditing(null);
  };
  /** auto -> horizontal -> vertical -> auto */
  const cycleRotate = (w: string) => {
    const cur = overrides[key(w)]?.rotate;
    // One click must change what you see. Most words lie flat, so the first click stands the
    // word up; after that it flips. "Back to automatic" is the chip in the edit list.
    patchOv(w, { rotate: cur === 'v' ? 'h' : 'v' });
  };

  /** Words that already point somewhere else; they are demoted, not hidden. */
  const aliased = useMemo(
    () => new Set(Object.entries(overrides).filter(([, o]) => o.alias !== undefined).map(([k]) => k)),
    [overrides],
  );

  /**
   * Equivalence candidates for `aliasInto`, ranked by core/aliasScore.ts:
   * same kind, prefix/substring of what was typed, co-occurrence rate, similar
   * length, minus a penalty for a word already aliased elsewhere. Experimental:
   * `npm run eval:alias` puts the top-3 hit rate below the 60% bar, so the list
   * is a shortcut, not an answer.
   */
  const candidates = useMemo(() => {
    if (!aliasInto) return [];
    const target = words.find((w) => key(w.text) === key(aliasInto)) ?? { text: aliasInto, count: 0 };
    return rankAliasCandidates(target, words, { needle: q, cooccur, aliased }) as WordCount[];
  }, [words, q, aliasInto, cooccur, aliased]);

  const exitAlias = () => { setAliasInto(null); setQ(''); setHint(null); };

  const startAlias = (w: string) => {
    setEditing(null);
    setAliasInto(w);
    setQ('');
    setHint(null);
  };

  /** Merge `src` into `aliasInto`; refuses a merge that would close an alias loop. */
  const mergeInto = (src: string, target: string) => {
    if (hasAliasCycle(overrides, src, target)) {
      setHint(t('「{a}」已经并到「{b}」那边了，再并回来会绕圈', { a: target, b: src }));
      return;
    }
    patchOv(src, { alias: target });
    exitAlias();
  };

  /** Enter in equivalence mode: first candidate wins; with none, fall back to renaming. */
  const commitAlias = () => {
    const target = aliasInto;
    if (!target) return;
    if (candidates.length > 0) { mergeInto(candidates[0].text, target); return; }
    const v = q.trim();
    setAliasInto(null);
    setQ('');
    setHint(t('没有匹配的词，已改为只修改显示名'));
    setEditing(target);
    setDraft(v || (overrides[key(target)]?.display ?? target));
  };

  const priSet = useMemo(() => new Set(priority.map(key)), [priority]);

  const edits = [
    ...tok.forceWords.map((w) => ({ w, kind: t('合并'), run: () => undo(w) })),
    ...tok.splitWords.map((w) => ({ w, kind: t('拆开'), run: () => undo(w) })),
    ...tok.extraStopwords.map((w) => ({
      w, kind: t('隐藏'), run: () => undo(w),
      // Priority wins over a hide; the chip stays, greyed, so the user sees why the word is back.
      muted: priSet.has(key(w)),
    })),
    ...Object.entries(overrides).filter(([, o]) => o.display !== undefined)
      .map(([w]) => ({ w, kind: t('显示名'), run: () => patchOv(w, { display: undefined }) })),
    ...Object.entries(overrides).filter(([, o]) => o.alias !== undefined)
      .map(([w, o]) => ({ w: `${w} → ${o.alias}`, kind: t('等价'), cls: 'alias', run: () => patchOv(w, { alias: undefined }) })),
    ...Object.entries(overrides).filter(([, o]) => o.rotate !== undefined)
      .map(([w]) => ({ w, kind: t('旋转'), run: () => patchOv(w, { rotate: undefined }) })),
  ];

  return (
    <>
      {edits.length > 0 && (
        <div className="edits">
          {edits.map((e) => (
            <button key={e.kind + e.w} type="button"
              className={`edit-chip${'muted' in e && e.muted ? ' muted' : ''}${'cls' in e ? ' ' + e.cls : ''}`}
              title={'muted' in e && e.muted ? t('被优先词覆盖') : t('撤销这条改动')}
              onClick={e.run}>
              <em>{e.kind}</em>{e.w}<Icon name="close" size={11} />
            </button>
          ))}
        </div>
      )}

      <div className={`words-search${aliasInto ? ' alias-mode' : ''}`}>
        <input
          className="search" value={q}
          key={aliasInto ? 'alias' : 'search'} autoFocus={aliasInto !== null}
          aria-label={aliasInto ? t('要并入「{w}」的词', { w: aliasInto }) : t('搜索')}
          placeholder={aliasInto ? t('输入要并入「{w}」的词', { w: aliasInto }) : t('搜索')}
          onChange={(e) => { setQ(e.target.value); setHint(null); }}
          onKeyDown={(e) => {
            if (!aliasInto) return;
            if (e.key === 'Enter') { e.preventDefault(); commitAlias(); }
            else if (e.key === 'Escape') exitAlias();
          }} />
        {aliasInto && (
          <button type="button" className="btn-x alias-exit" title={t('退出等价模式')} onClick={exitAlias}>
            <Icon name="close" size={13} />
          </button>
        )}
      </div>
      {aliasInto && (
        <div className="alias-cands">
          <p className="note alias-exp">{t('候选顺序是实验功能：按同类、共现和输入前缀猜的，不一定对')}</p>
          {candidates.length === 0
            ? <p className="note">{t('没有匹配的词；回车会改成只修改「{w}」的显示名', { w: aliasInto })}</p>
            : candidates.map((c) => (
              <button key={c.text} type="button" className="alias-cand"
                title={t('把「{a}」并入「{b}」', { a: c.text, b: aliasInto })}
                onClick={() => mergeInto(c.text, aliasInto)}>
                {c.text}<em>{c.count}</em>
              </button>
            ))}
        </div>
      )}
      {hint && <p className="note alias-hint">{hint}</p>}

      <ol className="wordlist words-edit" onPointerLeave={() => onHover(null)}>
        {list.slice(0, limit).map((w, i) => {
          const ov = overrides[key(w.text)];
          const renamed = ov?.display !== undefined;
          const rot = ov?.rotate;
          return (
            <li key={w.text} className={hovered === w.text ? 'on' : ''}
              onPointerEnter={() => onHover(w.text)}
              style={{ animationDelay: `${Math.min(i, 20) * 10}ms` }}>
              <span className="rank">{i + 1}</span>
              {editing === w.text ? (
                <input
                  className="word-edit" autoFocus aria-label={t('显示名')} value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => setEditing(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEdit(w.text);
                    else if (e.key === 'Escape') setEditing(null);
                  }} />
              ) : (
                <span className="word">
                  {renamed && <em className="orig">{w.text} →</em>}
                  {ov?.display ?? w.display ?? w.text}
                  {w.priority && <em className="pri-tag" title={t('优先词')}>★</em>}
                  {w.nsfw && (
                    <em className={`nsfw-tag ${w.nsfw === 'maybe' ? 'maybe' : NSFW_EXPLICIT_KINDS.includes(w.nsfw) ? 'sure' : 'mild'}`}
                      title={w.nsfw === 'maybe' ? t('正常叙事里也常见，或只含一个敏感字，可能误判') : t('露骨词类别。在「筛选」里决定这一类算不算露骨')}>
                      {nsfwLabel(t)[w.nsfw]}
                    </em>
                  )}
                </span>
              )}
              <span className="count">{w.count}</span>
              <span className="row-acts">
                <button type="button" className="btn-x" title={t('改「{w}」在云上显示的字', { w: w.text })}
                  onClick={() => startEdit(w)}><Icon name="pencil" size={13} /></button>
                <button type="button" className={aliasInto === w.text ? 'btn-x set' : 'btn-x'}
                  title={t('把别的词并入「{w}」', { w: w.text })}
                  onClick={() => startAlias(w.text)}><Icon name="equals" size={13} /></button>
                <button type="button" className={rot ? 'btn-x set' : 'btn-x'}
                  title={rot === 'h' ? t('「{w}」强制横排；再点一次改竖排', { w: w.text })
                    : rot === 'v' ? t('「{w}」强制竖排；再点一次恢复自动', { w: w.text })
                      : t('「{w}」的横竖由程序随机决定；点一下强制横排', { w: w.text })}
                  onClick={() => cycleRotate(w.text)}><Icon name={rot === 'v' ? 'rotateV' : 'rotateH'} size={13} /></button>
                {w.text.length >= 3 && (
                  <button type="button" className="btn-x" disabled={renamed}
                    title={renamed ? t('已改显示名的词不能再拆') : t('把「{w}」拆开，不当成一个词', { w: w.text })}
                    onClick={() => splitWord(w.text)}><Icon name="unsplit" size={13} /></button>
                )}
                <button type="button" className="btn-x" title={t('不显示「{w}」', { w: w.text })}
                  onClick={() => hideWord(w.text)}><Icon name="close" size={13} /></button>
                {onReport && (
                  <button type="button" className="btn-x" title={t('认为『{w}』不该出现？提交反馈——会先给你看要发送的片段，确认后才上传', { w: w.text })}
                    onClick={() => onReport(w.text)}><Icon name="alert" size={13} /></button>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      {list.length > limit && (
        <button type="button" className="more" onClick={() => setLimit((n) => n + 100)}>
          {t('还有 {n} 个', { n: list.length - limit })}
        </button>
      )}
    </>
  );
}

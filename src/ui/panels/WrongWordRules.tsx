import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n';
import type { AnalyzeOptions } from '../../core/analyze';

/** How many correct words one wrong word may map to (design 27 §3). */
export const MAX_TARGETS = 5;

type Row = { wrong: string; right: string };

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const EMPTY: Row = { wrong: '', right: '' };

/** Rows always end with one blank line to type the next rule into. */
const withBlank = (rows: Row[]): Row[] =>
  rows.length && !rows[rows.length - 1].wrong && !rows[rows.length - 1].right ? rows : [...rows, { ...EMPTY }];

/**
 * "Wrong word → correct words" editor. It owns no tokenizer knowledge: the left side is written
 * to `splitWords` (stop treating it as one word), each word on the right to `forceWords`.
 * The pairing is not stored, so rules loaded from settings come back as half rules
 * ("wrong → (split only)") that the user can complete.
 */
export function WrongWordRules({
  tokenize, setTok,
}: {
  tokenize: AnalyzeOptions['tokenize'];
  setTok: <K extends keyof AnalyzeOptions['tokenize']>(k: K, v: AnalyzeOptions['tokenize'][K]) => void;
}) {
  const t = useT();
  const { splitWords, forceWords } = tokenize;
  const [rows, setRows] = useState<Row[]>(() => withBlank(splitWords.map((wrong) => ({ wrong, right: '' }))));
  // Words this editor last wrote into forceWords; anything else there came from the word table and is kept.
  const owned = useRef<string[]>([]);

  // Outside changes (reset, another device) rebuild the rows; the echo of our own commit is a no-op.
  useEffect(() => {
    setRows((cur) => (cur.map((r) => r.wrong.trim()).filter(Boolean).join('\n') === splitWords.join('\n')
      ? cur : withBlank(splitWords.map((wrong) => ({ wrong, right: '' })))));
  }, [splitWords]);

  const errors = useMemo(() => rows.map((r) => {
    const wrong = r.wrong.trim();
    const list = words(r.right);
    if (wrong && list.includes(wrong)) return t('正确词不能是错词本身');
    if (list.length > MAX_TARGETS) return t('最多 5 个正确词，多余的已省略');
    return '';
  }), [rows, t]);

  const commit = (next: Row[]) => {
    const kept: Row[] = [];
    const lefts: string[] = [];
    const rights: string[] = [];
    for (const r of next) {
      const wrong = r.wrong.trim();
      const list = words(r.right).slice(0, MAX_TARGETS);
      if (!wrong && !list.length) continue;
      kept.push(r);
      if (wrong && list.includes(wrong)) continue; // self-reference: shown in red, never committed
      if (wrong) lefts.push(wrong);
      rights.push(...list);
    }
    const split = [...new Set(lefts)];
    const force = [...new Set([...forceWords.filter((w) => !owned.current.includes(w)), ...rights])];
    owned.current = [...new Set(rights)];
    if (split.join('\n') !== splitWords.join('\n')) setTok('splitWords', split);
    if (force.join('\n') !== forceWords.join('\n')) setTok('forceWords', force);
    setRows(withBlank(kept));
  };

  const edit = (i: number, patch: Partial<Row>) =>
    setRows((cur) => withBlank(cur.map((r, j) => (j === i ? { ...r, ...patch } : r))));

  return (
    <div className="wrong-words">
      {rows.map((r, i) => {
        const placeholder = i === rows.length - 1 && !r.wrong && !r.right;
        return (
        <div key={i} className="wrong-words-row">
          <div className="wrong-words-line">
            <input value={r.wrong} placeholder={t('错词')} aria-label={t('错词')}
              onChange={(e) => edit(i, { wrong: e.target.value })} onBlur={() => commit(rows)} />
            <span className="wrong-words-arrow" aria-hidden="true">→</span>
            <input value={r.right} placeholder={r.wrong && !r.right ? t('（只拆开）') : t('正确词，空格分隔')}
              aria-label={t('正确词')}
              onChange={(e) => edit(i, { right: e.target.value })} onBlur={() => commit(rows)} />
            <button type="button" className="icon-btn" title={t('删除这条规则')}
              disabled={placeholder}
              onClick={() => commit(rows.filter((_, j) => j !== i))}>×</button>
          </div>
          {errors[i] ? <em className="wrong-words-err">{errors[i]}</em> : null}
        </div>
        );
      })}
    </div>
  );
}

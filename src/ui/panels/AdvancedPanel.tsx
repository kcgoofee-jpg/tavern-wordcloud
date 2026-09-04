import { useT } from '../i18n';
import type { AnalyzeOptions } from '../../core/analyze';
import Slider from './Slider';
import { WrongWordRules } from './WrongWordRules';
import { useEffect, useState } from 'react';

const lines = (s: string) => s.split(/\n/).map((x) => x.trim()).filter(Boolean);

/**
 * One word per line. The box keeps its own text while you type and hands the list over on
 * blur: feeding `lines()` straight back into `value` dropped the newline you had just typed
 * (an empty line is not a word), so Enter looked like it "started the analysis" instead of
 * moving to the next line — and every keystroke re-ran the tokenizer.
 */
function LinesBox({ value, placeholder, onCommit }: { value: string[]; placeholder: string; onCommit: (v: string[]) => void }) {
  const [draft, setDraft] = useState(value.join('\n'));
  // Outside changes (reset button, another device) replace the draft; the ordinary echo of a commit is a no-op.
  useEffect(() => { setDraft((d) => (lines(d).join('\n') === value.join('\n') ? d : value.join('\n'))); }, [value]);
  return (
    <textarea rows={2} value={draft} placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { const v = lines(draft); if (v.join('\n') !== value.join('\n')) onCommit(v); }} />
  );
}

/** Advanced settings: tuning values the user can change and verify visually. */
export function AdvancedPanel({
  options, setOptions,
}: {
  options: AnalyzeOptions;
  setOptions: (fn: (o: AnalyzeOptions) => AnalyzeOptions) => void;
}) {
  const t = useT();
  const setTok = <K extends keyof AnalyzeOptions['tokenize']>(k: K, v: AnalyzeOptions['tokenize'][K]) =>
    setOptions((o) => ({ ...o, tokenize: { ...o.tokenize, [k]: v } }));

  return (
    <>
      <Slider label={t('新词至少出现几次')} value={options.tokenize.discoverMinCount} min={2} max={20}
        onChange={(v) => setTok('discoverMinCount', v)} />

      <div className="group-label">{t('自定义词')}</div>
      <label className="field">
        <span>{t('不显示这些词')}<em>{t('一行一个')}</em></span>
        <LinesBox value={options.tokenize.extraStopwords} placeholder={`${t('片场')}\n${t('制片')}`}
          onCommit={(v) => setTok('extraStopwords', v)} />
      </label>
      <div className="field">
        <span>{t('改错词重新分词')}<em>{t('把分错的词拆开，写上正确的词；右边留空就只拆开')}</em></span>
        <WrongWordRules tokenize={options.tokenize} setTok={setTok} />
      </div>

      <label className="check">
        <input type="checkbox" checked={options.ignoreOwnerBlocklist}
          onChange={(e) => setOptions((o) => ({ ...o, ignoreOwnerBlocklist: e.target.checked }))} />
        <span>{t('不用站长维护的禁词表')}<em>{t('（被它们过滤掉的词会回到词云）')}</em></span>
      </label>

      <div className="group-label">{t('清洗细项')}</div>
      {([
        ['stripCodeBlocks', t('删代码块和网页代码')],
        ['stripOOC', t('删括号里的场外话（OOC）')],
      ] as const).map(([k, label]) => (
        <label key={k} className="check">
          <input type="checkbox" checked={options.clean[k]}
            onChange={(e) => setOptions((o) => ({ ...o, clean: { ...o.clean, [k]: e.target.checked } }))} />
          <span>{label}</span>
        </label>
      ))}
    </>
  );
}

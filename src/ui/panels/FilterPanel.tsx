import { useState } from 'react';
import { useT, tx } from '../i18n';
import type { AnalyzeOptions } from '../../core/analyze';
import { ENTITY_LABEL, type EntityKind } from '../../core/entities';
import { NSFW_KINDS, NSFW_EXPLICIT_KINDS } from '../../core/nsfw';
import { nsfwLabel } from '../nsfwLabels';
import type { AnalysisResult, Role } from '../../core/types';
import Slider from './Slider';

/** A function of `t` so labels are literal `t('…')` calls. */
const roleLabel = (t: (s: string) => string): Record<Role, string> =>
  ({ user: t('我说的'), char: t('角色说的'), system: '' });
const KIND_ORDER: EntityKind[] = ['plain', 'person', 'place', 'time', 'generic'];
const nsfwModeLabel = (t: (s: string) => string): Record<AnalyzeOptions['nsfwMode'], string> =>
  ({ show: t('全部显示'), hide: t('隐藏 NSFW'), only: t('只看 NSFW') });

export function FilterPanel({
  options, setOptions, rotateRatio, setRotateRatio, result, kindOverrides, setKindOverrides,
}: {
  /** Words the user re-filed by hand, text -> kind. */
  kindOverrides: Record<string, EntityKind>;
  setKindOverrides: (o: Record<string, EntityKind>) => void;
  options: AnalyzeOptions;
  setOptions: (fn: (o: AnalyzeOptions) => AnalyzeOptions) => void;
  rotateRatio: number;
  setRotateRatio: (v: number) => void;
  result: AnalysisResult | null;
}) {
  const t = useT();
  const [nsfwOpen, setNsfwOpen] = useState(false);
  /** Which word's re-file menu is open; one at a time. */
  const [menuWord, setMenuWord] = useState<string | null>(null);
  const refile = (word: string, k: EntityKind | null) => {
    const next = { ...kindOverrides };
    if (k === null) delete next[word]; else next[word] = k;
    setKindOverrides(next);
    setMenuWord(null);
  };
  const setTok = <K extends keyof AnalyzeOptions['tokenize']>(k: K, v: AnalyzeOptions['tokenize'][K]) =>
    setOptions((o) => ({ ...o, tokenize: { ...o.tokenize, [k]: v } }));
  const countOf = (k: EntityKind) => result?.entities.byKind.find((x) => x.kind === k)?.words ?? 0;

  return (
    <>
      <div className="group-label">{t('统计谁的话')}</div>
      <div className="seg">
        {(['user', 'char'] as Role[]).map((r) => (
          <button key={r} type="button" className={options.roles.includes(r) ? 'on' : ''}
            aria-pressed={options.roles.includes(r)}
            onClick={() => setOptions((o) => ({
              ...o, roles: o.roles.includes(r) ? o.roles.filter((x) => x !== r) : [...o.roles, r],
            }))}
          >{roleLabel(t)[r]}</button>
        ))}
      </div>

      {/* Entity kinds. Person names are off by default because they dominate the counts. */}
      <div className="group-label">{t('显示哪几类词')}</div>
      <div className="kinds">
        {KIND_ORDER.map((k) => {
          const on = options.kinds.includes(k);
          const n = countOf(k);
          return (
            <button key={k} type="button" className={`kind${on ? ' on' : ''}`}
              aria-pressed={on}
              title={k === 'person' ? t('人名频率远高于其他词，嫌挤就关掉') : undefined}
              onClick={() => setOptions((o) => ({
                ...o, kinds: on ? o.kinds.filter((x) => x !== k) : [...o.kinds, k],
              }))}
            >
              <span>{tx(ENTITY_LABEL[k])}</span>
              <em>{n}</em>
            </button>
          );
        })}
      </div>

      {/* Which words landed in the person / place / time / common buckets: the counts alone hide what was taken out of the cloud */}
      {result && (['person', 'place', 'time', 'generic'] as EntityKind[]).some((k) => countOf(k) > 0) && (
        <details className="kind-list">
          <summary>{t('看看各类都有哪些词')}</summary>
          {(['person', 'place', 'time', 'generic'] as EntityKind[]).map((k) => {
            const list = result.allWords
              .filter((w) => (kindOverrides[w.text] ?? w.kind) === k && w.count >= options.tokenize.minCount)
              .slice(0, 40);
            if (!list.length) return null;
            return (
              <div key={k} className="kind-list-row">
                <b>{tx(ENTITY_LABEL[k])}</b>
                {/* Each word is a button: the menu moves it to another kind, overriding the core's guess */}
                <span>
                  {list.map((w) => (
                    <span key={w.text} className="kw">
                      <button type="button" className={kindOverrides[w.text] ? 'kw-btn moved' : 'kw-btn'}
                        aria-expanded={menuWord === w.text} title={t('把「{w}」改到别的类', { w: w.text })}
                        onClick={() => setMenuWord(menuWord === w.text ? null : w.text)}>
                        {w.text} {w.count}
                      </button>
                      {menuWord === w.text && (
                        <span className="kw-menu" role="menu">
                          {KIND_ORDER.map((target) => (
                            <button key={target} type="button" role="menuitem"
                              className={(kindOverrides[w.text] ?? w.kind) === target ? 'on' : ''}
                              onClick={() => refile(w.text, target)}>{tx(ENTITY_LABEL[target])}</button>
                          ))}
                          {kindOverrides[w.text] && (
                            <button type="button" role="menuitem" onClick={() => refile(w.text, null)}>{t('取消改动')}</button>
                          )}
                        </span>
                      )}
                    </span>
                  ))}
                  {countOf(k) > list.length ? ` +${countOf(k) - list.length}` : ''}
                </span>
              </div>
            );
          })}
        </details>
      )}
      {Object.keys(kindOverrides).length > 0 && (
        <button type="button" className="field-act kind-reset" onClick={() => setKindOverrides({})}>
          {t('恢复 {n} 个词的原分类', { n: Object.keys(kindOverrides).length })}
        </button>
      )}

      <div className="group-label">{t('词')}</div>
      <Slider label={t('最少几个字')} value={options.tokenize.minLength} min={1} max={4}
        onChange={(v) => setTok('minLength', v)} />
      <Slider label={t("最少出现几次")} value={options.tokenize.minCount} min={1} max={50}
        onChange={(v) => setTok('minCount', v)} format={(v) => t('{n} 次', { n: v })} />
      <Slider label={t("最多显示几个")} value={options.tokenize.maxWords} min={20} max={500} step={10}
        onChange={(v) => setTok('maxWords', v)} />
      <Slider label={t('竖排比例')} value={rotateRatio} min={0} max={1} step={0.05}
        onChange={setRotateRatio} format={(v) => `${Math.round(v * 100)}%`} />

      <label className="check">
        <input type="checkbox" checked={options.tokenize.useStopwords}
          onChange={(e) => setTok('useStopwords', e.target.checked)} />
        <span>{t('去掉「的了是在」这类虚词')}</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={options.tokenize.discoverPhrases}
          onChange={(e) => setTok('discoverPhrases', e.target.checked)} />
        <span>{t('自动认出人名和专有名词')}</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={options.tokenize.useNarrativeStopwords}
          onChange={(e) => setTok('useNarrativeStopwords', e.target.checked)} />
        <span>{t('去掉「看了/站在/点点头」这类叙述套话')}<em>{t('（任何小说里都是高频）')}</em></span>
      </label>

      {/* Explicit words: three-state mode plus category toggles. Detection always runs; this decides what counts. */}
      <div className="seg">
        {(['show', 'hide', 'only'] as const).map((m) => (
          <button key={m} type="button" className={options.nsfwMode === m ? 'on' : ''}
            aria-pressed={options.nsfwMode === m}
            onClick={() => setOptions((o) => ({ ...o, nsfwMode: m }))}
          >{nsfwModeLabel(t)[m]}</button>
        ))}
      </div>
      <button type="button" className="nsfw-toggle" aria-expanded={nsfwOpen} onClick={() => setNsfwOpen((v) => !v)}>
        {nsfwOpen ? t('收起分类') : t('分类')}
      </button>
      {nsfwOpen && (
        <div className="kinds nsfw-kinds">
          {NSFW_KINDS.map((k) => {
            const on = options.nsfwKinds.includes(k);
            const n = result?.nsfwByKind.find((x) => x.kind === k)?.words ?? 0;
            return (
              <button key={k} type="button"
                className={`kind${on ? ' on' : ''}${NSFW_EXPLICIT_KINDS.includes(k) ? '' : ' mild'}`}
                aria-pressed={on}
                onClick={() => setOptions((o) => ({
                  ...o, nsfwKinds: on ? o.nsfwKinds.filter((x) => x !== k) : [...o.nsfwKinds, k],
                }))}
              >
                <span>{nsfwLabel(t)[k]}</span>
                <em>{n}</em>
              </button>
            );
          })}
        </div>
      )}
      {result && result.blocked.total > 0 && (
        <p className="note">{t('禁词表过滤了 {n} 个词', { n: result.blocked.total })}</p>
      )}

      <div className="group-label">{t('清洗')}</div>
      {(options.clean.customRules?.length ?? 0) > 0 && (
        <p className="note">
          {t('已加载 {n} 条正则规则（来自导入的正则脚本、整包或模型）', { n: options.clean.customRules!.length })}
          <button type="button" className="field-act" onClick={() => setOptions((o) => ({ ...o, clean: { ...o.clean, customRules: [] } }))}>{t('清除')}</button>
        </p>
      )}
      <label className="check">
        <input type="checkbox" checked={options.clean.stripCustomTags}
          onChange={(e) => setOptions((o) => ({ ...o, clean: { ...o.clean, stripCustomTags: e.target.checked } }))} />
        <span>{t('删掉插件写进正文的状态栏、变量块、网页代码')}</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={options.clean.stripStructuredLines}
          onChange={(e) => setOptions((o) => ({ ...o, clean: { ...o.clean, stripStructuredLines: e.target.checked } }))} />
        <span>{t('删掉表格行')}</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={options.includeAllSwipes}
          onChange={(e) => setOptions((o) => ({ ...o, includeAllSwipes: e.target.checked }))} />
        <span>{t('把重生过的其他版本也算进去')}</span>
      </label>
    </>
  );
}


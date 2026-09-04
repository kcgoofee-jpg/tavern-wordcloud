import type { DataBundle } from '../core/bundle';
import { useT, tx } from './i18n';
import type { CharacterGroup, ChatMeta } from '../core/meta';
import type { AnalysisResult } from '../core/types';
import Icon from './Icons';
import Note from './Note';

const fmtDate = (s: string | null) => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(+d) ? s.slice(0, 16).replace('T', ' ') : d.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
};

/**
 * Bottom-left card: whose chat this is, what it contains, and which part to view.
 * The panel floats above the button (absolute positioning) so the button does not
 * move and works as the close control.
 */
export default function CardInfo({
  meta, bundle, groups, perSource, accent, onlyCharacter, setOnlyCharacter, open, setOpen, stats,
}: {
  meta: ChatMeta;
  /** Per-file totals; the bar shows cleaned / raw characters. */
  perSource: AnalysisResult['perSource'];
  accent: string;
  /** Message / cleaning / vocabulary figures, moved here from the dock (user decision 2026-09-04). */
  stats?: { messages: number; total: number; noise: number; unique: number };
  /** Full-export extras: preset name, world info. */
  bundle: Omit<DataBundle, 'chats'> | null;
  groups: CharacterGroup[];
  onlyCharacter: string | null;
  setOnlyCharacter: (c: string | null) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  const t = useT();
  const rows: [string, string][] = [];
  // The preset name is only available from a full .zip export
  if (bundle?.presetName) rows.push([t('预设'), bundle.presetName]);
  if (bundle?.sysPromptName) rows.push([t('系统提示词'), bundle.sysPromptName]);
  if (bundle?.worlds.length) {
    rows.push([t('世界书库'), t('{books} 本 · {words} 个词已用作词典', { books: bundle.worlds.length, words: bundle.worldKeywords.length })]);
  }
  if (meta.models.length) rows.push([t('模型'), meta.models.join(' / ')]);
  if (meta.apis.length) rows.push([t('接口'), meta.apis.join(' / ')]);
  if (meta.worldInfo) rows.push([bundle?.worlds.length ? t('本聊天用的') : t('世界书'), meta.worldInfo]);
  if (meta.authorNote) rows.push([t('作者注'), meta.authorNote.slice(0, 60)]);
  rows.push([t('消息'), t('{all} 条（我 {mine} · 角色 {theirs}）', { all: meta.messages, mine: meta.userMessages, theirs: meta.charMessages })]);
  rows.push([t('字数'), t('{raw}k → 清洗后 {clean}k', { raw: (meta.rawChars / 1000).toFixed(1), clean: (meta.cleanChars / 1000).toFixed(1) })]);
  if (meta.swipeRate > 0) rows.push([t('重新生成'), t('{pct}% 的回复', { pct: Math.round(meta.swipeRate * 100) })]);
  if (meta.avgGenSeconds != null) rows.push([t('平均生成'), t('{sec} 秒', { sec: meta.avgGenSeconds.toFixed(1) })]);
  const started = fmtDate(meta.startedAt);
  const ended = fmtDate(meta.endedAt);
  if (started) rows.push([t('开始于'), started]);
  if (ended && ended !== started) rows.push([t('最后一条'), ended]);

  const multi = groups.length > 1;

  /** Card names come from user files; the two synthetic fallbacks are dictionary entries. */
  const charName = (name: string) => {
    // i18n-exempt: parses the synthetic name analyze.ts builds for multi-card imports
    const m = /^(\d+) 张角色卡$/.exec(name);
    return m ? t('{n} 张角色卡', { n: m[1] }) : tx(name);
  };

  return (
    <div className={`cardinfo${open ? ' open' : ''}`}>
      {/* Floats above the button; the button stays put and closes the panel */}
      <div className="cardinfo-body" hidden={!open}>
        {stats && (
          <div className="card-stats" role="status">
            <span title={t('统计了 {kept} 条消息，共 {all} 条', { kept: stats.messages, all: stats.total })}>
              <Icon name="speaker" size={14} />{t('{n} 条', { n: stats.messages })}
            </span>
            <span title={t('清洗掉的插件内容占原文的比例')}>
              <Icon name="trash" size={14} />{t('清洗 {p}%', { p: Math.round(stats.noise) })}
            </span>
            <span title={t('{n} 个不重复词', { n: stats.unique })}>
              <Icon name="list" size={14} />{t('{u} 词', { u: stats.unique })}
            </span>
          </div>
        )}
        {multi && (
          <>
            {/* "Merge all" is the reset button in the header, not a list item: it is the default, not a card. */}
            <div className="group-label">
              {t('看哪张角色卡')}
              <button type="button" className="mini-reset" title={t("回到全部合并")}
                disabled={onlyCharacter === null} onClick={() => setOnlyCharacter(null)}>
                <Icon name="reset" size={13} />
              </button>
            </div>
            <div className="seg vertical">
              {groups.map((g) => (
                <button key={g.character} type="button" className={onlyCharacter === g.character ? 'on' : ''}
                  title={t('{name} · {msgs} 条 · {files} 个聊天', { name: charName(g.character), msgs: g.meta.messages, files: g.files.length })}
                  onClick={() => setOnlyCharacter(onlyCharacter === g.character ? null : g.character)}>
                  <span className="ell">{charName(g.character)}</span>
                  <em>{t('{msgs} 条 · {files} 个', { msgs: g.meta.messages, files: g.files.length })}</em>
                </button>
              ))}
            </div>
            <div className="group-label">{t('当前这张')}</div>
          </>
        )}

        {/* The provenance caveat is a footnote, not a paragraph: it lives behind the (i) on the list it qualifies. */}
        <div className="group-label">
          {t('这份记录')}
          <Note>{bundle
            ? t('来自整包导出。世界书关键词已用作专名词典。')
            : t('预设和世界书不在单个聊天文件里，传整包 .zip 才有。')}</Note>
        </div>
        <dl>
          {/* Index keys: labels can repeat (a world-info library and the chat's own world info) */}
          {rows.map(([k, v], i) => (
            // One line per row; long preset / model names are truncated with the full text on hover
            <div key={`${i}-${k}`} style={{ animationDelay: `${Math.min(i, 12) * 22}ms` }}>
              <dt title={k}>{k}</dt><dd title={v}>{v}</dd>
            </div>
          ))}
        </dl>
        {perSource.length > 1 && (
          <>
            <div className="group-label">{t('各聊天文件的消息数')}</div>
            <ul className="srclist">
              {perSource.map((sp) => (
                <li key={sp.source}>
                  <span className="src-name" title={sp.source}>{sp.source.replace(/\.(jsonl|json|txt)$/i, '')}</span>
                  <span className="src-num">{t('{n} 条', { n: sp.messages })}</span>
                  <span className="src-bar" title={t('原文 {raw} 字，清洗后 {clean} 字', { raw: sp.rawChars, clean: sp.cleanChars })}>
                    <i style={{ width: `${(sp.cleanChars / Math.max(1, sp.rawChars)) * 100}%`, background: accent }} />
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

      </div>

      <button type="button" className="cardinfo-head" onClick={() => setOpen(!open)}
        aria-expanded={open} title={open ? t('收起') : (multi ? t('切换角色卡 · 看详情') : t('看详情'))}>
        <Icon name="card" size={17} />
        <span className="cardinfo-name">{charName(meta.character)}</span>
        <span className="cardinfo-caret"><Icon name="caret" size={14} /></span>
      </button>
    </div>
  );
}

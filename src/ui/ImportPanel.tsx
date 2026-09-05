import type { AnalyzeOptions } from '../core/analyze';
import { tenK, useT } from './i18n';
import type { DataBundle } from '../core/bundle';
import { KindBucketToggles } from './KindGroups';
import type { Role } from '../core/types';
import Icon from './Icons';
import Note from './Note';
import Progress from './Progress';
import { hostOf } from './url';
import { MAX_UPLOAD_BYTES } from '../net/server';

/** The hosted server hands out the same single-file build (server/index.ts `/download/index.html`). */
const LOCAL_BUILD = '/download/index.html';

/**
 * Confirmation panel before analyzing a large import: reports what was read,
 * lets the user change the options that require a re-run, and shows progress.
 * Small imports skip it.
 */

export interface ImportSummary {
  fileCount: number;
  /** Total characters, for the time estimate */
  chars: number;
  /**
   * Bytes the request body will actually weigh: what `JSON.stringify` produces, which
   * is what the server measures. Character count × 3 used to stand in for it and was
   * wrong in both directions — JSON escaping alone doubles a `.jsonl` (5 MB → 10.47 MB,
   * notes/docs/31 §10.5), while plain ASCII is 1 byte per character, not 3.
   */
  uploadBytes: number;
  characters: string[];
  bundle: Omit<DataBundle, 'chats'> | null;
  fromZip: boolean;
}

/** A function of `t` so labels are literal `t('…')` calls. */
const roleLabel = (t: (s: string) => string): Record<Role, string> =>
  ({ user: t('我说的'), char: t('角色说的'), system: '' });
/** The `system` kind is not offered here: it is always 0 words in practice. It is still detected and filtered in core. */
/** Import uses the ops buckets; the 44 fine kinds stay in the filter panel's 「详细」 view. */

/** Rough tokenization time estimate: ~40k chars/s locally; with a model, ~3 s per chunk, `concurrency` chunks in parallel. */
function estimate(chars: number, ai: AnalyzeOptions['ai'] | null, t: (s: string, v?: Record<string, string | number>) => string): string {
  if (ai) {
    const chunks = Math.ceil(chars / ai.chunkChars);
    const sec = Math.ceil(chunks / Math.max(1, ai.concurrency)) * 3;
    return sec > 90
      ? t('约 {n} 分钟（{c} 次请求）', { n: Math.round(sec / 60), c: chunks })
      : t('约 {n} 秒（{c} 次请求）', { n: sec, c: chunks });
  }
  const sec = chars / 40000;
  return sec < 1 ? t('不到 1 秒') : t('约 {n} 秒', { n: sec.toFixed(1) });
}

export default function ImportPanel({
  summary, options, setOptions, busy, progress, onStart, onCancel, onConfigureAi, contribute, hasServer, load, mode, maxBytes,
  cardRuleApplied, cardRuleWeak, onUndoCardRule,
}: {
  /** On by default; only a notice on import, switchable in the community panel */
  contribute: boolean;
  /** True when this page is served with a working API: text is uploaded for processing. */
  hasServer: boolean;
  /** Server load from /api/health; `full` means everything queues, so the local edition is offered first. */
  load?: 'ok' | 'busy' | 'full';
  /** Operating mode from /api/health; `maintenance` means the server will refuse the analysis. */
  mode?: 'normal' | 'limited' | 'maintenance';
  /** The cap this server enforces right now; limited mode halves it. Falls back to the built-in value. */
  maxBytes?: number;
  summary: ImportSummary;
  options: AnalyzeOptions;
  setOptions: (fn: (o: AnalyzeOptions) => AnalyzeOptions) => void;
  busy: boolean;
  progress: { done: number; total: number; label: string } | null;
  onStart: () => void;
  onCancel: () => void;
  /** Render with default tokenization first, then open the endpoint panel */
  onConfigureAi: () => void;
  /** Card rule packs (notes/docs/23): how many overrides/stopwords a saved pack for this card just auto-applied. Null/0 shows nothing. */
  cardRuleApplied?: number | null;
  /**
   * True when only the weak (name-only) fingerprint matched: the pack may have been saved for a
   * different card that happens to share this name, so the note says "a card with the same name"
   * rather than "this card" and points at the undo.
   */
  cardRuleWeak?: boolean;
  /** One-click undo for the note above. */
  onUndoCardRule?: () => void;
}) {
  const t = useT();
  // The server publishes the cap it is enforcing; the built-in value is only a fallback for
  // an older server that does not send one.
  const cap = maxBytes ?? MAX_UPLOAD_BYTES;
  const mb = (b: number) => String(Math.round(b / (1024 * 1024)));
  const aiOn = options.ai.enabled && !!options.ai.endpoint && !!options.ai.model;

  return (
    <div className="import-veil" role="dialog" aria-label={t("导入")}>
      <div className="import-card">
        <div className="import-head">
          <span className="import-title">{t('读到了这些')}</span>
          <button type="button" className="sheet-close" title={t("取消")} onClick={onCancel}>
            <Icon name="close" size={17} />
          </button>
        </div>

        <div className="import-body">
          {/* What was read */}
          <ul className="found">
            <li><Icon name="files" size={15} /><b>{summary.fileCount}</b> {t('份聊天记录')}</li>
            <li>
              <Icon name="card" size={15} />
              <b>{summary.characters.length}</b> {t('张角色卡')}
              <em>{summary.characters.slice(0, 3).join(' · ')}{summary.characters.length > 3 ? ' …' : ''}</em>
            </li>
            <li><Icon name="list" size={15} /><b>{tenK(summary.chars)}</b> {t('万字')}</li>
            {summary.bundle?.worlds.length ? (
              <li>
                <Icon name="check" size={15} />
                <b>{summary.bundle.worlds.length}</b> {t('本世界书')}
                <em>{t('其中的 {n} 个关键词将用作专名词典', { n: summary.bundle.worldKeywords.length })}</em>
              </li>
            ) : null}
            {summary.bundle?.presetName ? (
              <li><Icon name="chip" size={15} />{t('预设')} <em>{summary.bundle.presetName}</em></li>
            ) : null}
            {summary.fromZip && !summary.bundle?.worlds.length ? (
              <li className="dim"><Icon name="alert" size={15} />{t('这个包里没有世界书')}</li>
            ) : null}
          </ul>

          {!!cardRuleApplied && (
            <p className="note">
              {cardRuleWeak
                ? t('有一张同名的卡保存过 {n} 条修正，已先套用；如果不是同一张卡，可以撤销。', { n: cardRuleApplied })
                : t('这张卡有你之前保存的 {n} 条修正，已自动套用。', { n: cardRuleApplied })}
              <button type="button" className="field-act" onClick={onUndoCardRule}>{t('撤销本次套用')}</button>
            </p>
          )}

          {/* Only the options that require a re-run */}
          <div className="group-label">
            {t('统计谁的话')}
            <Note>{t('系统消息是酒馆自己插进对话流的提示（「聊天已清空」「已切换角色」、斜杠命令的回显），和剧情无关，默认不选。')}</Note>
          </div>
          <div className="seg">
            {(['user', 'char'] as Role[]).map((r) => (
              <button key={r} type="button" className={options.roles.includes(r) ? 'on' : ''}
                onClick={() => setOptions((o) => ({
                  ...o, roles: o.roles.includes(r) ? o.roles.filter((x) => x !== r) : [...o.roles, r],
                }))}>{roleLabel(t)[r]}</button>
            ))}
          </div>

          <div className="group-label">
            {t('显示哪几类词')}
            <Note>{t('人名几乎每句都出现，频率远高于其他词；嫌它们占满词云就关掉「人物」。地点和时间按句法位置识别，可能有漏判。')}</Note>
          </div>
          <KindBucketToggles
            value={options.kinds}
            onChange={(kinds) => setOptions((o) => ({ ...o, kinds }))}
          />

          <div className="seg vertical">
            <button type="button" className={!aiOn ? 'on' : ''}
              onClick={() => setOptions((o) => ({ ...o, ai: { ...o.ai, enabled: false } }))}>
              {t('默认分词')} <em>{estimate(summary.chars, null, t)}</em>
            </button>
            <button type="button" className={aiOn ? 'on' : ''}
              disabled={!options.ai.endpoint || !options.ai.model}
              onClick={() => setOptions((o) => ({ ...o, ai: { ...o.ai, enabled: true } }))}>
              {options.ai.endpoint && options.ai.model ? t('大模型（{model}）', { model: options.ai.model }) : t('大模型分词（还没配置）')}
              <em>{options.ai.endpoint && options.ai.model ? estimate(summary.chars, options.ai, t) : t('要先填接口地址、模型和密钥')}</em>
            </button>
          </div>
          {!(options.ai.endpoint && options.ai.model) && (
            <p className="note">
              {t('想改用大模型分词：先直接出图，之后点左侧 🔑 填好接口，在接口面板里点『用大模型重新分词』即可。')}
              <button type="button" className="field-act" onClick={onConfigureAi}>{t('去填接口')}</button>
            </p>
          )}
          {aiOn && (
            <p className="note warn-note">
              {t('⚠ 正文会分成 {times} 块发到 {host}（每块 {chunk} 字）。仅用于分词，本站不留存。', {
                host: hostOf(options.ai.endpoint),
                chunk: options.ai.chunkChars,
                times: Math.ceil(summary.chars / options.ai.chunkChars),
              })}
              <Note>{t('大模型切词和本地在人名上一样准，差别在机构名、职务名和有歧义的句子。代价是要等几分钟、花 token。想让模型挑词而不是切词，用顶上的「关键词」模式，一次请求就够。')}</Note>
            </p>
          )}
          {contribute && hasServer && <p className="note">{t('匿名统计（高频词、条数字数，不含正文、不含角色卡名）会计入社区排行榜。请仅在您有权分享这份记录的统计时参与；不想参与，在「社区排行榜」面板里关掉。')}</p>}
          <p className="note disclaimer">
            {hasServer ? t('上传即表示你有权使用这些记录并用于分析。服务器不保存正文，处理完即丢弃；结果仅供参考。')
              : t('上传即表示你有权使用这些记录并用于分析。所有处理都在这台电脑上完成，不出网；结果仅供参考。')}
            {' '}<a href="#/disclaimer">{t('《免责声明》')}</a>{' '}<a href="#/privacy">{t('《隐私政策》')}</a>
          </p>
        </div>

        <div className="import-foot">
          {/* Measured on the serialized body, the same number the server caps (notes/docs/31 §6/§10.5). */}
          {!busy && hasServer && summary.uploadBytes > cap && (
            <p className="note warn-note import-busy">
              {t('网页版上限 {cap} MB，这份传上去有 {size} MB。上限按序列化后真正发出去的字节算，不是文件在硬盘上显示的大小。下载本地版可以在你自己的电脑上算，多大都行。',
                { cap: mb(cap), size: (summary.uploadBytes / (1024 * 1024)).toFixed(1) })}
              <a className="field-act" href={LOCAL_BUILD} download>{t('下载本地版')}</a>
            </p>
          )}
          {/* Said before the run, not after the server refuses it: limited mode halves the cap. */}
          {!busy && hasServer && mode === 'limited' && summary.uploadBytes <= cap && (
            <p className="note warn-note import-busy">
              {t('服务器正在限流：上传上限暂时降到 {cap} MB，一次只跑一个分析，排队会更久。下载本地版不受影响。', { cap: mb(cap) })}
              <a className="field-act" href={LOCAL_BUILD} download>{t('下载本地版')}</a>
            </p>
          )}
          {!busy && hasServer && mode === 'maintenance' && (
            <p className="note warn-note import-busy">
              {t('网站正在维护，服务器暂时不能分析。下载本地版可以在自己电脑上算，功能一样。')}
              <a className="field-act" href={LOCAL_BUILD} download>{t('下载本地版')}</a>
            </p>
          )}
          {!busy && hasServer && load === 'full' && (
            <p className="note warn-note import-busy">
              {t('现在访问的人多，分析要排队。下载本地版可以立刻算，而且不用上传。')}
              <a className="field-act" href={LOCAL_BUILD} download>{t('下载本地版')}</a>
            </p>
          )}
          {busy ? (
            <div className="import-progress">
              <Progress done={progress?.done} total={progress?.total} label={progress?.label ?? t('处理中')} inline />
            </div>
          ) : (
            <button type="button" className="import-go" onClick={onStart}>
              {t('开始')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

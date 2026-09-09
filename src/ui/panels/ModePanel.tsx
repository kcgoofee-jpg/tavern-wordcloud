import { useT } from '../i18n';
import type { CloudMode } from '../settings';

/**
 * Cloud mode (2026-09-08). This used to be a segmented switch pinned to the top centre of the
 * canvas (`.cloudmode`); it now lives in the rail like every other tool, and the rail button's
 * icon is the current mode. Switching modes never sends a request — keyword mode has its own
 * run action, which is the button at the bottom of this panel.
 *
 * The endpoint is not configured here: picking 关键词 without one opens the endpoint panel,
 * exactly as the old switch did.
 */
export function ModePanel({
  keywordMode, aiReady, aiMissing, model, busy, canRun, onMode, onRun,
}: {
  keywordMode: boolean;
  aiReady: boolean;
  /** Which endpoint field is still empty; named in the tooltip, never printed beside the label. */
  aiMissing: 'endpoint' | 'model' | 'key' | null;
  model: string;
  busy: boolean;
  /** A curation can only run once there is a local analysis to hang the counts on. */
  canRun: boolean;
  onMode: (m: CloudMode) => void;
  onRun: () => void;
}) {
  const t = useT();
  const freqNote = t('统计出现最多的词。免费、半秒出结果');
  const keywordNote = aiReady
    ? t('让大模型读完整份聊天，挑出这个故事独有的词。整份正文会发给你配的接口')
    : aiMissing === 'endpoint' ? t('还没填接口地址——点一下去配')
      : aiMissing === 'model' ? t('还没选模型——点一下去配')
        : aiMissing === 'key' ? t('还没填密钥——点一下去配') : t('还没配接口——点一下去配');

  return (
    <>
      {/* The full explanation is the title: a segmented control never wraps (05-controls.css). */}
      <div className="seg vertical" role="group" aria-label={t('词云模式')}>
        <button type="button" className={!keywordMode ? 'on' : ''} aria-pressed={!keywordMode}
          title={freqNote} onClick={() => onMode('freq')}>
          <span className="ell">{t('词频')}</span>
          <em>{freqNote}</em>
        </button>
        <button type="button" className={keywordMode ? 'on' : ''} aria-pressed={keywordMode}
          title={keywordNote} onClick={() => onMode('keyword')}>
          <span className="ell">{t('关键词')}</span>
          <em>{keywordNote}</em>
        </button>
      </div>

      {/* Keyword mode's run action: one request over the whole log, so it is never automatic. */}
      {keywordMode && (
        <button type="button" className="more" disabled={!canRun || busy} onClick={onRun}>
          {busy ? t('正在跑…') : t('让 {model} 读完整份聊天挑词', { model })}
        </button>
      )}
    </>
  );
}

import { useEffect } from 'react';
import { useT } from './i18n';
import Icon from './Icons';

/**
 * In-app confirmation before sending feedback (replaces window.confirm).
 * Shows the full snippets and the payload size; confirm sends, cancel closes
 * without sending — same semantics as the confirm() dialog it replaces.
 */
export default function ConfirmDialog({
  word, snippets, onConfirm, onCancel,
}: {
  word: string;
  snippets: string[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  /** What is sent, in characters: the word plus its context snippets. */
  const chars = word.length + snippets.reduce((a, s) => a + s.length, 0);

  // Escape cancels. Capture phase + stopPropagation so the panel underneath stays open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onCancel();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  return (
    <div className="confirm-veil" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="confirm-card" role="dialog" aria-modal="true" aria-label={t('提交反馈')}>
        <div className="confirm-head">
          <span className="confirm-title">{t('提交反馈')}</span>
          <button type="button" className="sheet-close" title={t('取消')} onClick={onCancel}>
            <Icon name="close" size={17} />
          </button>
        </div>
        <div className="confirm-body">
          <p className="note">{t('提交反馈：这个词和下面的片段会发给站方，由 AI 处理后更新清洗规则。')}</p>
          <p className="confirm-word">{word}</p>
          {snippets.map((s, i) => <blockquote key={i} className="confirm-snippet">…{s}…</blockquote>)}
        </div>
        <div className="confirm-foot">
          <span className="confirm-size">{t('将发送 {n} 字', { n: chars })}</span>
          <button type="button" className="confirm-btn" onClick={onCancel}>{t('取消')}</button>
          <button type="button" className="confirm-btn primary" onClick={onConfirm}>{t('发送')}</button>
        </div>
      </div>
    </div>
  );
}

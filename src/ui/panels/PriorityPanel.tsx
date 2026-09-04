import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n';

const MAX = 50;

/** Counts the items the user typed, before the 50-item cap, so the counter can go past 50. */
function countItems(input: string): number {
  const seen = new Set<string>();
  for (const raw of input.split(/[;；]/)) {
    const item = raw.replace(/　/g, ' ').trim();
    if (!item) continue;
    seen.add(item.toLowerCase());
  }
  return seen.size;
}

/**
 * Priority words: the words the user wants biggest, in order. One textarea; typing writes
 * `settings.priority` after a 300 ms pause so every keystroke does not re-layout the cloud.
 */
export function PriorityPanel({
  value, setValue,
}: {
  value: string;
  setValue: (v: string) => void;
}) {
  const t = useT();
  const [text, setText] = useState(value);
  // Follow external changes (the reset button) without clobbering what is being typed.
  const typed = useRef(false);
  useEffect(() => {
    if (!typed.current) setText(value);
  }, [value]);
  useEffect(() => {
    if (text === value) return;
    const id = window.setTimeout(() => { typed.current = false; setValue(text); }, 300);
    return () => window.clearTimeout(id);
  }, [text, value, setValue]);

  const n = useMemo(() => countItems(text), [text]);
  const over = n > MAX;

  return (
    <label className="field priority-field">
      <span>{t('优先显示这些词')}<em>{t('用分号隔开，越靠前越大')}</em></span>
      <textarea
        className="priority-input" rows={2} value={text} aria-label={t('优先词')}
        placeholder={t('沈砚秋；排练厅；通告单')}
        onChange={(e) => { typed.current = true; setText(e.target.value); }} />
      <span className={`priority-count${over ? ' over' : ''}`}
        title={over ? t('只取前 50 个') : undefined}>{n}/{MAX}</span>
    </label>
  );
}

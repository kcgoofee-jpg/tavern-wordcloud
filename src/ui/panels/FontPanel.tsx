import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { FONT_STACKS, ensureGoogleFont, type FontKey } from '../../theme/fonts';
import {
  type FontChoice, } from '../../theme/themes';
import { deleteCustomFont, importCustomFont, listCustomFonts, type CustomFontError } from '../../theme/customFonts';
import Icon from '../Icons';

const fonts = (t: (s: string) => string): { id: FontKey; label: string; weight: string; tracking: number; note: string }[] => [
  { id: 'sans', label: t('黑体'), weight: '600', tracking: 0, note: t('系统默认') },
  { id: 'serif', label: t('宋体'), weight: '600', tracking: -0.01, note: t('正文感') },
  { id: 'rounded', label: t('楷体'), weight: '600', tracking: 0, note: t('文学感') },
  { id: 'palatino', label: t('衬线'), weight: '700', tracking: -0.02, note: t('西文衬线') },
  { id: 'mono', label: t('等宽'), weight: '500', tracking: 0, note: t('数据感') },
  { id: 'tc-sans', label: t('繁黑体'), weight: '600', tracking: 0, note: t('繁体友好') },
  { id: 'tc-serif', label: t('繁宋体'), weight: '600', tracking: -0.01, note: t('繁体友好') },
];

export function FontPanel({
  font, setFont, traditional, setTraditional,
}: {
  font: FontChoice; setFont: (f: FontChoice) => void;
  traditional: boolean; setTraditional: (v: boolean) => void;
}) {
  const t = useT();
  const [customFonts, setCustomFonts] = useState<string[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listCustomFonts().then(setCustomFonts).catch(() => {});
  }, []);

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportError(null);
    try {
      const name = await importCustomFont(file);
      setCustomFonts((prev) => (prev.includes(name) ? prev : [...prev, name]));
      setFont({ cloud: name, weight: '600', tracking: 0, custom: true });
    } catch (err) {
      const ce = err as CustomFontError;
      if (ce?.code === 'too-large') setImportError(t('字体文件超过 10 MB，已跳过'));
      else setImportError(t('字体文件损坏，无法读取，已保留原字体'));
    }
  };

  const onDeleteCustom = async (name: string) => {
    await deleteCustomFont(name);
    setCustomFonts((prev) => prev.filter((n) => n !== name));
    if (font.custom && font.cloud === name) {
      setFont({ cloud: 'sans', weight: '600', tracking: 0 });
    }
  };

  return (
    <>
      {/* No heading: two buttons labelled 简 / 繁 say what they do. */}
      <div className="seg seg-lead" role="group" aria-label={t('繁体显示')}>
        <button type="button" className={!traditional ? 'on' : ''} aria-pressed={!traditional} onClick={() => setTraditional(false)}>
          {t('简')}
        </button>
        <button type="button" className={traditional ? 'on' : ''} aria-pressed={traditional} onClick={() => setTraditional(true)}>
          {t('繁')}
        </button>
      </div>

      <div className="fontlist">
        {fonts(t).map((f) => (
          <button
            key={f.id}
            type="button"
            className={`fontcard${!font.custom && font.cloud === f.id ? ' on' : ''}`}
            onClick={() => {
              ensureGoogleFont(f.id);
              setFont({ cloud: f.id, weight: f.weight, tracking: f.tracking });
            }}
          >
            <span className="fontcard-sample" style={{ fontFamily: FONT_STACKS[f.id], fontWeight: f.weight }}>
              {t('沈砚秋 Aa 42')}
            </span>
            <span className="fontcard-meta">
              <b>{f.label}</b>
              <em>{f.note}</em>
            </span>
            {!font.custom && font.cloud === f.id && <Icon name="check" size={14} />}
          </button>
        ))}
        {customFonts.map((name) => (
          <button
            key={name}
            type="button"
            className={`fontcard${font.custom && font.cloud === name ? ' on' : ''}`}
            onClick={() => setFont({ cloud: name, weight: '600', tracking: 0, custom: true })}
          >
            <span className="fontcard-sample" style={{ fontFamily: `"${name}"` }}>
              {t('沈砚秋 Aa 42')}
            </span>
            <span className="fontcard-meta">
              <b>{name}</b>
              <em>{t('自定义')}</em>
            </span>
            {font.custom && font.cloud === name && <Icon name="check" size={14} />}
            <span
              role="button"
              tabIndex={0}
              className="fontcard-del"
              title={t('删除自定义字体')}
              onClick={(e) => { e.stopPropagation(); onDeleteCustom(name); }}
              onKeyDown={(e) => {
                // Nested inside the font card's <button>, so it cannot be a <button> itself;
                // Enter/Space have to be wired by hand.
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault(); e.stopPropagation(); onDeleteCustom(name);
              }}
            >
              <Icon name="close" size={12} />
            </span>
          </button>
        ))}
      </div>

      <div className="fontimport">
        <button
          type="button"
          className="icon-btn"
          title={t('导入字体文件')}
          onClick={() => fileInputRef.current?.click()}
        >
          <Icon name="upload" size={16} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".ttf,.otf,.woff,.woff2"
          hidden
          onChange={onPickFile}
        />
        {importError && <span className="fontimport-error">{importError}</span>}
      </div>

      <label className="slider">
        <span className="slider-label">{t('字距')}</span>
        <input
          type="range" min={-0.04} max={0.06} step={0.005} value={font.tracking}
          onChange={(e) => setFont({ ...font, tracking: Number(e.target.value) })}
        />
        <b>{font.tracking > 0 ? '+' : ''}{(font.tracking * 100).toFixed(0)}</b>
      </label>
      <label className="slider">
        <span className="slider-label">{t('字重')}</span>
        <input
          type="range" min={300} max={800} step={100} value={Number(font.weight)}
          onChange={(e) => setFont({ ...font, weight: e.target.value })}
        />
        <b>{font.weight}</b>
      </label>

    </>
  );
}

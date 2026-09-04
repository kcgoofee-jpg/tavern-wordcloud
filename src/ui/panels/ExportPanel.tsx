import { useContext, useEffect, useRef, useState } from 'react';
import { LangContext, useT } from '../i18n';
import type { ExportBg, ExportFormat, ExportOpts } from '../settings';
import { MAX_EXPORT_PX, NAME_VARS, SIZE_PRESETS, outputSize, tooLarge, type PaintOpts } from '../export';
import { PLATFORM_PRESETS } from '../exportPresets';
import { readHiddenWatermark, type WatermarkPos } from '../watermark';
import { useIsNarrow } from '../hooks/useIsNarrow';
import Icon from '../Icons';
import Note from '../Note';
import Slider from './Slider';

/** Thumbnail bounds in CSS pixels. Portrait exports would otherwise push the controls off screen. */
const PREVIEW_W = 232;
const PREVIEW_H = 150;
/** On a phone the panel is the whole screen, so the thumbnail gives up most of its height. */
const PREVIEW_H_NARROW = 60;

const CORNERS: readonly WatermarkPos[] = ['tl', 'tr', 'bl', 'br'];

/**
 * Export panel. Seven groups, top to bottom: format, size, background, contents,
 * watermark, data and file name. Everything writes into `settings.exportOpts` (reset
 * scope `export`); the actions are passed in, so the panel never touches the canvas or
 * the analysis result itself.
 *
 * Below 640 px the panel renders as a full-screen page (`.sheet.fullscreen` in App)
 * and the size presets become a scrollable chip row instead of a dropdown.
 */
export function ExportPanel({
  opts, setOpts, size, all, paint, onPng, onCsv, onJson, onCopy, copied,
}: {
  opts: ExportOpts;
  setOpts: (o: ExportOpts) => void;
  /** On-screen canvas size in device pixels; preset sizes are a multiple of it. */
  size: { w: number; h: number };
  /** Every counted word: the CSV slider's ceiling. */
  all: number;
  /** Draws the frozen cloud into the thumbnail; absent in tests and before the first layout. */
  paint?: (canvas: HTMLCanvasElement, o: PaintOpts) => boolean;
  onPng: () => void;
  /** Absent when there is no analysis result (shared clouds have words but no table). */
  onCsv?: () => void;
  onJson?: () => void;
  onCopy?: () => void;
  copied?: boolean;
}) {
  const t = useT();
  const lang = useContext(LangContext);
  const narrow = useIsNarrow();
  const set = <K extends keyof ExportOpts>(k: K, v: ExportOpts[K]) => setOpts({ ...opts, [k]: v });
  const out = outputSize(size, opts);
  const over = tooLarge(out);
  const ratio = size.h > 0 ? size.w / size.h : 16 / 9;
  const png = opts.format === 'png';
  const svg = opts.format === 'svg';

  /** Custom width/height, keeping the canvas aspect ratio when the lock is on. */
  const setSide = (side: 'w' | 'h', raw: number) => {
    const v = Math.max(1, Math.min(MAX_EXPORT_PX, Math.round(raw || 0)));
    if (!opts.lockRatio) { setOpts({ ...opts, [side === 'w' ? 'customW' : 'customH']: v }); return; }
    setOpts({
      ...opts,
      customW: side === 'w' ? v : Math.max(1, Math.round(v * ratio)),
      customH: side === 'h' ? v : Math.max(1, Math.round(v / ratio)),
    });
  };

  /** Picking any preset switches to custom and writes its literal pixel size. */
  const applyPreset = (w: number, h: number) => setOpts({ ...opts, sizeMode: 'custom', customW: w, customH: h });

  const previewRef = useRef<HTMLCanvasElement>(null);
  const previewH = narrow ? PREVIEW_H_NARROW : PREVIEW_H;
  // The thumbnail is the export, drawn small: same paint(), same frozen pose, same options
  useEffect(() => {
    const el = previewRef.current;
    if (!el || !paint) return;
    const k = Math.min(PREVIEW_W / out.w, previewH / out.h, 1);
    paint(el, {
      width: Math.max(1, Math.round(out.w * k)),
      height: Math.max(1, Math.round(out.h * k)),
      bg: opts.bg,
      bgColor: opts.bgColor,
      radius: opts.radius * k,
      // Left out of the thumbnail on purpose: both are unreadable at this size
      watermark: null,
      qr: null,
    });
  }, [paint, out.w, out.h, opts.bg, opts.bgColor, opts.radius, previewH]);

  const presetLabel = (id: (typeof SIZE_PRESETS)[number]['id']) =>
    id === 'hd' ? t('16:9 宽屏')
      : id === 'classic' ? t('4:3 传统')
        : id === 'a4' ? t('A4 300dpi')
          : id === 'phone' ? t('手机壁纸') : t('社交方图');

  /** Verify button: read whichever hidden watermark a picked file still carries. */
  const fileRef = useRef<HTMLInputElement>(null);
  const [verdict, setVerdict] = useState<string | null>(null);
  const verify = async (file: File | undefined) => {
    if (!file) return;
    const found = await readHiddenWatermark(file);
    setVerdict(found ?? t('这张图里没有隐藏水印'));
  };

  const chosen = (w: number, h: number) => opts.sizeMode === 'custom' && opts.customW === w && opts.customH === h;

  return (
    <div className={`export-panel${narrow ? ' fullscreen' : ''}`}>
      <div className="export-preview">
        <canvas ref={previewRef} className="export-preview-canvas" aria-hidden="true" />
        <p className="export-size" aria-live="polite">
          {t('{w} × {h} 像素', { w: out.w, h: out.h })}
        </p>
      </div>

      <div className="group-label">{t('格式')}</div>
      <div className="seg" role="group" aria-label={t('格式')}>
        {(['png', 'jpg', 'webp', 'svg'] as const).map((f) => (
          <button key={f} type="button" className={opts.format === f ? 'on' : ''} aria-pressed={opts.format === f}
            onClick={() => set('format', f as ExportFormat)}>{f.toUpperCase()}</button>
        ))}
      </div>
      {svg && (
        <p className="export-size">
          {t('SVG 用系统字体渲染，换机器可能字形不同；要像素级一致请用 PNG')}
        </p>
      )}

      {/* Vector scales without loss, so the resolution multiplier is meaningless for SVG. */}
      {!svg && <>
      <div className="group-label">{t('尺寸')}</div>
      <div className="seg" role="group" aria-label={t('尺寸')}>
        {([1, 2, 3] as const).map((k) => (
          <button key={k} type="button"
            className={opts.sizeMode === 'preset' && opts.scale === k ? 'on' : ''}
            aria-pressed={opts.sizeMode === 'preset' && opts.scale === k}
            onClick={() => setOpts({ ...opts, sizeMode: 'preset', scale: k })}>{k}×</button>
        ))}
        <button type="button" className={opts.sizeMode === 'custom' ? 'on' : ''}
          aria-pressed={opts.sizeMode === 'custom'}
          onClick={() => setOpts({ ...opts, sizeMode: 'custom' })}>{t('自定义')}</button>
      </div>

      {/* Presets: a chip row on a phone (a native select covers the screen), a grouped dropdown otherwise. */}
      {narrow ? (
        <div className="export-chips" role="group" aria-label={t('常用尺寸')}>
          {SIZE_PRESETS.map((p) => (
            <button key={p.id} type="button" className={`export-chip${chosen(p.w, p.h) ? ' on' : ''}`}
              aria-pressed={chosen(p.w, p.h)} onClick={() => applyPreset(p.w, p.h)}>{presetLabel(p.id)}</button>
          ))}
          {PLATFORM_PRESETS.map((p) => (
            <button key={p.id} type="button" className={`export-chip${chosen(p.w, p.h) ? ' on' : ''}`}
              title={p.note[lang]} aria-pressed={chosen(p.w, p.h)}
              onClick={() => applyPreset(p.w, p.h)}>{p.label[lang]}</button>
          ))}
        </div>
      ) : (
        <label className="export-num export-preset">
          <span>{t('常用尺寸')}</span>
          <select value="" aria-label={t('常用尺寸')} onChange={(e) => {
            const v = e.target.value;
            const p = SIZE_PRESETS.find((s) => s.id === v);
            if (p) { applyPreset(p.w, p.h); return; }
            const pl = PLATFORM_PRESETS.find((s) => s.id === v);
            if (pl) applyPreset(pl.w, pl.h);
          }}>
            <option value="">{t('选一个')}</option>
            <optgroup label={t('通用')}>
              {SIZE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{`${presetLabel(p.id)} · ${p.w}×${p.h}`}</option>
              ))}
            </optgroup>
            <optgroup label={t('平台')}>
              {PLATFORM_PRESETS.map((p) => (
                <option key={p.id} value={p.id} title={p.note[lang]}>{`${p.label[lang]} · ${p.w}×${p.h}`}</option>
              ))}
            </optgroup>
          </select>
        </label>
      )}

      {opts.sizeMode === 'custom' && (
        <div className="export-size-row">
          <label className="export-num">
            <span>{t('宽')}</span>
            <input type="number" min={1} max={MAX_EXPORT_PX} value={opts.customW}
              onChange={(e) => setSide('w', Number(e.target.value))} />
          </label>
          <label className="export-num">
            <span>{t('高')}</span>
            <input type="number" min={1} max={MAX_EXPORT_PX} value={opts.customH}
              onChange={(e) => setSide('h', Number(e.target.value))} />
          </label>
          <label className="check">
            <input type="checkbox" checked={opts.lockRatio} onChange={(e) => set('lockRatio', e.target.checked)} />
            <span>{t('锁定比例')}</span>
          </label>
        </div>
      )}
      {over && (
        <p className="export-warn" role="alert">
          {t('单边超过 {n} 像素，浏览器会给出空白图，先调小', { n: MAX_EXPORT_PX })}
        </p>
      )}
      </>}

      <div className="group-label">{t('背景')}</div>
      <div className="seg" role="group" aria-label={t('背景')}>
        {(['transparent', 'theme', 'custom'] as const).map((b) => (
          <button key={b} type="button" className={opts.bg === b ? 'on' : ''} aria-pressed={opts.bg === b}
            onClick={() => set('bg', b as ExportBg)}>
            {b === 'transparent' ? t('透明') : b === 'theme' ? t('主题底色') : t('自定义色')}
          </button>
        ))}
      </div>
      {opts.bg === 'custom' && (
        <label className="export-num">
          <span>{t('底色')}</span>
          <input type="color" value={opts.bgColor} onChange={(e) => set('bgColor', e.target.value)} />
        </label>
      )}
      <Slider label={t('圆角')} value={opts.radius} min={0} max={120} step={4}
        onChange={(v) => set('radius', v)} format={(v) => t('{n} 像素', { n: v })} />

      <div className="group-label">{t('内容')}</div>
      <label className="check">
        <input type="checkbox" checked={opts.embed && png} disabled={!png}
          onChange={(e) => set('embed', e.target.checked)} />
        <span>{t('图里嵌入词表和配色，拖回网页即可复现')}</span>
      </label>
      {!png && <p className="export-size">{t('只有 PNG 能带这段数据')}</p>}
      <label className="check">
        <input type="checkbox" checked={opts.qr} onChange={(e) => set('qr', e.target.checked)} />
        <span>{t('角落放一个分享链接二维码')}</span>
      </label>

      <div className="group-label">{t('水印')}</div>
      <label className="check">
        <input type="checkbox" checked={opts.watermark} onChange={(e) => set('watermark', e.target.checked)} />
        <span>{t('角落写上卡名和日期')}</span>
      </label>
      {opts.watermark && (
        <>
          <input className="export-tpl" type="text" value={opts.watermarkText}
            aria-label={t('水印文字')} placeholder={t('留空只写卡名和日期')}
            onChange={(e) => set('watermarkText', e.target.value)} />
          <div className="seg" role="group" aria-label={t('水印位置')}>
            {CORNERS.map((c) => (
              <button key={c} type="button" className={opts.watermarkPos === c ? 'on' : ''}
                aria-pressed={opts.watermarkPos === c} onClick={() => set('watermarkPos', c)}>
                {c === 'tl' ? t('左上') : c === 'tr' ? t('右上') : c === 'bl' ? t('左下') : t('右下')}
              </button>
            ))}
          </div>
          <Slider label={t('水印深浅')} value={Math.round(opts.watermarkOpacity * 100)} min={5} max={100} step={5}
            onChange={(v) => set('watermarkOpacity', v / 100)} format={(v) => `${v}%`} />
        </>
      )}
      <label className="check">
        <input type="checkbox" checked={opts.hiddenMeta && (png || svg)} disabled={!png && !svg}
          onChange={(e) => set('hiddenMeta', e.target.checked)} />
        <span>{t('把这段文字藏进图片信息里')}</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={opts.hiddenLsb && png} disabled={!png}
          onChange={(e) => set('hiddenLsb', e.target.checked)} />
        <span>{t('把这段文字藏进像素最低位')}</span>
      </label>
      <p className="export-size">
        {png
          ? t('两种隐藏水印都只写进 PNG')
          : svg
            ? t('SVG 没有像素可藏，水印只写进文件里的注释和 metadata，打开源码就能看见')
            : t('JPG / WebP 会重新压缩，像素里的水印留不住，只有 PNG 能藏')}
        <Note>{t('像素水印跳过完全透明的像素；重新压缩成 JPG / WebP 会把它洗掉')}</Note>
      </p>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-hidden="true"
        onChange={(e) => { void verify(e.target.files?.[0]); e.target.value = ''; }} />
      <button type="button" className="export-verify" title={t('验证水印')}
        onClick={() => fileRef.current?.click()}>
        <Icon name="check" size={16} />{t('验证水印')}
      </button>
      {verdict !== null && <p className="export-size" role="status">{verdict}</p>}

      <button type="button" className="export-act" onClick={onPng} disabled={over}>
        <Icon name="image" size={16} />{t('存成图片')}
      </button>

      <div className="group-label">{t('词表')}</div>
      {/* One control: how many words go into the table, top-down by count. */}
      <Slider label={t('导出多少词')} value={Math.min(opts.csvN, 500)} min={20} max={500} step={10}
        onChange={(v) => set('csvN', v)} format={(v) => t('{n} 个', { n: Math.min(v, all) })} />
      <p className="export-size">
        {t('按次数从高到低，最多 {n} 个（统计到 {all} 个）', { n: opts.csvN, all })}
        <Note>{t('CSV 带 BOM，Excel 直接打开不乱码；列：词、次数、词类')}</Note>
      </p>
      <button type="button" className="export-act" onClick={onCsv} disabled={!onCsv}>
        <Icon name="export" size={16} />{t('存成词表（CSV）')}
      </button>
      <button type="button" className="export-act" onClick={onJson} disabled={!onJson}>
        <Icon name="export" size={16} />{t('存成全量数据（JSON）')}
      </button>
      <button type="button" className="export-act" onClick={onCopy} disabled={!onCopy}>
        <Icon name={copied ? 'check' : 'files'} size={16} />{copied ? t('已复制') : t('复制到剪贴板')}
      </button>

      <div className="group-label">{t('文件名')}</div>
      <input className="export-tpl" type="text" value={opts.nameTpl}
        aria-label={t('文件名模板')} placeholder={t('留空用默认规则')}
        onChange={(e) => set('nameTpl', e.target.value)} />
      <p className="export-size">
        {t('可用变量：{vars}', { vars: NAME_VARS.join(' ') })}
      </p>
    </div>
  );
}

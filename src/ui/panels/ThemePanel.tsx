import { useMemo, useState } from 'react';
import { useT, tx } from '../i18n';
import {
  GROUP_LABEL, THEME_GROUPS, THEME_SPECS, previewTheme,
  type ColorVision, type Theme, type ThemeGroup,
} from '../../theme/themes';
import Icon from '../Icons';
import { cvdAllows, DEFAULT_OPEN_GROUPS, hexToOklab, oklchToHex } from '../../theme/palette';
import type { Settings } from '../settings';


/* ================= Palette ================= */

const VISIONS: ColorVision[] = ['normal', 'rg', 'by'];

/** Colour-vision labels are UI copy, hence a function of `t`. */
const visionLabel = (t: (s: string) => string): Record<ColorVision, string> => ({
  normal: t('正常'),
  rg: t('红绿色弱'),
  by: t('蓝黄色弱'),
});

export function ThemePanel({
  settings, patch,
}: { settings: Settings; patch: (p: Partial<Settings>) => void }) {
  const t = useT();
  const { themeId, mode, custom, colorVision } = settings;

  const resolved = mode === 'auto'
    ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : mode;

  // Only the recommended group starts open; the rest are one click away.
  const [open, setOpen] = useState<ThemeGroup[]>(DEFAULT_OPEN_GROUPS);
  const toggle = (g: ThemeGroup) =>
    setOpen((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]));

  // Previews render for the current scheme
  const previews = useMemo(
    () => THEME_SPECS.map((spec) => ({ spec, theme: previewTheme(spec, resolved) })),
    [resolved],
  );

  // The color input needs an sRGB value; use the mid-lightness step as the representative color
  const pickHex = oklchToHex(resolved === 'dark' ? 0.62 : 0.55, custom.chroma, custom.hue);

  const card = (theme: Theme, id: string, note?: string) => {
    // Under a colour-vision setting only palettes whose ramp survives all three simulations stay usable.
    const ok = cvdAllows(colorVision, theme.cvd);
    const name = tx(theme.label);
    const title = ok
      ? (note ? `${name} · ${tx(note)}` : name)
      : `${name} · ${t('这套色阶在色觉辅助下分不开相邻词频')}`;
    return (
      <button
        key={id}
        type="button"
        className={`swatch${themeId === id ? ' on' : ''}${ok ? '' : ' cvd-off'}`}
        disabled={!ok}
        onClick={() => patch({ themeId: id })}
        title={title}
        style={{ background: theme.surface }}
      >
        <span className="swatch-ramp">
          {theme.ramp.map((c) => <i key={c} style={{ background: c }} />)}
        </span>
        <span className="swatch-name" style={{ color: theme.fg }}>{name}</span>
        {themeId === id && (
          <span className="swatch-check" style={{ color: theme.accent }}><Icon name="check" size={13} /></span>
        )}
      </button>
    );
  };

  return (
    <>
      {/* The scheme switch is the top-right button; not duplicated here */}
      <div className="group-label">{t('色觉')}</div>
      <div className="seg">
        {VISIONS.map((v) => (
          <button key={v} type="button" className={colorVision === v ? 'on' : ''}
            aria-pressed={colorVision === v}
            onClick={() => {
              // Switching vision must change what you see: if the current palette is not safe
              // under the new setting, jump to the first safe one instead of only greying cards.
              const cur = previews.find((p) => p.spec.id === themeId);
              const safe = previews.find((p) => cvdAllows(v, p.theme.cvd));
              patch(cur && !cvdAllows(v, cur.theme.cvd) && safe ? { colorVision: v, themeId: safe.spec.id } : { colorVision: v });
            }}
          >{visionLabel(t)[v]}</button>
        ))}
      </div>

      {/* One collapsible section per group; tone differences are described in the card title */}
      {THEME_GROUPS.map((g) => {
        const items = previews.filter((p) => (p.spec.group ?? 'modern') === g);
        if (!items.length) return null;
        const isOpen = open.includes(g);
        return (
          <section className="theme-group" key={g}>
            <button
              type="button" className="theme-group-head"
              aria-expanded={isOpen} onClick={() => toggle(g)}
            >
              <Icon name="caret" size={13} />
              <span>{tx(GROUP_LABEL[g])}</span>
              <em>{items.length}</em>
            </button>
            {isOpen && (
              <div className="swatches">
                {items.map((p) => card(p.theme, p.spec.id, p.spec.note))}
              </div>
            )}
          </section>
        );
      })}

      <section className="theme-group">
        <div className={`custom-theme${themeId === 'custom' ? ' on' : ''}`}>
          <button type="button" className="custom-head" onClick={() => patch({ themeId: 'custom' })}>
            <span className="swatch-ramp small">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <i key={i} style={{
                  background: `oklch(${resolved === 'dark' ? 0.46 + i * 0.084 : 0.72 - i * 0.088} ${custom.chroma} ${custom.hue})`,
                }} />
              ))}
            </span>
            <span>{t('自定义')}</span>
            {themeId === 'custom' && <Icon name="check" size={13} />}
          </button>

          {/* One color input; lightness steps are derived per scheme */}
          <label className="slider">
            <span className="slider-label">{t('颜色')}</span>
            <input
              type="color" className="pick" value={pickHex} aria-label={t('挑一个颜色')}
              onChange={(e) => {
                const { a, b } = hexToOklab(e.target.value);
                const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
                const chroma = Math.min(0.18, Math.max(0.02, Math.hypot(a, b)));
                patch({ themeId: 'custom', custom: { ...custom, hue: Math.round(hue), chroma } });
              }}
            />
            <b>{Math.round(custom.hue)}°</b>
          </label>
        </div>
      </section>
    </>
  );
}

/* ================= Font ================= */

/** Font names and descriptions are UI copy, hence a function of `t`. */

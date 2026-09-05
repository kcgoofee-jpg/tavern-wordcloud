// @vitest-environment happy-dom
/** Export panel: grouping, size interlocks, the oversize refusal and the file-name template. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExportPanel } from '../../src/ui/panels';
import { MAX_EXPORT_PX, downloadBlob, exportName, mimeOf, svgBlob, watermarkLine } from '../../src/ui/export';
import { previewBox, stageContentBox } from '../../src/ui/exportLayout';
import { cloudToSvg } from '../../src/render/svg';
import { DEFAULT_SETTINGS, type ExportOpts } from '../../src/ui/settings';
import { PLATFORM_PRESETS } from '../../src/ui/exportPresets';

afterEach(cleanup);

const base = (o: Partial<ExportOpts> = {}): ExportOpts => ({ ...DEFAULT_SETTINGS.exportOpts, ...o });

/** Feed setOpts back in so a second interaction sees the first one. */
function panel(init: Partial<ExportOpts> = {}, props: Record<string, unknown> = {}) {
  let current = base(init);
  const setOpts = vi.fn((o: ExportOpts) => { current = o; });
  const view = render(
    <ExportPanel opts={current} setOpts={setOpts} size={{ w: 1000, h: 500 }} all={1176}
      onPng={vi.fn()} onCsv={vi.fn()} onJson={vi.fn()} onCopy={vi.fn()} {...props} />,
  );
  const rerender = () => view.rerender(
    <ExportPanel opts={current} setOpts={setOpts} size={{ w: 1000, h: 500 }} all={1176}
      onPng={vi.fn()} onCsv={vi.fn()} onJson={vi.fn()} onCopy={vi.fn()} {...props} />,
  );
  return { setOpts, get: () => current, rerender };
}

describe('ExportPanel groups', () => {
  it('shows every group, SVG included', () => {
    panel();
    for (const label of ['格式', '尺寸', '背景', '内容', '词表', '文件名']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    const svg = screen.getByRole('button', { name: 'SVG' }) as HTMLButtonElement;
    expect(svg.disabled).toBe(false);
  });

  it('SVG drops the resolution controls and says why the fonts may differ', async () => {
    const user = userEvent.setup();
    const h = panel();
    expect(screen.getAllByText('尺寸').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'SVG' }));
    expect(h.get().format).toBe('svg');
    h.rerender();
    // A vector scales without loss, so the 1x/2x/3x multiplier is gone
    expect(screen.queryByText('尺寸')).toBeNull();
    expect(screen.queryByRole('button', { name: '2×' })).toBeNull();
    expect(screen.getByText(/SVG 用系统字体渲染/)).toBeTruthy();
  });

  it('the format switch writes back, and embedding is only offered on PNG', async () => {
    const user = userEvent.setup();
    const h = panel();
    await user.click(screen.getByRole('button', { name: 'WEBP' }));
    expect(h.get().format).toBe('webp');
    h.rerender();
    const embed = screen.getByLabelText(/图里嵌入词表/) as HTMLInputElement;
    expect(embed.disabled).toBe(true);
    expect(embed.checked).toBe(false);
  });

  it('the size line follows the preset multiple', () => {
    panel({ sizeMode: 'preset', scale: 3 });
    expect(screen.getByText('3000 × 1500 像素')).toBeTruthy();
  });
});

describe('ExportPanel custom size', () => {
  it('the custom fields only appear once custom is chosen', async () => {
    const user = userEvent.setup();
    const h = panel();
    expect(screen.queryByLabelText('宽')).toBeNull();
    await user.click(screen.getByRole('button', { name: '自定义' }));
    expect(h.get().sizeMode).toBe('custom');
    h.rerender();
    expect(screen.getByLabelText('宽')).toBeTruthy();
  });

  it('the lock keeps the canvas aspect ratio; unlocking lets one side move alone', () => {
    const h = panel({ sizeMode: 'custom', lockRatio: true, customW: 1000, customH: 500 });
    // Canvas is 1000 × 500, so a 1600 wide export is 800 tall
    fireEvent.change(screen.getByLabelText('宽'), { target: { value: '1600' } });
    expect(h.get()).toMatchObject({ customW: 1600, customH: 800 });

    cleanup();
    const u = panel({ sizeMode: 'custom', lockRatio: false, customW: 1000, customH: 500 });
    fireEvent.change(screen.getByLabelText('宽'), { target: { value: '1600' } });
    expect(u.get()).toMatchObject({ customW: 1600, customH: 500 });
  });

  it('a common size fills both fields at once', () => {
    const h = panel({ sizeMode: 'custom' });
    fireEvent.change(screen.getByLabelText('常用尺寸'), { target: { value: 'phone' } });
    expect(h.get()).toMatchObject({ sizeMode: 'custom', customW: 1170, customH: 2532 });
  });

  it('refuses an edge past the smallest canvas limit and disables the image button', () => {
    panel({ sizeMode: 'custom', lockRatio: false, customW: MAX_EXPORT_PX + 1, customH: 100 });
    expect(screen.getByRole('alert').textContent).toContain(String(MAX_EXPORT_PX));
    expect((screen.getByRole('button', { name: /存成图片/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a typed side is clamped, so the input itself cannot get past the limit', () => {
    const h = panel({ sizeMode: 'custom', lockRatio: false });
    fireEvent.change(screen.getByLabelText('宽'), { target: { value: String(MAX_EXPORT_PX * 2) } });
    expect(h.get().customW).toBe(MAX_EXPORT_PX);
  });
});

describe('ExportPanel background and contents', () => {
  it('background choice and the QR / watermark toggles write back', async () => {
    const user = userEvent.setup();
    const h = panel();
    await user.click(screen.getByRole('button', { name: '透明' }));
    expect(h.get().bg).toBe('transparent');
    await user.click(screen.getByLabelText(/二维码/));
    expect(h.get().qr).toBe(true);
    await user.click(screen.getByLabelText(/卡名和日期/));
    expect(h.get().watermark).toBe(true);
  });

  it('the colour well only shows for a custom background', () => {
    panel({ bg: 'theme' });
    expect(screen.queryByLabelText('底色')).toBeNull();
    cleanup();
    panel({ bg: 'custom' });
    expect(screen.getByLabelText('底色')).toBeTruthy();
  });
});

describe('ExportPanel data actions', () => {
  it('CSV scope writes back and the three data buttons are disabled without a result table', () => {
    const h = panel();
    fireEvent.change(screen.getByLabelText(/导出多少词/), { target: { value: '300' } });
    expect(h.get().csvN).toBe(300);

    cleanup();
    render(<ExportPanel opts={base()} setOpts={vi.fn()} size={{ w: 10, h: 10 }} all={1} onPng={vi.fn()} />);
    for (const name of [/存成词表/, /存成全量数据/, /复制到剪贴板/]) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('each action calls back once', async () => {
    const user = userEvent.setup();
    const onPng = vi.fn(); const onCsv = vi.fn(); const onJson = vi.fn(); const onCopy = vi.fn();
    render(<ExportPanel opts={base()} setOpts={vi.fn()} size={{ w: 10, h: 10 }} all={1}
      onPng={onPng} onCsv={onCsv} onJson={onJson} onCopy={onCopy} />);
    await user.click(screen.getByRole('button', { name: /存成图片/ }));
    await user.click(screen.getByRole('button', { name: /存成词表/ }));
    await user.click(screen.getByRole('button', { name: /存成全量数据/ }));
    await user.click(screen.getByRole('button', { name: /复制到剪贴板/ }));
    expect([onPng, onCsv, onJson, onCopy].map((f) => f.mock.calls.length)).toEqual([1, 1, 1, 1]);
  });
});

describe('ExportPanel file name', () => {
  it('the template writes back and produces the name the export will use', () => {
    const h = panel();
    fireEvent.change(screen.getByLabelText('文件名模板'), { target: { value: '{card}' } });
    expect(h.get().nameTpl).toBe('{card}');
    expect(exportName('png', {
      card: '陆时衍', mode: 'freq', words: 12, lang: 'zh',
      now: new Date(2026, 8, 4, 9, 7), tpl: h.get().nameTpl,
    })).toBe('陆时衍.png');
  });
});

describe('ExportPanel platform presets', () => {
  it('a platform preset fills both sides and switches to custom', () => {
    const h = panel();
    fireEvent.change(screen.getByLabelText('常用尺寸'), { target: { value: 'xhs-portrait' } });
    expect(h.get()).toMatchObject({ sizeMode: 'custom', customW: 1242, customH: 1660 });
    h.rerender();
    expect(screen.getByText('1242 × 1660 像素')).toBeTruthy();
  });

  it('every platform preset is listed under its own group, with a pixel size', () => {
    panel();
    const group = screen.getByLabelText('常用尺寸').querySelector('optgroup[label="平台"]');
    expect(group?.children.length).toBe(PLATFORM_PRESETS.length);
    expect(screen.getByRole('option', { name: /Instagram 快拍 · 1080×1920/ })).toBeTruthy();
  });
});

describe('ExportPanel watermark', () => {
  it('the text, corner and opacity only show once the stamp is on, and all write back', async () => {
    const user = userEvent.setup();
    const h = panel();
    expect(screen.queryByLabelText('水印文字')).toBeNull();
    await user.click(screen.getByLabelText(/卡名和日期/));
    expect(h.get().watermark).toBe(true);
    h.rerender();

    fireEvent.change(screen.getByLabelText('水印文字'), { target: { value: '我的词云' } });
    expect(h.get().watermarkText).toBe('我的词云');
    h.rerender();
    await user.click(screen.getByRole('button', { name: '右下' }));
    expect(h.get().watermarkPos).toBe('br');
    h.rerender();
    fireEvent.change(screen.getByLabelText(/水印深浅/), { target: { value: '20' } });
    expect(h.get().watermarkOpacity).toBeCloseTo(0.2);
  });

  it('both invisible carriers write back on PNG and are refused on a lossy format', async () => {
    const user = userEvent.setup();
    const h = panel();
    await user.click(screen.getByLabelText(/图片信息里/));
    expect(h.get().hiddenMeta).toBe(true);
    h.rerender();
    await user.click(screen.getByLabelText(/像素最低位/));
    expect(h.get().hiddenLsb).toBe(true);

    cleanup();
    panel({ format: 'jpg', hiddenMeta: true, hiddenLsb: true });
    for (const label of [/图片信息里/, /像素最低位/]) {
      const box = screen.getByLabelText(label) as HTMLInputElement;
      expect(box.disabled).toBe(true);
      expect(box.checked).toBe(false);
    }
    expect(screen.getByText(/JPG \/ WebP 会重新压缩/)).toBeTruthy();
  });

  it('the verify button is always available', () => {
    panel();
    expect(screen.getByRole('button', { name: /验证水印/ })).toBeTruthy();
  });
});

describe('ExportPanel on a phone', () => {
  /** happy-dom answers matchMedia from a fixed width, so the query is stubbed instead. */
  const setWidth = (px: number) => {
    vi.stubGlobal('matchMedia', (q: string) => {
      const max = Number(/max-width:\s*(\d+)px/.exec(q)?.[1] ?? 0);
      return {
        matches: px <= max, media: q,
        addEventListener: () => {}, removeEventListener: () => {},
      } as unknown as MediaQueryList;
    });
  };
  afterEach(() => vi.unstubAllGlobals());

  it('swaps the dropdown for a chip row', () => {
    setWidth(390);
    const h = panel();
    // The full-screen box is the sheet's job (App adds `.sheet.fullscreen`); the panel itself
    // only swaps the thirty-option dropdown for a scrollable chip row.
    expect(screen.queryByLabelText('常用尺寸')?.tagName).not.toBe('SELECT');
    const chip = screen.getByRole('button', { name: 'Instagram 竖版' });
    fireEvent.click(chip);
    expect(h.get()).toMatchObject({ sizeMode: 'custom', customW: 1080, customH: 1350 });
  });

  it('keeps the dropdown on a desktop width', () => {
    setWidth(1280);
    panel();
    expect((screen.getByLabelText('常用尺寸') as HTMLElement).tagName).toBe('SELECT');
  });
});

describe('ExportPanel preview', () => {
  /**
   * happy-dom lays nothing out, so `.export-fit` measures 0 and the panel falls back to
   * `exportLayout`'s arithmetic for the window it thinks it is in. That is the same
   * arithmetic test/ui/export-layout.test.ts drives over a grid of viewports, so these cases
   * pin the wiring (the panel really uses it) rather than the containment rule itself.
   */
  const room = () => stageContentBox(window.innerWidth || 1024, window.innerHeight || 768);

  it('draws through the canvas with the chosen background, at the size the stage allows', () => {
    const paint = vi.fn(() => true);
    panel({ sizeMode: 'custom', customW: 1160, customH: 580, bg: 'transparent' }, { paint });
    expect(paint).toHaveBeenCalled();
    const [canvas, o] = paint.mock.calls.at(-1) as unknown as [HTMLCanvasElement, { width: number; height: number; bg: string }];
    expect(canvas.tagName).toBe('CANVAS');
    expect(o.bg).toBe('transparent');
    const box = previewBox(room(), 2);
    expect([o.width, o.height]).toEqual([box.w, box.h]);
    // Far larger than the 232px thumbnail it replaced: this is the whole point of the view.
    expect(o.width).toBeGreaterThan(400);
  });

  it('the canvas is sized in CSS pixels and fits the stage in BOTH axes, portrait included', () => {
    const stage = room();
    // 1080 × 1920 is the tallest thing the presets can ask for; a width-only rule overflows here.
    const paint = vi.fn(() => true);
    panel({ sizeMode: 'custom', customW: 1080, customH: 1920 }, { paint });
    const el = document.querySelector('.export-preview-canvas') as HTMLCanvasElement;
    const w = parseFloat(el.style.width);
    const h = parseFloat(el.style.height);
    expect(w).toBeGreaterThan(0);
    expect(w).toBeLessThanOrEqual(stage.w);
    expect(h).toBeLessThanOrEqual(stage.h);
    // Height-limited, so it uses the whole height of the stage
    expect(h).toBeGreaterThan(stage.h - 2);
  });

  it('the preview carries the watermark, composed by the same helper as the saved file', () => {
    const paint = vi.fn(() => true);
    const stamp = new Date(2026, 8, 5);
    panel({ watermark: true, watermarkText: '我的词云', watermarkPos: 'tr', watermarkOpacity: 0.3 },
      { paint, card: '陆时衍' });
    const [, o] = paint.mock.calls.at(-1) as unknown as [HTMLCanvasElement, { watermark: string | null; watermarkPos: string; watermarkOpacity: number }];
    expect(o.watermark).toBe(watermarkLine('陆时衍', '我的词云', stamp));
    expect(o.watermarkPos).toBe('tr');
    expect(o.watermarkOpacity).toBeCloseTo(0.3);

    cleanup();
    const off = vi.fn(() => true);
    panel({ watermark: false }, { paint: off, card: '陆时衍' });
    const [, o2] = off.mock.calls.at(-1) as unknown as [HTMLCanvasElement, { watermark: string | null }];
    expect(o2.watermark).toBeNull();
  });

  it('watermarkLine drops the empty pieces instead of leaving a dangling separator', () => {
    const at = new Date(2026, 8, 5);
    expect(watermarkLine(null, '', at)).toBe('2026-09-05');
    expect(watermarkLine('  ', '我的词云', at)).toBe('2026-09-05 · 我的词云');
    expect(watermarkLine('陆时衍', '我的词云', at)).toBe('陆时衍 · 2026-09-05 · 我的词云');
  });
});

describe('SVG export goes out as a vector blob', () => {
  it('the downloaded blob is image/svg+xml, not a bitmap', () => {
    const created: Blob[] = [];
    const spy = vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => {
      created.push(b as Blob);
      return 'blob:stub';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const svg = cloudToSvg(
      [{ text: '词', count: 3, x: 10, y: 20, w: 30, h: 30, fontSize: 30, rotated: false, stacked: false, step: 1, delay: 0, phase: 0 }],
      { width: 100, height: 100, ramp: ['#000', '#111'], fontFamily: 'Inter', fontWeight: '600' },
    );
    downloadBlob(svgBlob(svg), 'cloud.svg');
    expect(created).toHaveLength(1);
    expect(created[0].type).toBe('image/svg+xml;charset=utf-8');
    expect(mimeOf('svg')).toBe('image/svg+xml');
    spy.mockRestore();
  });

  it('the file name keeps the template and swaps the extension', () => {
    expect(exportName('png', { mode: 'freq', words: 12, lang: 'en', tpl: 'cloud', ext: 'svg' })).toBe('cloud.svg');
  });
});

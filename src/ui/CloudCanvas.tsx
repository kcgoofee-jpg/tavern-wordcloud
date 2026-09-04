import { embedText, PNG_KEYWORD } from '../share/png';
import { embedLsb, encodeChunkText, WATERMARK_KEYWORD } from './watermark';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useT } from './i18n';
import { canvasMeasure, hashSeed, layoutCloud, type Placement } from '../render/layout';
import { analyzeQr, type QrAnalysis } from '../render/qr';
import { CloudRenderer, type FrameState, type RenderInput } from '../render/renderer';
import { cloudToSvg } from '../render/svg';
import { downloadBlob, mimeOf, tooLarge, type PaintOpts } from './export';
import type { ExportFormat } from './settings';
import type { Theme } from '../theme/themes';
import type { WordCount } from '../core/types';

declare global {
  interface Window {
    /** Word bounding box in viewport CSS pixels; written after every layout, read by tools/shot.mjs. */
    __cloudBounds?: { left: number; top: number; right: number; bottom: number } | null;
  }
}

/** Narrow screens: mode switch (10 + 44) + gap 8 + round buttons 44 + gap 8. Mirrors 37-mobile-overrides.css. */
const NARROW_TOP = 10 + 44 + 8 + 44 + 8;
/** Fallback for --m-l5, computed from the same numbers as 37-mobile-overrides.css (safe-area 0). */
const MOBILE_STACK = 12 + (44 + 12) + 8 + 44 + 8 + 22 + 8 + 30 + 8;

/**
 * Height of the mobile control stack that the cloud must stay clear of: layers 1–4
 * (rail, dock, ratio, corner figures). --m-l5 is the top edge of that stack.
 * Custom properties come back as unevaluated calc() text, so it is resolved with a probe element.
 */
/** Motion opt-out: the words must sit still. Checked at layout time, not per frame. */
const prefersReducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const mobileStackHeight = (): number => {
  if (typeof document === 'undefined' || !document.body) return MOBILE_STACK;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;visibility:hidden;height:var(--m-l5,0px)';
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return h > 0 ? h : MOBILE_STACK;
};

export interface CloudApi {
  /**
   * Export a still using the base pose (no float, no hover), which is overlap-free by
   * construction. Returns false when there is nothing to draw or the size is refused.
   */
  exportImage: (
    filename: string, embed: string | undefined, opts: PaintOpts, format: ExportFormat,
    /** Invisible watermark: the same line goes into the PNG chunk and/or the pixel low bits. */
    hidden?: { text: string; meta: boolean; lsb: boolean },
  ) => boolean;
  /**
   * The same frozen pose as `exportImage`, written as a vector file instead of pixels.
   * Null when there is nothing to draw. No fonts are embedded: see render/svg.ts.
   */
  toSvg: (opts: PaintOpts) => string | null;
  /** Draw the same still into a caller-owned canvas; the export panel's live thumbnail uses it. */
  paint: (out: HTMLCanvasElement, opts: PaintOpts) => boolean;
  hasContent: () => boolean;
  /** On-screen canvas size in device pixels; the export panel sizes previews from it. */
  pixelSize: () => { w: number; h: number };
}

interface Props {
  words: WordCount[];
  theme: Theme;
  rotateRatio: number;
  /** Non-empty starts the morph into a QR code. */
  shareUrl: string | null;
  /** Word pointed at in the table; enlarged and glowing in the cloud. */
  highlight: string | null;
  onWordClick: (word: string) => void;
  onWordHover?: (word: string | null) => void;
}

const CloudCanvas = forwardRef<CloudApi, Props>(function CloudCanvas(
  { words, theme, rotateRatio, shareUrl, highlight, onWordClick, onWordHover },
  ref,
) {
  const t = useT();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0, dpr: 1 });
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const rendererRef = useRef<CloudRenderer | null>(null);
  const inputRef = useRef<RenderInput | null>(null);
  const stateRef = useRef<FrameState>({
    progress: 0, morph: 0, time: 0, pointer: null, highlight: null, frozen: false, dt: 0,
    scale: 1, panX: 0, panY: 0,
  });
  const highlightRef = useRef<string | null>(null);
  useEffect(() => { highlightRef.current = highlight; }, [highlight]);
  const morphTargetRef = useRef(0);
  // Viewport in a ref, not state: zoom must not go through React rendering
  const viewRef = useRef({ scale: 1, x: 0, y: 0 });
  const [zoomed, setZoomed] = useState(false);
  /** Copy outside setState to detect boolean flips without reading state. */
  const zoomedRef = useRef(false);
  /** Text node for the zoom percentage, written directly every frame. */
  const zoomLabelRef = useRef<HTMLSpanElement>(null);
  /** Number of placed words; read by the wheel handler, which cannot depend on state. */
  const placementsRef = useRef(0);

  // Container size. Background tabs measure 0, so visibilitychange re-measures.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize({
        w: Math.round(r.width),
        h: Math.round(r.height),
        dpr: Math.min(window.devicePixelRatio || 1, 2),
      });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    document.addEventListener('visibilitychange', measure);
    return () => { ro.disconnect(); document.removeEventListener('visibilitychange', measure); };
  }, []);

  const dw = Math.round(size.w * size.dpr);
  const dh = Math.round(size.h * size.dpr);

  // Font sizes: the largest word is about 1/8 of the short side; the smallest is 13 CSS px.
  const { maxFontSize, minFontSize, idleAmplitude, padding } = useMemo(() => {
    const short = Math.min(dw, dh) || 1;
    return {
      maxFontSize: Math.max(30, short / 8),
      // The minimum size is an absolute readability floor, not proportional to the canvas.
      minFontSize: 13 * size.dpr,
      // 0 stops the idle float; the layout then reserves no room for it either.
      idleAmplitude: prefersReducedMotion() ? 0 : Math.max(1.2, short / 320),
      padding: Math.max(3, short / 150),
    };
  }, [dw, dh, size.dpr]);

  // Reserve space for the floating toolbar: bottom on narrow screens, left on wide screens.
  /**
   * Margins reserved for floating controls. Each value corresponds to a real control:
   *   top 96   = mode switch (14+36) + run-mode row (58+30) + 8
   *   left 78  = rail width + gap (narrow screens: rail is at the bottom)
   *   bottom 62 = dock buttons + corner figures (narrow screens use --m-l* in the stylesheet)
   *   narrow top 114 = mode switch (10 + --tap) + 8 + round buttons (--tap) + 8
   *   narrow bottom  = the whole mobile layer stack up to and including layer 4
   *                    (rail / dock / ratio / corner figures), i.e. --m-l5
   */
  const inset = useMemo(() => {
    const d = size.dpr;
    const narrow = size.w <= 720;
    return narrow
      ? { top: NARROW_TOP * d, right: 8 * d, bottom: mobileStackHeight() * d, left: 8 * d }
      : { top: 96 * d, right: 8 * d, bottom: 62 * d, left: 78 * d };
  }, [size.w, size.dpr]);

  // Word-list fingerprint: `words` is a new array on every slider step even when unchanged.
  const wordsKey = useMemo(
    // display / rotate are user overrides that change the drawn glyphs or the orientation, so
    // they are part of the fingerprint too (without them the ↔/↕ buttons did nothing visible).
    () => words.map((w) => w.text + ':' + w.count + (w.display ? ':' + w.display : '') + (w.rotate ? ':' + w.rotate : '')).join('|'),
    [words],
  );

  const placements = useMemo<Placement[]>(() => {
    if (dw < 60 || dh < 60 || words.length === 0) return [];
    return layoutCloud(
      words,
      {
        width: dw, height: dh, maxFontSize, minFontSize, rotateRatio,
        steps: theme.ramp.length, padding, idleAmplitude, inset,
        seed: hashSeed(words.slice(0, 24).map((w) => w.text + w.count).join('|')),
        fontFamily: theme.cloudFont, fontWeight: theme.fonts.cloudWeight,
      },
      canvasMeasure(theme.cloudFont, theme.fonts.cloudWeight, theme.fonts.cloudTracking),
    );
    // Depends on wordsKey (fingerprint) rather than words, and on the font (glyph widths).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordsKey, dw, dh, maxFontSize, minFontSize, rotateRatio, theme.ramp.length,
      theme.cloudFont, theme.fonts.cloudWeight, theme.fonts.cloudTracking,
      padding, idleAmplitude, inset]);

  // Ref follows placements; the native wheel listener is attached once and cannot see fresh state.
  placementsRef.current = placements.length;

  /**
   * Word bounding box in viewport CSS pixels, published for the layout audit (tools/shot.mjs),
   * which checks that no floating control sits on top of the words.
   */
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap) return;
    if (!canvas || placements.length === 0) {
      wrap.removeAttribute('data-cloud-bounds');
      window.__cloudBounds = null;
      return;
    }
    const r = canvas.getBoundingClientRect();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of placements) {
      x0 = Math.min(x0, p.x - p.w / 2);
      x1 = Math.max(x1, p.x + p.w / 2);
      y0 = Math.min(y0, p.y - p.h / 2);
      y1 = Math.max(y1, p.y + p.h / 2);
    }
    const d = size.dpr || 1;
    const box = {
      left: r.left + x0 / d, top: r.top + y0 / d,
      right: r.left + x1 / d, bottom: r.top + y1 / d,
    };
    window.__cloudBounds = box;
    wrap.setAttribute(
      'data-cloud-bounds',
      [box.left, box.top, box.right, box.bottom].map((v) => Math.round(v)).join(','),
    );
  }, [placements, size.dpr, size.w, size.h]);

  const qr = useMemo<QrAnalysis | null>(() => {
    if (!shareUrl) return null;
    try { return analyzeQr(shareUrl, 'H'); } catch { return null; }
  }, [shareUrl]);

  // Replay the entrance animation only after a real re-layout, not on theme changes.
  useEffect(() => { stateRef.current.progress = 0; }, [placements]);
  useEffect(() => { morphTargetRef.current = shareUrl ? 1 : 0; }, [shareUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dw < 60 || dh < 60) return;
    canvas.width = dw;
    canvas.height = dh;
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;

    const input: RenderInput = {
      placements, theme, qr, width: dw, height: dh,
      fontFamily: theme.cloudFont, fontWeight: theme.fonts.cloudWeight,
      tracking: theme.fonts.cloudTracking, idleAmplitude,
    };
    inputRef.current = input;
    if (rendererRef.current) rendererRef.current.update(input);
    else rendererRef.current = new CloudRenderer(input);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw one frame synchronously: rAF does not run in hidden tabs.
    rendererRef.current.draw(ctx, stateRef.current);

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = stateRef.current;
      s.dt = dt;
      s.time += dt;
      s.highlight = highlightRef.current;
      // Frame-rate independent exponential easing
      s.progress += (1 - s.progress) * (1 - Math.exp(-3.2 * dt));
      if (1 - s.progress < 5e-4) s.progress = 1;
      const target = morphTargetRef.current;
      s.morph += (target - s.morph) * (1 - Math.exp(-3.2 * dt));
      if (Math.abs(target - s.morph) < 5e-4) s.morph = target;
      s.pointer = pointerRef.current;
      s.scale = viewRef.current.scale;
      s.panX = viewRef.current.x;
      s.panY = viewRef.current.y;
      rendererRef.current?.draw(ctx, s);
      // Zoom percentage written directly to the text node, only when it changes
      if (zoomLabelRef.current) {
        const pct = `${Math.round(viewRef.current.scale * 100)}%`;
        if (zoomLabelRef.current.textContent !== pct) zoomLabelRef.current.textContent = pct;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [placements, theme, qr, dw, dh, size.w, size.h, idleAmplitude]);

  /**
   * Paint one still into `out` at the requested pixel size. The panel's live thumbnail
   * and the downloaded file go through this same function, so what the user previews is
   * what the file contains.
   *
   * The cloud is laid out once at dw × dh; any other output size scales it uniformly and
   * centres it (contain), never stretching one axis.
   */
  const paint = (out: HTMLCanvasElement, o: PaintOpts): boolean => {
    const input = inputRef.current;
    if (!input || placements.length === 0) return false;
    out.width = Math.max(1, Math.round(o.width));
    out.height = Math.max(1, Math.round(o.height));
    const ctx = out.getContext('2d');
    if (!ctx) return false;
    const k = Math.min(out.width / dw, out.height / dh);
    const ox = (out.width - dw * k) / 2;
    const oy = (out.height - dh * k) / 2;

    // Rounded corners clip everything, background included
    const r = Math.max(0, Math.min(o.radius, Math.min(out.width, out.height) / 2));
    if (r > 0) {
      ctx.beginPath();
      ctx.roundRect(0, 0, out.width, out.height, r);
      ctx.clip();
    }

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(k, k);
    // frozen: base pose only, no float or hover; overlap-free by construction
    new CloudRenderer(input).draw(ctx, {
      progress: 1,
      morph: morphTargetRef.current,
      time: 0,
      pointer: null,
      highlight: null,
      frozen: true,
      dt: 0,
      // Export the image, not the viewport: reset zoom to 1
      scale: 1, panX: 0, panY: 0,
    });
    ctx.restore();

    // Background goes underneath after drawing (the renderer clears its own area first). A transparent
    // image is unreadable on light pages, so it is only left out when the user asks for it.
    if (o.bg !== 'transparent') {
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = o.bg === 'custom' ? o.bgColor : theme.surface;
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.globalCompositeOperation = 'source-over';
    }

    const pad = Math.max(8, Math.round(Math.min(out.width, out.height) * 0.035));
    if (o.watermark) {
      const fs = Math.max(10, Math.round(Math.min(out.width, out.height) * 0.024));
      // Same layer and same font as before; only the corner and the alpha are configurable now.
      ctx.font = `${fs}px ${theme.cloudFont}`;
      const pos = o.watermarkPos ?? 'bl';
      const right = pos === 'tr' || pos === 'br';
      const top = pos === 'tl' || pos === 'tr';
      ctx.textAlign = right ? 'right' : 'left';
      ctx.textBaseline = top ? 'top' : 'alphabetic';
      ctx.globalAlpha = Math.max(0.05, Math.min(1, o.watermarkOpacity ?? 0.55));
      ctx.fillStyle = theme.fg;
      ctx.fillText(o.watermark, right ? out.width - pad : pad, top ? pad : out.height - pad);
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
    }
    if (o.qr) {
      // Quiet zone plus a light plate: hard rule 6 wants the code scannable, not pretty
      const q = analyzeQr(o.qr);
      const box = Math.max(72, Math.round(Math.min(out.width, out.height) * 0.16));
      const cell = Math.max(1, Math.floor(box / (q.size + 4)));
      const side = cell * (q.size + 4);
      const x = out.width - pad - side;
      const y = out.height - pad - side;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, side, side);
      ctx.fillStyle = '#111111';
      for (let row = 0; row < q.size; row++) {
        for (let col = 0; col < q.size; col++) {
          if (q.bits[row * q.size + col]) ctx.fillRect(x + (col + 2) * cell, y + (row + 2) * cell, cell, cell);
        }
      }
    }
    return true;
  };

  useImperativeHandle(ref, (): CloudApi => ({
    hasContent: () => placements.length > 0,
    pixelSize: () => ({ w: dw, h: dh }),
    paint,
    toSvg: (o: PaintOpts) => {
      if (placements.length === 0) return null;
      return cloudToSvg(placements, {
        width: dw, height: dh, outWidth: o.width, outHeight: o.height,
        ramp: theme.ramp,
        fontFamily: theme.cloudFont, fontWeight: theme.fonts.cloudWeight, tracking: theme.fonts.cloudTracking,
        // Same rule as the canvas: transparent draws no plate at all.
        background: o.bg === 'transparent' ? null : o.bg === 'custom' ? o.bgColor : theme.surface,
        radius: o.radius,
        watermark: o.watermark,
        watermarkPos: o.watermarkPos,
        watermarkOpacity: o.watermarkOpacity,
        watermarkColor: theme.fg,
        hiddenText: o.hiddenText ?? null,
      });
    },
    exportImage: (filename: string, embed: string | undefined, o: PaintOpts, format: ExportFormat, hidden?: { text: string; meta: boolean; lsb: boolean }) => {
      // Off-screen canvas: never attached to the document, so a 8192 px export costs no layout
      const out = document.createElement('canvas');
      if (tooLarge({ w: o.width, h: o.height })) return false;
      if (!paint(out, o)) return false;
      // LSB has to happen on the bitmap, before the encoder runs, and only for PNG:
      // JPG/WebP quantisation wipes the low bits (see ui/watermark.ts).
      if (hidden?.lsb && format === 'png') {
        try {
          const c = out.getContext('2d');
          if (c) {
            const img = c.getImageData(0, 0, out.width, out.height);
            embedLsb(img.data, hidden.text);
            c.putImageData(img, 0, 0);
          }
        } catch { /* image too small for the payload: export without the pixel watermark */ }
      }
      // toBlob rather than toDataURL: multi-MB data URLs fail on Safari / mobile
      out.toBlob((blob) => {
        if (!blob) return;
        void (async () => {
          // Embed the word table and palette so the PNG can be re-imported (see share/png.ts).
          // Only PNG carries text chunks; JPG/WebP export the picture alone.
          let final: Blob = blob;
          if (format === 'png' && (embed || hidden?.meta)) {
            try {
              let bytes: Uint8Array<ArrayBufferLike> = new Uint8Array(await final.arrayBuffer());
              if (embed) bytes = embedText(bytes, PNG_KEYWORD, embed);
              if (hidden?.meta) bytes = embedText(bytes, WATERMARK_KEYWORD, encodeChunkText(hidden.text));
              final = new Blob([bytes.buffer as ArrayBuffer], { type: 'image/png' });
            } catch { /* export a plain image if embedding fails */ }
          }
          downloadBlob(final, filename);
        })();
      }, mimeOf(format));
      return true;
    },
  }), [placements, dw, dh, theme]);

  /** Screen -> canvas coordinates; inverse of the viewport transform. */
  const toLocal = (e: { clientX: number; clientY: number; currentTarget: HTMLElement }) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) * size.dpr;
    const py = (e.clientY - r.top) * size.dpr;
    const v = viewRef.current;
    return { x: (px - v.x) / v.scale, y: (py - v.y) / v.scale };
  };

  const MIN_SCALE = 0.4;
  const MAX_SCALE = 4;

  const resetView = () => {
    viewRef.current = { scale: 1, x: 0, y: 0 };
    zoomedRef.current = false;
    setZoomed(false);
  };

  const handleWheel = (e: WheelEvent) => {
    const el = canvasRef.current;
    if (!el) return;
    // Prevent the default: ctrl+wheel is browser page zoom, and an empty canvas has nothing to zoom
    if (placementsRef.current === 0) return;
    // Otherwise buttons and panels would zoom too
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) * size.dpr;
    const py = (e.clientY - r.top) * size.dpr;
    const v = viewRef.current;

    // ctrl/meta + wheel = trackpad pinch
    if (e.ctrlKey || e.metaKey) {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * Math.exp(-e.deltaY * 0.0022)));
      // Zoom around the pointer, not the canvas center
      v.x = px - (px - v.x) * (next / v.scale);
      v.y = py - (py - v.y) * (next / v.scale);
      v.scale = next;
    } else {
      v.x -= e.deltaX * size.dpr;
      v.y -= e.deltaY * size.dpr;
    }
    // setState only when the "zoomed" boolean flips: pinch gestures emit 100+ events per second
    // and each React render would rebuild wordsKey. The percentage is written in the rAF loop.
    const nowZoomed = v.scale !== 1 || v.x !== 0 || v.y !== 0;
    if (nowZoomed !== zoomedRef.current) {
      zoomedRef.current = nowZoomed;
      setZoomed(nowZoomed);
    }
  };

  /**
   * Touch gestures: one finger pans, two fingers pinch-zoom around the midpoint,
   * and a tap counts only without movement (> 8 px is a drag). Requires `touch-action: none`.
   */
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; cx: number; cy: number } | null>(null);
  /** Pointer-down position and whether it has moved; distinguishes tap from drag. */
  const press = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  /** Last hovered word, to avoid re-rendering the parent on every move. */
  const lastHover = useRef<string | null>(null);

  /** Distance and midpoint of two touches (canvas coordinates). */
  const pinchOf = () => {
    const [a, b] = [...touches.current.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  };

  const applyZoom = (next: number, px: number, py: number) => {
    const v = viewRef.current;
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
    v.x = px - (px - v.x) * (clamped / v.scale);
    v.y = py - (py - v.y) * (clamped / v.scale);
    v.scale = clamped;
    const now = v.scale !== 1 || v.x !== 0 || v.y !== 0;
    if (now !== zoomedRef.current) { zoomedRef.current = now; setZoomed(now); }
  };

  // Native listener with { passive: false } so preventDefault works; React's onWheel may be passive.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.dpr]);

  return (
    <div className="cloud-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="cloud-canvas"
        onDoubleClick={resetView}
        onPointerMove={(e) => {
          const pt = toLocal(e);
          pointerRef.current = pt;

          if (touches.current.has(e.pointerId)) {
            const prev = touches.current.get(e.pointerId)!;
            touches.current.set(e.pointerId, pt);

            if (touches.current.size >= 2 && gesture.current) {
              // Two fingers: scale by distance change around the midpoint
              const now = pinchOf();
              if (gesture.current.dist > 0) {
                applyZoom(viewRef.current.scale * (now.dist / gesture.current.dist), now.cx, now.cy);
              }
              gesture.current = now;
            } else if (press.current) {
              // One finger: pan. Beyond 8 px it is a drag and no tap fires on release
              const dx = pt.x - prev.x;
              const dy = pt.y - prev.y;
              viewRef.current.x += dx;
              viewRef.current.y += dy;
              if (Math.hypot(pt.x - press.current.x, pt.y - press.current.y) > 8 * size.dpr) {
                press.current.moved = true;
              }
              const on = viewRef.current.scale !== 1 || viewRef.current.x !== 0 || viewRef.current.y !== 0;
              if (on !== zoomedRef.current) { zoomedRef.current = on; setZoomed(on); }
            }
            return;   // No hover highlight during gestures
          }

          /** Notify the parent only when the hovered word actually changes; onWordHover is a parent setState. */
          const hit = rendererRef.current?.hitTest(pt.x, pt.y)?.text ?? null;
          if (hit !== lastHover.current) {
            lastHover.current = hit;
            onWordHover?.(hit);
          }
        }}
        onPointerLeave={() => {
          pointerRef.current = null;
          if (lastHover.current !== null) { lastHover.current = null; onWordHover?.(null); }
        }}
        onPointerDown={(e) => {
          if (placementsRef.current === 0) return;
          (e.target as Element).setPointerCapture?.(e.pointerId);
          const pt = toLocal(e);
          touches.current.set(e.pointerId, pt);
          if (touches.current.size === 2) gesture.current = pinchOf();
          else press.current = { x: pt.x, y: pt.y, moved: false };
        }}
        onPointerUp={(e) => {
          const p = press.current;
          touches.current.delete(e.pointerId);
          if (touches.current.size < 2) gesture.current = null;
          press.current = null;
          // Tap only without movement; otherwise a drag on mobile would remove the word under the first touch
          if (!p || p.moved || shareUrl) return;
          const hit = rendererRef.current?.hitTest(p.x, p.y);
          if (hit) onWordClick(hit.text);
        }}
        onPointerCancel={(e) => {
          touches.current.delete(e.pointerId);
          gesture.current = null;
          press.current = null;
        }}
      />
      {zoomed && placements.length > 0 && (
        <button type="button" className="zoom-reset" onClick={resetView} title={t("双击画布也可以归位")}>
          <span ref={zoomLabelRef}>{Math.round(viewRef.current.scale * 100)}%</span> · {t('复位视图')}
        </button>
      )}
    </div>
  );
});

export default CloudCanvas;

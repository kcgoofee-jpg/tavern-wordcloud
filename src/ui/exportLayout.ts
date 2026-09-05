/**
 * Geometry of the export view.
 *
 * Exporting is what this product is for, so the export panel is not a 340 px sheet with a
 * thumbnail on it: it is a stage that holds the picture and a controls column beside (wide) or
 * below (narrow) it. The picture must be contained by the stage **in both axes** at every
 * aspect ratio the size presets can produce and at every viewport width.
 *
 * Containment is enforced three times over, deliberately:
 *
 *   1. `previewBox()` below sizes the picture from BOTH the available width and the available
 *      height. The panel writes the result onto the canvas as explicit CSS pixels, so nothing
 *      is left to a percentage that may or may not resolve.
 *   2. `.export-fit` is an absolutely positioned box inside `.export-stage`, so the canvas'
 *      `max-width/max-height: 100%` resolve against a *definite* containing block. The
 *      previous attempt (c704da7c) put the canvas in an auto-sized grid area, where a
 *      percentage max-height silently degrades to `none` and only `max-width` survives.
 *   3. `.export-stage` is `overflow: hidden`, so the picture physically cannot paint over the
 *      controls even if 1 and 2 were both wrong — and `tools/shot.mjs`'s `[纵向被裁]` check
 *      would report it, which is the one vertical check that audit does have.
 *
 * The numbers here are the same numbers `38-export.css` uses; `test/ui/export-layout.test.ts`
 * reads the stylesheet and fails if the two drift apart.
 */

export interface Box { w: number; h: number }

/** One set of `.sheet.export-view` insets. */
export interface Inset { left: number; right: number; top: number; bottom: number }

export const EXPORT_LAYOUT = {
  /** Below this the sheet is the whole viewport (`.sheet.fullscreen`); matches `NARROW_PX`. */
  fullscreenBelow: 640,
  /** At or above this the controls sit beside the picture instead of under it. */
  sideBySideAt: 900,
  /** 721 px and up: the rail is still on the left, so the box clears it. */
  wide: { left: 76, right: 14, top: 72, bottom: 14 } as Inset,
  /** 640–720: the rail has already moved to the bottom; same box as `.community-page`. */
  mid: { left: 8, right: 8, top: 120, bottom: 8 } as Inset,
  /** `.sheet-bar`, pinned to a fixed height in the export view so this arithmetic is exact. */
  barH: 54,
  /** `.export-stage` padding on every side. */
  stagePad: 12,
  /** `.export-foot`: the pixel read-out and the save button, fixed height for the same reason. */
  footH: 52,
  /** The stage never goes below this, however short the viewport. */
  stageMinH: 150,
  /** Stacked layout: the two flexible rows split the leftover height in this proportion. */
  stageFr: 0.9,
  controlsFr: 1,
  /** Width of the controls column in the side-by-side layout. */
  controlsW: 340,
} as const;

const L = EXPORT_LAYOUT;

/** Outer box of the export sheet at a given viewport. */
export function sheetBox(vw: number, vh: number): Box {
  if (vw < L.fullscreenBelow) return { w: Math.max(0, vw), h: Math.max(0, vh) };
  const i: Inset = vw <= 720 ? L.mid : L.wide;
  return { w: Math.max(0, vw - i.left - i.right), h: Math.max(0, vh - i.top - i.bottom) };
}

/** Box the two panes live in: the sheet minus its title bar. */
export function panelBox(vw: number, vh: number): Box {
  const s = sheetBox(vw, vh);
  return { w: s.w, h: Math.max(0, s.h - L.barH) };
}

/**
 * Outer box of `.export-stage`.
 *
 * Side by side, the stage is everything the controls column does not take, minus the foot.
 * Stacked, the stage and the controls split what the foot leaves in `stageFr : controlsFr`.
 * Either way the stage keeps a floor of `stageMinH`, which is what the `minmax()` in the
 * stylesheet does; on a viewport too short for that floor the grid overflows the sheet and
 * the *foot* is what gets clipped, never the picture.
 */
export function stageBox(vw: number, vh: number): Box {
  const p = panelBox(vw, vh);
  const free = Math.max(0, p.h - L.footH);
  if (vw >= L.sideBySideAt) {
    return { w: Math.max(0, p.w - L.controlsW), h: Math.max(L.stageMinH, free) };
  }
  const share = (free * L.stageFr) / (L.stageFr + L.controlsFr);
  return { w: p.w, h: Math.max(L.stageMinH, share) };
}

/** The box the picture is actually allowed to occupy: the stage minus its padding. */
export function stageContentBox(vw: number, vh: number): Box {
  const s = stageBox(vw, vh);
  return { w: Math.max(0, s.w - L.stagePad * 2), h: Math.max(0, s.h - L.stagePad * 2) };
}

/**
 * The largest box of aspect ratio `ratio` that fits inside `stage` **in both axes**.
 *
 * This is the whole point of the file. A width-only rule (`max-width: 100%`, or
 * `{ w: stage.w, h: stage.w / ratio }`) overflows downward for every export taller than the
 * stage — 1080×1920 phone wallpapers, 800×2000 Weibo long images, A4 portrait — and paints on
 * top of the controls. Both sides are floored, so the result is never larger than the stage
 * by a rounding error.
 */
export function previewBox(stage: Box, ratio: number): Box {
  const r = Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9;
  const availW = Math.max(0, stage.w);
  const availH = Math.max(0, stage.h);
  // Both sides are floored from the same exact fit, not one from the other: deriving the
  // height from an already-floored width costs 1/ratio pixels, which is 2.5 px of a 2:5 Weibo
  // long image and visible as a gap under the picture.
  const exact = Math.min(availW, availH * r);
  const w = Math.floor(exact);
  const h = Math.floor(exact / r);
  // A zero-sized canvas is not a picture; keep at least one pixel so the element still exists.
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

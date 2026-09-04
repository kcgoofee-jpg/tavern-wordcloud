import type { WordCount } from '../core/types';

/** Final placement of a word. Animation only offsets from this pose. */
export interface Placement {
  text: string;
  /** User-set display text; drawn instead of `text`. `text` stays the hover/hit-test identity. */
  display?: string;
  count: number;
  /** Center, device pixels */
  x: number;
  y: number;
  /** Bounding box including rotation, device pixels */
  w: number;
  h: number;
  fontSize: number;
  rotated: boolean;
  /** Color ramp index, 0 = lowest frequency */
  step: number;
  /** Normalized distance to the canvas center, 0..1; drives the inside-out ripple */
  delay: number;
  /** Per-word phase so floating is not synchronized */
  phase: number;
}

export interface LayoutOptions {
  width: number;
  height: number;
  maxFontSize: number;
  minFontSize: number;
  /** Vertical ratio 0..1 */
  rotateRatio: number;
  /** Ramp steps */
  steps: number;
  /** Base gap between words, device pixels */
  padding: number;
  /** Maximum float amplitude; included in the gap so floating never causes overlap */
  idleAmplitude: number;
  seed: number;
  fontFamily: string;
  fontWeight: string;
  /** Edges covered by UI controls, device pixels; words avoid these areas */
  inset?: { top: number; right: number; bottom: number; left: number };
}

export type Measure = (text: string, fontSize: number) => { w: number; h: number };

/** mulberry32: same words + same seed = same layout. */
export function makeRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

/** FNV-1a string hash, used as the seed. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Text measurement via canvas, abstracted so layout can be tested without a canvas. */
export function canvasMeasure(fontFamily: string, fontWeight: string, tracking = 0): Measure {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  // Letter spacing must be applied when measuring or the box will not match the drawn width.
  // ctx.letterSpacing is not universally supported.
  const supportsTracking = 'letterSpacing' in ctx;
  return (text: string, fontSize: number) => {
    if (supportsTracking) ctx.letterSpacing = tracking ? `${tracking}em` : '0px';
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    const m = ctx.measureText(text);
    const asc = m.actualBoundingBoxAscent;
    const desc = m.actualBoundingBoxDescent;
    // actualBoundingBox is unreliable for CJK glyphs in some browsers; fall back to font-size estimates.
    const h = Number.isFinite(asc) && Number.isFinite(desc) && asc + desc > 0 ? asc + desc : fontSize * 0.92;
    return { w: m.width, h };
  };
}

/**
 * Archimedean spiral layout. Walks outward from the center to the first free slot,
 * using a coarse occupancy bitmap (4 device pixels per cell) for collision tests.
 * Written in-house because per-word positions are needed for the QR morph.
 */
export function layoutCloud(words: WordCount[], opts: LayoutOptions, measure: Measure): Placement[] {
  const { width, height, padding, idleAmplitude } = opts;
  if (words.length === 0 || width < 10 || height < 10) return [];

  const CELL = 4;
  const gw = Math.ceil(width / CELL);
  const gh = Math.ceil(height / CELL);
  // One bit per 4x4 device-pixel cell, packed 32 cells per row word: a collision
  // test then scans a whole span of 32 cells with one AND instead of 32 loads.
  const stride = (gw + 31) >> 5;
  const grid = new Uint32Array(stride * gh);

  // Words are placed only inside the rectangle not covered by controls.
  const ins = opts.inset ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const x0 = ins.left;
  const y0 = ins.top;
  const x1 = width - ins.right;
  const y1 = height - ins.bottom;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const areaW = x1 - x0;
  const areaH = y1 - y0;
  const maxCount = words[0].count || 1;
  const rng = makeRandom(opts.seed);

  // Float amplitude is included in the gap so animation never causes overlap.
  const pad = padding + idleAmplitude;

  const free = (bx: number, by: number, bw: number, bh: number): boolean => {
    // The whole word including its gap must fit in the usable rectangle.
    if (bx - pad < x0 || by - pad < y0 || bx + bw + pad > x1 || by + bh + pad > y1) return false;
    const gx0 = Math.floor((bx - pad) / CELL);
    const gy0 = Math.floor((by - pad) / CELL);
    const gx1 = Math.ceil((bx + bw + pad) / CELL);
    const gy1 = Math.ceil((by + bh + pad) / CELL);
    if (gx0 < 0 || gy0 < 0 || gx1 > gw || gy1 > gh) return false;
    // Span [gx0, gx1) as row words plus the partial masks at both ends.
    const w0 = gx0 >> 5;
    const w1 = (gx1 - 1) >> 5;
    const first = 0xffffffff << (gx0 & 31);
    const last = 0xffffffff >>> (31 - ((gx1 - 1) & 31));
    if (w0 === w1) {
      const mask = first & last;
      for (let gy = gy0; gy < gy1; gy++) if (grid[gy * stride + w0] & mask) return false;
      return true;
    }
    for (let gy = gy0; gy < gy1; gy++) {
      const row = gy * stride;
      if (grid[row + w0] & first) return false;
      if (grid[row + w1] & last) return false;
      for (let w = w0 + 1; w < w1; w++) if (grid[row + w]) return false;
    }
    return true;
  };

  const occupy = (bx: number, by: number, bw: number, bh: number): void => {
    const gx0 = Math.max(0, Math.floor(bx / CELL));
    const gy0 = Math.max(0, Math.floor(by / CELL));
    const gx1 = Math.min(gw, Math.ceil((bx + bw) / CELL));
    const gy1 = Math.min(gh, Math.ceil((by + bh) / CELL));
    if (gx1 <= gx0) return;
    const w0 = gx0 >> 5;
    const w1 = (gx1 - 1) >> 5;
    const first = 0xffffffff << (gx0 & 31);
    const last = 0xffffffff >>> (31 - ((gx1 - 1) & 31));
    for (let gy = gy0; gy < gy1; gy++) {
      const row = gy * stride;
      if (w0 === w1) {
        grid[row + w0] |= first & last;
        continue;
      }
      grid[row + w0] |= first;
      grid[row + w1] |= last;
      for (let w = w0 + 1; w < w1; w++) grid[row + w] = 0xffffffff;
    }
  };

  // The spiral follows the canvas aspect ratio so portrait and landscape both fill.
  const ax = areaW >= areaH ? 1 : Math.max(0.35, areaW / areaH);
  const ay = areaH >= areaW ? 1 : Math.max(0.35, areaH / areaW);
  const maxRadius = Math.hypot(areaW, areaH) / 2;
  const out: Placement[] = [];

  /**
   * Spiral tracks, keyed by the exact (spacing, arc) pair a word produces.
   * The walk only depends on those two numbers, so every word of the same size
   * replays one track instead of recomputing sin/cos per step. Many words share a
   * size (the frequency tail quantises to the same font size), and those are the
   * words whose spirals run longest, so the trig is paid once for the whole group.
   * The recurrence is reproduced step for step, in the same order and on the same
   * operands, so cached positions are bit-for-bit what the inline loop produced.
   * Steps are appended lazily: most words stop early and never grow their track.
   */
  interface Track {
    /** Radius at step i, = spacing * angle_i */
    r: number[];
    cos: number[];
    sin: number[];
    /** Angle of the next step not yet appended */
    next: number;
  }
  const tracks = new Map<string, Track>();

  // Ramp index by rank quantile, not by count ratio, so all steps are used.
  const stepOf = (rank: number) =>
    Math.min(opts.steps - 1, Math.max(0, opts.steps - 1 - Math.floor((rank / words.length) * opts.steps)));

  for (let wi = 0; wi < words.length; wi++) {
    const word = words[wi];
    // Font size scales with the square root of the count ratio.
    const t = Math.sqrt(word.count / maxCount);
    const fontSize = opts.minFontSize + (opts.maxFontSize - opts.minFontSize) * t;
    // The largest words are never rotated. The random draw is consumed even when the user
    // forced a direction, so one word's override never shifts every other word's position.
    let rotated = false;
    if (wi >= 3) {
      const roll = rng() < opts.rotateRatio;
      rotated = word.rotate ? word.rotate === 'v' : roll;
    }
    const m = measure(word.display ?? word.text, fontSize);
    const bw = rotated ? m.h : m.w;
    const bh = rotated ? m.w : m.h;
    if (bw + 2 * pad > areaW || bh + 2 * pad > areaH) continue;

    let placed = false;
    // Both spiral scales are proportional to the word's own size:
    //   spacing = outward step per radian
    //   arc     = sampling step along the spiral
    const grain = Math.min(bw, bh);
    const spacing = Math.max(2, grain / 4);
    // Advance by arc length, not by angle, so outer steps do not skip free slots.
    const arc = Math.max(3, grain / 2);
    const key = spacing + ',' + arc;
    let track = tracks.get(key);
    if (track === undefined) {
      track = { r: [], cos: [], sin: [], next: 0 };
      tracks.set(key, track);
    }
    const tr = track.r;
    const tcos = track.cos;
    const tsin = track.sin;
    for (let i = 0; i < 40000; i++) {
      if (i === tr.length) {
        // Same recurrence as the plain loop, one step further along.
        const angle = track.next;
        const rn = spacing * angle;
        tr.push(rn);
        tcos.push(Math.cos(angle));
        tsin.push(Math.sin(angle));
        track.next = angle + arc / Math.max(spacing, rn);
      }
      const r = tr[i];
      if (r > maxRadius) break;
      const px = cx + r * tcos[i] * ax - bw / 2;
      const py = cy + r * tsin[i] * ay - bh / 2;
      if (free(px, py, bw, bh)) {
        occupy(px, py, bw, bh);
        const centerX = px + bw / 2;
        const centerY = py + bh / 2;
        out.push({
          text: word.text,
          display: word.display,
          count: word.count,
          x: centerX,
          y: centerY,
          w: bw,
          h: bh,
          fontSize,
          rotated,
          step: stepOf(wi),
          delay: Math.min(1, Math.hypot(centerX - cx, centerY - cy) / maxRadius),
          phase: rng() * Math.PI * 2,
        });
        placed = true;
        break;
      }
    }
    if (!placed) continue; // Skip words that do not fit anywhere; never overlap.
  }

  return out;
}

import type { Placement } from './layout';
import { makeRandom, stackedLines } from './layout';
import type { QrAnalysis } from './qr';
import { toScannerDark } from './qrColor';
import type { Theme } from '../theme/themes';

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** Quintic smoothstep: zero first and second derivatives at both ends. */
export const smootherstep = (x: number) => {
  const t = clamp01(x);
  return t * t * t * (t * (6 * t - 15) + 10);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface Particle {
  sx: number; sy: number;   // Start: a point inside a word's box
  tx: number; ty: number;   // End: the center of a QR data module
  cx: number; cy: number;   // Bezier control point for a curved flight path
  color: string;
  delay: number;
  size: number;
}

export interface RenderInput {
  placements: Placement[];
  theme: Theme;
  qr: QrAnalysis | null;
  width: number;
  height: number;
  fontFamily: string;
  fontWeight: string;
  /** Letter spacing, em */
  tracking: number;
  /** Float amplitude, device pixels; already included in the layout gap */
  idleAmplitude: number;
}

export interface FrameState {
  /** Entrance progress 0..1 */
  progress: number;
  /** Morph progress 0..1, 0 = cloud, 1 = QR */
  morph: number;
  /** Seconds */
  time: number;
  /** Pointer position for hover highlight, or null */
  pointer: { x: number; y: number } | null;
  /** Word selected in the table: enlarged and glowing, others dimmed */
  highlight: string | null;
  /** True when exporting a still: no float, no hover, base pose only */
  frozen: boolean;
  /** Viewport zoom and pan. Applies to content only, not controls */
  scale: number;
  panX: number;
  panY: number;
  /** Frame interval in seconds, for highlight easing */
  dt: number;
}

/** QR size: 4-module quiet zone, 72% of the short side. */
function boardGeometry(width: number, height: number, size: number) {
  const cells = size + 8;
  const board = Math.min(width, height) * 0.72;
  const module = board / cells;
  return { module, ox: (width - board) / 2 + 4 * module, oy: (height - board) / 2 + 4 * module, board, cells };
}

/**
 * Build particles: one per data module, assigned to words in proportion to their
 * counts so the QR color mix matches the cloud. Colors are clamped to a scanner-safe darkness.
 */
function buildParticles(input: RenderInput): { particles: Particle[]; moduleColor: Map<number, string> } {
  const { placements, qr, theme, width, height } = input;
  const moduleColor = new Map<number, string>();
  if (!qr || placements.length === 0) return { particles: [], moduleColor };

  const { module, ox, oy } = boardGeometry(width, height, qr.size);
  const rng = makeRandom(0x9e3779b9);

  // Cumulative distribution over counts for particle assignment
  const total = placements.reduce((a, p) => a + p.count, 0) || 1;
  const cum: number[] = [];
  let acc = 0;
  for (const p of placements) { acc += p.count / total; cum.push(acc); }
  const pickWord = () => {
    const r = rng();
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid; }
    return placements[lo];
  };

  const bcx = ox + (qr.size / 2) * module;
  const bcy = oy + (qr.size / 2) * module;
  const maxR = Math.hypot(qr.size, qr.size) * module / 2;

  // Inside-out ripple: sorted by distance to the QR center
  const targets = [...qr.data].sort(
    (a, b) =>
      Math.hypot(a.col - qr.size / 2, a.row - qr.size / 2) -
      Math.hypot(b.col - qr.size / 2, b.row - qr.size / 2),
  );

  const particles: Particle[] = targets.map((m) => {
    const p = pickWord();
    const sx = p.x + (rng() - 0.5) * p.w;
    const sy = p.y + (rng() - 0.5) * p.h;
    const tx = ox + (m.col + 0.5) * module;
    const ty = oy + (m.row + 0.5) * module;
    const color = toScannerDark(theme.ramp[p.step]);
    moduleColor.set(m.row * qr.size + m.col, color);
    // Control point offset perpendicular to the start-end line
    const mx = (sx + tx) / 2, my = (sy + ty) / 2;
    const dx = tx - sx, dy = ty - sy;
    const len = Math.hypot(dx, dy) || 1;
    const bend = (rng() - 0.5) * len * 0.35;
    return {
      sx, sy, tx, ty,
      cx: mx + (-dy / len) * bend,
      cy: my + (dx / len) * bend,
      color,
      delay: Math.min(1, Math.hypot(tx - bcx, ty - bcy) / maxR),
      size: module,
    };
  });

  for (const m of qr.fixed) moduleColor.set(m.row * qr.size + m.col, theme.qrDark);
  return { particles, moduleColor };
}

export class CloudRenderer {
  private input: RenderInput;
  private particles: Particle[] = [];
  private moduleColor = new Map<number, string>();
  /** Current highlight amount per word, eased rather than switched. */
  private hl = new Map<string, number>();
  /** Overall highlight amount, used to dim the rest */
  private hlAny = 0;

  constructor(input: RenderInput) {
    this.input = input;
    const built = buildParticles(input);
    this.particles = built.particles;
    this.moduleColor = built.moduleColor;
  }

  update(input: RenderInput) {
    this.input = input;
    const built = buildParticles(input);
    this.particles = built.particles;
    this.moduleColor = built.moduleColor;
  }

  /** Hover hit test on the base pose. */
  hitTest(x: number, y: number): Placement | null {
    const { placements } = this.input;
    for (let i = placements.length - 1; i >= 0; i--) {
      const p = placements[i];
      if (Math.abs(x - p.x) <= p.w / 2 && Math.abs(y - p.y) <= p.h / 2) return p;
    }
    return null;
  }

  /** Frame-rate independent exponential easing of highlight amounts. */
  private easeHighlight(state: FrameState) {
    const k = state.frozen ? 1 : 1 - Math.exp(-11 * Math.max(0.001, state.dt));
    let any = 0;
    for (const p of this.input.placements) {
      const target = state.highlight === p.text ? 1 : 0;
      const cur = this.hl.get(p.text) ?? 0;
      const next = cur + (target - cur) * k;
      if (next > 0.002 || target > 0) this.hl.set(p.text, next);
      else this.hl.delete(p.text);
      any = Math.max(any, next);
    }
    this.hlAny += (any - this.hlAny) * k;
  }

  draw(ctx: CanvasRenderingContext2D, state: FrameState) {
    const { theme, width, height, fontFamily, fontWeight, idleAmplitude, qr, tracking } = this.input;
    this.easeHighlight(state);
    ctx.save();
    ctx.clearRect(0, 0, width, height);

    // Viewport transform. Zoom does not re-layout.
    if (!state.frozen && (state.scale !== 1 || state.panX || state.panY)) {
      ctx.translate(state.panX, state.panY);
      ctx.scale(state.scale, state.scale);
    }

    const morph = state.morph;
    // The cloud fades out early in the morph to make room for particles
    const cloudAlpha = 1 - smootherstep(morph * 1.7);
    if (cloudAlpha > 0.002) this.drawWords(ctx, state, cloudAlpha, fontFamily, fontWeight, idleAmplitude, tracking);

    if (morph > 0.001 && qr) {
      const solid = smootherstep((morph - 0.72) / 0.28);
      if (solid < 0.999) this.drawParticles(ctx, state, 1 - solid);
      if (solid > 0.001) this.drawQr(ctx, solid, theme, width, height, qr);
    }
    ctx.restore();
  }

  private drawWords(
    ctx: CanvasRenderingContext2D,
    state: FrameState,
    alpha: number,
    fontFamily: string,
    fontWeight: string,
    idleAmplitude: number,
    tracking: number,
  ) {
    const { placements, theme } = this.input;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = tracking ? `${tracking}em` : '0px';

    for (const p of placements) {
      // Entrance: inside-out ripple
      const t = smootherstep((state.progress - 0.45 * p.delay) / 0.55);
      if (t <= 0.001) continue;

      let dx = 0, dy = 0;
      if (!state.frozen && idleAmplitude > 0) {
        dx = Math.sin(state.time * 0.55 + p.phase) * idleAmplitude;
        dy = Math.cos(state.time * 0.41 + p.phase * 1.3) * idleAmplitude * 0.75;
      }

      // Slight rotation during entrance, settling to zero
      let scale = lerp(0.72, 1, t);
      let spin = (1 - t) * (p.rotated ? 0.12 : -0.12);
      let a = alpha * t;

      const h = this.hl.get(p.text) ?? 0;
      if (!state.frozen && state.pointer) {
        const near = Math.abs(state.pointer.x - p.x) <= p.w / 2 && Math.abs(state.pointer.y - p.y) <= p.h / 2;
        if (near) { scale *= 1.08; a = Math.min(1, a * 1.25); }
      }
      // Highlighted word enlarged and glowing; others dimmed
      if (h > 0.002) {
        scale *= 1 + 0.42 * h;
        spin += Math.sin(state.time * 2.2) * 0.02 * h;
        a = Math.min(1, a * (1 + 0.9 * h));
      } else if (this.hlAny > 0.002) {
        a *= 1 - 0.72 * this.hlAny;
      }

      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = theme.ramp[p.step];
      ctx.translate(p.x + dx, p.y + dy);
      // A stacked word is already vertical by construction: its glyphs stay upright and
      // only their baselines walk down the column, so it must not be rotated as a block.
      if (p.rotated && !p.stacked) ctx.rotate(-Math.PI / 2);
      if (spin) ctx.rotate(spin);
      ctx.scale(scale, scale);
      ctx.font = `${fontWeight} ${p.fontSize}px ${fontFamily}`;
      if (h > 0.002) {
        // shadowBlur only on the highlighted word
        ctx.shadowColor = theme.accent;
        ctx.shadowBlur = 26 * h;
      }
      if (p.stacked) {
        // Tracking is horizontal letter spacing; Chrome also adds it after the last glyph,
        // which would shift a single centred character off the column. Zeroed here (and in
        // the SVG export) so the two agree. ctx.restore() puts the row value back.
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
        for (const line of stackedLines(p.display ?? p.text, p.fontSize)) ctx.fillText(line.ch, 0, line.dy);
      } else {
        ctx.fillText(p.display ?? p.text, 0, 0);
      }
      ctx.restore();
    }
  }

  private drawParticles(ctx: CanvasRenderingContext2D, state: FrameState, alpha: number) {
    const m = state.morph;
    ctx.save();
    for (const p of this.particles) {
      // Same staggering as the entrance
      const t = smootherstep((m - 0.45 * p.delay) / 0.55);
      if (t <= 0.001) continue;
      const it = 1 - t;
      // Quadratic Bezier flight path
      const x = it * it * p.sx + 2 * it * t * p.cx + t * t * p.tx;
      const y = it * it * p.sy + 2 * it * t * p.cy + t * t * p.ty;
      // Slight overshoot on landing
      const pop = t > 0.86 ? 1 + Math.sin((t - 0.86) / 0.14 * Math.PI) * 0.35 : 1;
      const s = p.size * lerp(0.35, 1, t) * pop;
      ctx.globalAlpha = alpha * Math.min(1, t * 3);
      ctx.fillStyle = p.color;
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }
    ctx.restore();
  }

  /** The final QR must be exact squares, not particle residue. */
  private drawQr(
    ctx: CanvasRenderingContext2D,
    alpha: number,
    theme: Theme,
    width: number,
    height: number,
    qr: QrAnalysis,
  ) {
    const { module, ox, oy, board } = boardGeometry(width, height, qr.size);
    ctx.save();
    ctx.globalAlpha = alpha;
    // Quiet zone: 4 modules of clean background on every side
    ctx.fillStyle = theme.qrLight;
    ctx.fillRect(ox - 4 * module, oy - 4 * module, board, board);
    for (let row = 0; row < qr.size; row++) {
      for (let col = 0; col < qr.size; col++) {
        const idx = row * qr.size + col;
        if (!qr.bits[idx]) continue;
        ctx.fillStyle = this.moduleColor.get(idx) ?? theme.qrDark;
        // +0.5 removes sub-pixel seams between adjacent modules
        ctx.fillRect(ox + col * module, oy + row * module, module + 0.5, module + 0.5);
      }
    }
    ctx.restore();
  }
}

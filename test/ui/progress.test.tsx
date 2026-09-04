// @vitest-environment happy-dom
/** The progress ring is determinate: arc length and the percent text are the same number. */
import { cleanup, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Progress from '../../src/ui/Progress';
import { phaseFraction } from '../../src/ui/hooks/progressModel';

afterEach(cleanup);

const R = 96 / 2 - 8;
const C = 2 * Math.PI * R;

const offset = () => Number(screen.getByTestId('progress-arc').getAttribute('stroke-dashoffset'));

describe('<Progress>', () => {
  it('renders p=0.37 as "37%" with the matching dashoffset', () => {
    render(<Progress pct={0.37} label="x" />);
    expect(screen.getByText('37%')).toBeTruthy();
    const arc = screen.getByTestId('progress-arc');
    expect(Number(arc.getAttribute('stroke-dasharray'))).toBeCloseTo(C, 6);
    expect(offset()).toBeCloseTo(C * (1 - 0.37), 6);
  });

  it('0% and 100% are the empty and full ring', () => {
    const { rerender } = render(<Progress pct={0} />);
    expect(screen.getByText('0%')).toBeTruthy();
    expect(offset()).toBeCloseTo(C, 6);
    rerender(<Progress pct={1} />);
    expect(screen.getByText('100%')).toBeTruthy();
    expect(offset()).toBeCloseTo(0, 6);
  });

  it('never spins: no rotating element in the ring', () => {
    const { container } = render(<Progress pct={0.5} />);
    expect(container.querySelector('.spin')).toBeNull();
  });

  it('falls back to done/total when no pct is given (inline use)', () => {
    render(<Progress done={1} total={4} />);
    expect(screen.getByText('25%')).toBeTruthy();
  });
});

describe('monotonic display', () => {
  /** The hook keeps a running max; the sequence 0.2 → 0.5 → 0.4 must show 50%. */
  it('a dip in the reported fraction does not move the ring back', () => {
    let shown = 0;
    const { rerender } = render(<Progress pct={shown} />);
    for (const p of [0.2, 0.5, 0.4]) {
      shown = Math.max(shown, p);
      rerender(<Progress pct={shown} />);
    }
    expect(screen.getByText('50%')).toBeTruthy();
    expect(offset()).toBeCloseTo(C * 0.5, 6);
  });

  it('a new task starts back at 0%', () => {
    let shown = 0.8;
    const { rerender } = render(<Progress pct={shown} />);
    expect(screen.getByText('80%')).toBeTruthy();
    shown = 0; // progress cleared at the end of the job
    rerender(<Progress pct={shown} />);
    expect(screen.getByText('0%')).toBeTruthy();
  });
});

describe('phaseFraction', () => {
  it('phases are contiguous and ordered, so a handover does not jump', () => {
    const order = ['unzip', 'scan', 'read', 'upload', 'parse', 'tokenize', 'ai', 'curate'] as const;
    let prev = 0;
    for (const phase of order) {
      const start = phaseFraction(phase, 0, 10);
      const end = phaseFraction(phase, 10, 10);
      expect(start).toBeCloseTo(prev, 6); // no gap with the previous phase's end
      expect(end).toBeGreaterThan(start);
      prev = end;
    }
    expect(prev).toBeCloseTo(1, 6);
  });

  it('interpolates inside a phase', () => {
    const a = phaseFraction('tokenize', 1, 4);
    const b = phaseFraction('tokenize', 3, 4);
    expect(b).toBeGreaterThan(a);
    expect(a).toBeGreaterThan(phaseFraction('tokenize', 0, 4));
  });

  it('an unknown total creeps to 90% of the band on elapsed time only', () => {
    const [lo, hi] = [0.85, 1]; // curate
    expect(phaseFraction('curate', 0, 0, 0)).toBeCloseTo(lo, 6);
    expect(phaseFraction('curate', 0, 0, 1e9)).toBeCloseTo(lo + (hi - lo) * 0.9, 6);
    expect(phaseFraction('curate', 1, 1, 0)).toBeCloseTo(hi, 6);
  });
});


describe('slow-start hint', () => {
  /** A ring parked at 0% reads as a broken page; after three seconds it says otherwise. */
  const hint = () => screen.queryByTestId('progress-hint');

  it('is hidden at first and appears after 3 s below 5%', () => {
    vi.useFakeTimers();
    try {
      render(<Progress pct={0.01} />);
      expect(hint()).toBeNull();
      act(() => { vi.advanceTimersByTime(2900); });
      expect(hint()).toBeNull();
      act(() => { vi.advanceTimersByTime(200); });
      expect(hint()).toBeTruthy();
    } finally { vi.useRealTimers(); }
  });

  it('never appears once the ring is past 5%', () => {
    vi.useFakeTimers();
    try {
      render(<Progress pct={0.4} />);
      act(() => { vi.advanceTimersByTime(10_000); });
      expect(hint()).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('goes away as soon as progress moves', () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<Progress pct={0.01} />);
      act(() => { vi.advanceTimersByTime(3100); });
      expect(hint()).toBeTruthy();
      rerender(<Progress pct={0.3} />);
      expect(hint()).toBeNull();
    } finally { vi.useRealTimers(); }
  });
});

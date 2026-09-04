/** prefers-reduced-motion, checked statically: the CSS opt-out exists and the cloud stops floating. */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const motion = read('src/ui/styles/41-motion.css');
const index = read('src/ui/styles/index.css');
const canvas = read('src/ui/CloudCanvas.tsx');
const progress = read('src/ui/styles/22-progress.css');

describe('reduced motion', () => {
  it('is registered before the mobile overrides, which must stay last', () => {
    expect(index.indexOf("41-motion.css")).toBeGreaterThan(-1);
    expect(index.indexOf("41-motion.css")).toBeLessThan(index.indexOf('37-mobile-overrides.css'));
  });

  it('neutralises the entrance animations by name', () => {
    const i = motion.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(i).toBeGreaterThan(-1);
    const block = motion.slice(i);
    for (const name of ['rail-in', 'tool-in', 'sheet-in', 'card-in', 'land-pop']) {
      expect(block).toContain(`@keyframes ${name}`);
    }
    // The transitions the review called out
    expect(block).toMatch(/\.tool, \.sheet, \.dock-style \{ transition: none; \}/);
    // The progress ring is determinate and never rotates, so there is nothing to slow down;
    // its own file drops the arc transition under reduced motion.
    expect(block).not.toContain('.progress .spin');
    expect(progress).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.progress \.progress-arc \{ transition: none; \} \}/);
  });

  it('the cloud stops floating: idleAmplitude falls back to 0', () => {
    expect(canvas).toMatch(/matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
    expect(canvas).toMatch(/idleAmplitude: prefersReducedMotion\(\) \? 0 :/);
  });
});

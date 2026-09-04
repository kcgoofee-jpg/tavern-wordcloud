/** Mobile issues checked statically: touch-action, gesture handling, bottom-stack layering. */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const canvas = read('src/ui/CloudCanvas.tsx');
// Styles are split per area; concatenate in index.css order
const styleDir = path.join(process.cwd(), 'src/ui/styles');
const css = fs.readdirSync(styleDir).filter((f) => /^\d\d-.*\.css$/.test(f)).sort()
  .map((f) => fs.readFileSync(path.join(styleDir, f), 'utf8')).join('\n');

describe('touch gestures', () => {
  it('the canvas takes all gestures: touch-action must be none', () => {
    // pan-y would hand vertical gestures to the browser; no move events would arrive
    const rule = css.slice(css.indexOf('.cloud-canvas'), css.indexOf('.cloud-canvas') + 400);
    expect(rule).toMatch(/touch-action:\s*none/);
  });

  it('one-finger pan and two-finger zoom are implemented', () => {
    expect(canvas).toMatch(/onPointerMove/);
    expect(canvas).toMatch(/onPointerUp/);
    expect(canvas).toMatch(/onPointerCancel/);
    // Two fingers: scale by distance ratio
    expect(canvas).toMatch(/pinchOf/);
    expect(canvas).toMatch(/touches\.current\.size >= 2/);
  });

  it('a tap counts only without movement', () => {
    // Removing a word on pointerdown broke panning on mobile
    expect(canvas).toMatch(/press\.current\.moved = true/);
    expect(canvas).toMatch(/if \(!p \|\| p\.moved \|\| shareUrl\) return;/);
    // Word removal must not hang on pointerdown
    const down = canvas.slice(canvas.indexOf('onPointerDown'), canvas.indexOf('onPointerUp'));
    expect(down).not.toMatch(/onWordClick/);
  });

  it('no gestures on an empty canvas', () => {
    expect(canvas).toMatch(/placementsRef\.current === 0/);
  });
});

describe('no overlap in the narrow-screen bottom stack', () => {
  const block = (() => {
    const i = css.indexOf('@media (max-width: 720px)');
    let d = 0, j = i;
    for (;; j++) { if (css[j] === '{') d++; else if (css[j] === '}') { d--; if (!d) break; } }
    return css.slice(i, j + 1);
  })();

  it('each layer derives from the previous one', () => {
    // Hand-computed offsets collided twice (ratio over rail, toast over dock)
    for (const v of ['--m-l1', '--m-l2', '--m-l3', '--m-l4', '--m-l5']) {
      expect(block).toContain(v);
    }
    // Recurrence: each layer references the previous one
    expect(block).toMatch(/--m-l2:\s*calc\(var\(--m-l1\)/);
    expect(block).toMatch(/--m-l3:\s*calc\(var\(--m-l2\)/);
    expect(block).toMatch(/--m-l4:\s*calc\(var\(--m-l3\)/);
    expect(block).toMatch(/--m-l5:\s*calc\(var\(--m-l4\)/);
  });

  it.each([
    ['.rail', '--m-l1'], ['.dock', '--m-l2'], ['.ratio', '--m-l3'],
    ['.toast', '--m-l5'], ['.sheet', '--m-l5'],
  ])('%s 用的是层变量 %s，没有硬写数字', (sel, layer) => {
    const i = block.indexOf(`${sel} {`);
    expect(i).toBeGreaterThan(-1);
    const rule = block.slice(i, block.indexOf('}', i));
    expect(rule).toContain(`bottom: var(${layer})`);
  });

  it('no hard-coded bottom offsets', () => {
    // Comments must be stripped first; they describe the old pattern
    const code = block.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/bottom:\s*calc\(12px \+ var\(--tap\)/);
  });
});

// @vitest-environment happy-dom
/**
 * `lazyPanel` (ui/lazyPanel.ts): once `preload()` has run, the first render of the component
 * must not suspend — no fallback frame, hence no 300 ms Suspense throttle (the "panel stalls,
 * then pops" the visitors saw, 2026-09-08). Without preload it behaves like React.lazy.
 */
import { Suspense } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { lazyPanel } from '../../src/ui/lazyPanel';

afterEach(cleanup);

const Ready = () => <i>ready</i>;
const make = () => lazyPanel(() => Promise.resolve({ default: Ready }));

describe('lazyPanel', () => {
  it('without preload: the fallback shows first, then the component', async () => {
    const C = make();
    const { container } = render(<Suspense fallback={<b>loading</b>}><C /></Suspense>);
    expect(container.textContent).toBe('loading');
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toBe('ready');
  });

  it('after preload: the component renders in the very first commit, no fallback', async () => {
    const C = make();
    await C.preload();
    const { container } = render(<Suspense fallback={<b>loading</b>}><C /></Suspense>);
    expect(container.textContent).toBe('ready');
  });

  it('preload is idempotent and does not break a component that was never preloaded', async () => {
    const C = make();
    await Promise.all([C.preload(), C.preload()]);
    const { container } = render(<C />);
    expect(container.textContent).toBe('ready');
  });
});

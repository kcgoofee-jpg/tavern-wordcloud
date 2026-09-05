// @vitest-environment happy-dom
/** Endpoint panel layout: address and key on their own rows, and the key's eye button. */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AI_CONFIG } from '../../src/core/aiTokenizer';
import { AiPanel } from '../../src/ui/panels';

afterEach(cleanup);

const renderPanel = () => render(
  <AiPanel ai={DEFAULT_AI_CONFIG} setAi={() => {}} canRun={false} busy={false} onRun={() => {}} relay={false} />,
);

describe('AiPanel', () => {
  it('the missing-model shortcut waits for the test button to stop being disabled', async () => {
    // With no endpoint the button is disabled, and focus() on a disabled element is a no-op;
    // the overlay shell then keeps the focus. Regression for a CI-only flake (2026-09-05).
    const ai = { ...DEFAULT_AI_CONFIG, endpoint: '' };
    const view = render(
      <AiPanel ai={ai} setAi={() => {}} canRun={false} busy={false} onRun={() => {}} relay={false} focus="model" />,
    );
    const button = screen.getByRole('button', { name: '测试连接' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(document.activeElement).not.toBe(button);

    view.rerender(
      <AiPanel ai={{ ...ai, endpoint: 'https://api.example.com/v1/chat/completions' }}
        setAi={() => {}} canRun={false} busy={false} onRun={() => {}} relay={false} focus="model" />,
    );
    await vi.waitFor(() => expect(document.activeElement).toBe(button));
  });

  it('the address and the key are not on the same row', () => {
    renderPanel();
    const url = screen.getByLabelText('地址');
    const key = screen.getByLabelText('密钥');
    expect(url.closest('.ai-line')).not.toBeNull();
    expect(key.closest('.ai-line')).not.toBeNull();
    expect(url.closest('.ai-line')).not.toBe(key.closest('.ai-line'));
  });

  it('the eye button switches the key box between dots and text', async () => {
    const user = userEvent.setup();
    renderPanel();
    expect((screen.getByLabelText('密钥') as HTMLInputElement).type).toBe('password');
    await user.click(screen.getByRole('button', { name: '显示密钥' }));
    expect((screen.getByLabelText('密钥') as HTMLInputElement).type).toBe('text');
    await user.click(screen.getByRole('button', { name: '隐藏密钥' }));
    expect((screen.getByLabelText('密钥') as HTMLInputElement).type).toBe('password');
  });

  it('the model list is disabled until the connection has been tested', () => {
    renderPanel();
    expect((screen.getByLabelText('模型') as HTMLSelectElement).disabled).toBe(true);
  });

  describe('让模型分类', () => {
    const ai = { ...DEFAULT_AI_CONFIG, endpoint: 'https://x.test/v1', model: 'm' };
    const renderLabel = (onLabeled: (k: Record<string, string>) => void) => render(
      <AiPanel ai={ai} setAi={() => {}} canRun={false} busy={false} onRun={() => {}} relay={false}
        labelWords={['沈砚秋', '房间']} onLabeled={onLabeled} />,
    );

    it('shows the preview first and only sends after confirmation', async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn(async () => new Response(
        JSON.stringify({ choices: [{ message: { content: '{"沈砚秋":"人物","房间":"常见词"}' } }] }),
        { status: 200 },
      ));
      vi.stubGlobal('fetch', fetchMock);
      const onLabeled = vi.fn();
      renderLabel(onLabeled);

      await user.click(screen.getByRole('button', { name: '让模型分类' }));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(screen.getByText('将发送 2 个词，约 12 字符，不含聊天正文')).toBeTruthy();

      await user.click(screen.getByRole('button', { name: '发送' }));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // The result is handed to the caller, which writes it into settings.overrides.
      expect(onLabeled).toHaveBeenCalledWith({ 沈砚秋: 'person', 房间: 'generic' });
      vi.unstubAllGlobals();
    });

    it('cancelling the preview sends nothing', async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      renderLabel(() => {});
      await user.click(screen.getByRole('button', { name: '让模型分类' }));
      const cancels = screen.getAllByRole('button', { name: '取消' });
      await user.click(cancels[cancels.length - 1]);
      expect(fetchMock).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });
  });
});

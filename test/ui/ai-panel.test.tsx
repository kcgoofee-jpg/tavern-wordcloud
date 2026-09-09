// @vitest-environment happy-dom
/**
 * Endpoint panel: layout (address and key on their own rows, the key's eye button) and — since
 * 2026-09-09, when the 词云模式 panel was folded in here — the cloud-mode group at the top.
 * Those cases came over from the deleted test/ui/mode-panel.test.tsx; how the rail reads the
 * mode off this panel is in test/ui/rail.test.tsx.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AI_CONFIG } from '../../src/core/aiTokenizer';
import { AiPanel } from '../../src/ui/panels';

afterEach(cleanup);

const renderPanel = () => render(
  <AiPanel ai={DEFAULT_AI_CONFIG} setAi={() => {}} canRun={false} busy={false} onRun={() => {}} relay={false}
      keywordMode={false} aiReady={false} aiMissing={null} curateModel="" canCurate={false} onMode={() => {}} onCurate={() => {}} />,
);

describe('AiPanel', () => {
  it('the missing-model shortcut waits for the test button to stop being disabled', async () => {
    // With no endpoint the button is disabled, and focus() on a disabled element is a no-op;
    // the overlay shell then keeps the focus. Regression for a CI-only flake (2026-09-05).
    const ai = { ...DEFAULT_AI_CONFIG, endpoint: '' };
    const view = render(
      <AiPanel ai={ai} setAi={() => {}} canRun={false} busy={false} onRun={() => {}} relay={false}
      keywordMode={false} aiReady={false} aiMissing={null} curateModel="" canCurate={false} onMode={() => {}} onCurate={() => {}} focus="model" />,
    );
    const button = screen.getByRole('button', { name: '测试连接' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(document.activeElement).not.toBe(button);

    view.rerender(
      <AiPanel ai={{ ...ai, endpoint: 'https://api.example.com/v1/chat/completions' }}
        setAi={() => {}} canRun={false} busy={false} onRun={() => {}} relay={false}
      keywordMode={false} aiReady={false} aiMissing={null} curateModel="" canCurate={false} onMode={() => {}} onCurate={() => {}} focus="model" />,
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
      keywordMode={false} aiReady={false} aiMissing={null} curateModel="" canCurate={false} onMode={() => {}} onCurate={() => {}}
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

describe('the cloud-mode group at the top of the panel', () => {
  const modeProps = {
    ai: DEFAULT_AI_CONFIG, setAi: () => {}, canRun: false, busy: false, onRun: () => {},
    relay: false, curateModel: 'gpt-x',
  };
  const group = () => document.querySelector('.seg[aria-label="词云模式"]') as HTMLElement;

  it('is the first thing in the panel, and offers the two modes', () => {
    render(<AiPanel {...modeProps} keywordMode={false} aiReady={false} aiMissing="endpoint"
      canCurate={false} onMode={() => {}} onCurate={() => {}} />);
    expect(group()).toBeTruthy();
    expect(within(group()).getByRole('button', { name: /词频/ }).getAttribute('aria-pressed')).toBe('true');
    expect(within(group()).getByRole('button', { name: /关键词/ }).getAttribute('aria-pressed')).toBe('false');
  });

  it('names the field that is still empty in the 关键词 tooltip, not beside the label', () => {
    const { rerender } = render(<AiPanel {...modeProps} keywordMode={false} aiReady={false}
      aiMissing="model" canCurate={false} onMode={() => {}} onCurate={() => {}} />);
    const keyword = () => within(group()).getByRole('button', { name: /关键词/ });
    expect(keyword().getAttribute('title')).toBe('还没选模型——点一下去配');
    expect(keyword().textContent).not.toContain('缺');
    rerender(<AiPanel {...modeProps} keywordMode={false} aiReady={false} aiMissing="key"
      canCurate={false} onMode={() => {}} onCurate={() => {}} />);
    expect(keyword().getAttribute('title')).toBe('还没填密钥——点一下去配');
  });

  it('picking 关键词 with a field still empty does not switch; it puts the cursor there', async () => {
    const user = userEvent.setup();
    const onMode = vi.fn();
    render(<AiPanel {...modeProps} keywordMode={false} aiReady={false} aiMissing="key"
      canCurate={false} onMode={onMode} onCurate={() => {}} />);
    expect(screen.queryByText('关键词模式要先把下面的接口配好')).toBeNull();
    await user.click(within(group()).getByRole('button', { name: /关键词/ }));
    expect(onMode).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('密钥')));
    // A focus ring three rows down is easy to miss, so the refusal also says why in words.
    expect(screen.getByText('关键词模式要先把下面的接口配好')).toBeTruthy();
  });

  it('with everything filled in the switch takes, and keyword mode adds the run button', async () => {
    const user = userEvent.setup();
    const onMode = vi.fn();
    const onCurate = vi.fn();
    const { rerender } = render(<AiPanel {...modeProps} keywordMode={false} aiReady aiMissing={null}
      canCurate onMode={onMode} onCurate={onCurate} />);
    // Frequency mode has no run action: a curation is one request over the whole log.
    expect(screen.queryByRole('button', { name: /读完整份聊天挑词/ })).toBeNull();
    await user.click(within(group()).getByRole('button', { name: /关键词/ }));
    expect(onMode).toHaveBeenCalledWith('keyword');

    rerender(<AiPanel {...modeProps} keywordMode aiReady aiMissing={null}
      canCurate onMode={onMode} onCurate={onCurate} />);
    await user.click(screen.getByRole('button', { name: '让 gpt-x 读完整份聊天挑词' }));
    expect(onCurate).toHaveBeenCalled();
  });

  it('the run button waits for a local analysis', () => {
    render(<AiPanel {...modeProps} keywordMode aiReady aiMissing={null}
      canCurate={false} onMode={() => {}} onCurate={() => {}} />);
    expect((screen.getByRole('button', { name: /读完整份聊天挑词/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

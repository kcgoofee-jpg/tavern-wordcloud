// @vitest-environment happy-dom
/** Endpoint panel layout: address and key on their own rows, and the key's eye button. */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_AI_CONFIG } from '../../src/core/aiTokenizer';
import { AiPanel } from '../../src/ui/panels';

afterEach(cleanup);

const renderPanel = () => render(
  <AiPanel ai={DEFAULT_AI_CONFIG} setAi={() => {}} canRun={false} busy={false} onRun={() => {}} relay={false} />,
);

describe('AiPanel', () => {
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
});

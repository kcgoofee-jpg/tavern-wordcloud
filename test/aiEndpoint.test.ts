import { describe, expect, it } from 'vitest';
import { chatEndpoint } from '../src/core/aiTokenizer';

/** A base URL entered as-is is the most common "key works but requests fail" cause */
describe('endpoint normalization', () => {
  it('base URLs get /chat/completions', () => {
    expect(chatEndpoint('https://opencode.ai/zen/go/v1')).toBe('https://opencode.ai/zen/go/v1/chat/completions');
    expect(chatEndpoint('https://opencode.ai/zen/go/v1/')).toBe('https://opencode.ai/zen/go/v1/chat/completions');
    expect(chatEndpoint('http://localhost:11434')).toBe('http://localhost:11434/v1/chat/completions');
  });
  it('complete URLs are returned unchanged; whitespace and extra slashes are cleaned', () => {
    expect(chatEndpoint('https://api.deepseek.com/v1/chat/completions')).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(chatEndpoint('  https://api.deepseek.com/v1/chat/completions/  ')).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(chatEndpoint('')).toBe('');
  });
});

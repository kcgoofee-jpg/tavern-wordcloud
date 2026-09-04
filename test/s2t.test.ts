import { describe, expect, it } from 'vitest';
import { toTraditional } from '../src/theme/s2t';

describe('toTraditional', () => {
  it('converts basic characters', () => {
    expect(toTraditional('中国')).toBe('中國');
    expect(toTraditional('学习')).toBe('學習');
  });

  it('picks the common candidate for one-to-many characters, per the manual table', () => {
    expect(toTraditional('头发')).toBe('頭發'); // 发 -> 發, not 髮
    expect(toTraditional('后来')).toBe('後來'); // 后 -> 後
    expect(toTraditional('干净')).toBe('幹淨'); // 干 -> 幹, not 乾
    expect(toTraditional('里边')).toBe('裡邊'); // 里 -> 裡
    expect(toTraditional('台湾')).toBe('臺灣'); // 台 -> 臺
    expect(toTraditional('只是')).toBe('隻是'); // 只 -> 隻
  });

  it('leaves non-Chinese text unchanged', () => {
    expect(toTraditional('hello123 world!')).toBe('hello123 world!');
    expect(toTraditional('')).toBe('');
    expect(toTraditional('  ')).toBe('  ');
  });

  it('preserves string length (character-for-character mapping)', () => {
    const s = '这是一段包含中文和english混合的text，用来测试长度是否不变。';
    expect(toTraditional(s).length).toBe(s.length);
  });

  it('is a no-op on text already in Traditional characters', () => {
    expect(toTraditional('臺灣')).toBe('臺灣');
  });
});

import { toZh } from '../src/core/zh';
import { describe, expect, it } from 'vitest';
import { analyze, DEFAULT_ANALYZE_OPTIONS } from '../src/core/analyze';
import { collectNames, parseChatFile } from '../src/core/parse';

const meta = JSON.stringify({ chat_metadata: {}, user_name: 'unused', character_name: 'unused' });
const msg = (o: Record<string, unknown>) => JSON.stringify(o);

describe('parsing', () => {
  it('parses standard SillyTavern jsonl', () => {
    const content = [
      meta,
      msg({ name: '小明', is_user: true, is_system: false, mes: '你好' }),
      msg({ name: '角色', is_user: false, mes: '你也好' }),
    ].join('\n');
    const chat = parseChatFile('a.jsonl', content);
    expect(chat.messages).toHaveLength(2);
    expect(chat.messages[0].role).toBe('user');
    expect(chat.messages[1].role).toBe('char');
    expect(chat.warnings).toEqual([]);
  });

  it('the unused placeholder is ignored and the name inferred', () => {
    const content = [
      meta,
      msg({ name: '小明', is_user: true, mes: '你好' }),
      msg({ name: '林先生', is_user: false, mes: '嗯' }),
      msg({ name: '林先生', is_user: false, mes: '嗯嗯' }),
    ].join('\n');
    const chat = parseChatFile('a.jsonl', content);
    expect(chat.userName).toBe('小明');
    expect(chat.charName).toBe('林先生');
  });

  it('broken lines only warn', () => {
    const content = [meta, '{这不是JSON', msg({ name: 'a', mes: '正文' })].join('\n');
    const chat = parseChatFile('a.jsonl', content);
    expect(chat.messages).toHaveLength(1);
    expect(toZh(chat.warnings[0])).toMatch(/1 行/);
  });

  it('accepts exported arrays and {chat:[...]}', () => {
    const arr = JSON.stringify([JSON.parse(meta), { name: 'a', mes: '一' }, { name: 'b', mes: '二' }]);
    expect(parseChatFile('x.json', arr).messages).toHaveLength(2);
    const wrapped = JSON.stringify({ chat: [{ name: 'a', mes: '一' }] });
    expect(parseChatFile('x.json', wrapped).messages).toHaveLength(1);
  });

  it('system messages are labelled system, including extra.isSmallSys', () => {
    const content = [
      msg({ name: 'S', is_system: true, mes: '已连接' }),
      msg({ name: 'S', is_user: false, mes: '提示', extra: { isSmallSys: true } }),
    ].join('\n');
    const chat = parseChatFile('a.jsonl', content);
    expect(chat.messages.map((m) => m.role)).toEqual(['system', 'system']);
  });

  it('only the current swipe by default', () => {
    const rec = { name: 'a', mes: '第一版', swipes: ['第一版', '第二版'], swipe_id: 0 };
    const one = parseChatFile('a.jsonl', msg(rec));
    expect(one.messages[0].raw).toBe('第一版');
    const all = parseChatFile('a.jsonl', msg(rec), {
      clean: { stripCustomTags: true, stripCodeBlocks: true, stripStructuredLines: true, stripOOC: true },
      includeAllSwipes: true,
    });
    expect(all.messages[0].raw).toContain('第二版');
  });

  it('swipe_id selects swipes[swipe_id] when mes is stale (ST writes mes on swipe)', () => {
    // slash-commands.js addSwipeCallback: lastMessage.mes = lastMessage.swipes[newSwipeId]
    const rec = { name: 'a', mes: '第一版', swipes: ['第一版', '第二版'], swipe_id: 1 };
    expect(parseChatFile('a.jsonl', msg(rec)).messages[0].raw).toBe('第二版');
  });

  it('an out-of-range swipe_id falls back to mes', () => {
    const rec = { name: 'a', mes: '正文', swipes: ['第一版'], swipe_id: 9 };
    expect(parseChatFile('a.jsonl', msg(rec)).messages[0].raw).toBe('正文');
  });

  it('display_text still beats the selected swipe (regex UI text)', () => {
    const rec = {
      name: 'a', mes: '第一版', swipes: ['第一版', '第二版'], swipe_id: 1,
      extra: { display_text: '她笑了。' },
    };
    expect(parseChatFile('a.jsonl', msg(rec)).messages[0].raw).toBe('她笑了。');
  });

  it('reasoning_display_text is preferred over extra.reasoning', () => {
    const rec = msg({
      name: 'a', mes: '他说好。',
      extra: { reasoning: '内部痕迹 地点状态', reasoning_display_text: '她在想要不要开门。' },
    });
    expect(parseChatFile('a.jsonl', rec).messages[0].reasoning).toBe('她在想要不要开门。');
  });

  it('strips the extra.fileLength prefix (ST prepends attachment text onto mes)', () => {
    // chats.js appendFileContent: mergedFileTexts + messageText, fileLength = mergedFileTexts.length
    const prefix = '附件正文周转表第一行\n\n';
    const rec = { name: 'a', mes: prefix + '她推开门。', extra: { fileLength: prefix.length } };
    expect(parseChatFile('a.jsonl', msg(rec)).messages[0].raw).toBe('她推开门。');
  });

  it('does not slice mes when display_text is present (UI text has no attachment prefix)', () => {
    const prefix = '附件正文周转表第一行\n\n';
    const rec = {
      name: 'a', mes: prefix + '她推开门。',
      extra: { fileLength: prefix.length, display_text: '她笑了。' },
    };
    expect(parseChatFile('a.jsonl', msg(rec)).messages[0].raw).toBe('她笑了。');
  });

  it('an out-of-range fileLength is ignored', () => {
    const rec = { name: 'a', mes: '她推开门。', extra: { fileLength: 999 } };
    expect(parseChatFile('a.jsonl', msg(rec)).messages[0].raw).toBe('她推开门。');
  });

  it('attachment prefix words do not enter the cloud', () => {
    const prefix = '周转文件全文周转周转周转\n\n';
    const content = [
      meta,
      msg({
        name: '角色', is_user: false,
        mes: prefix + '沈砚秋推开门，周敬亭坐在沙发上。',
        extra: { fileLength: prefix.length },
      }),
    ].join('\n');
    const r = analyze(
      [{ name: '测试卡 - 2026-08-31@20h00m08s527ms.jsonl', content }],
      {
        ...DEFAULT_ANALYZE_OPTIONS,
        roles: ['user', 'char'],
        tokenize: { ...DEFAULT_ANALYZE_OPTIONS.tokenize, minCount: 1, minLength: 2 },
      },
    );
    const bag = r.words.map((w) => w.text).join(' ');
    expect(bag).toMatch(/开门|沙发/);
    expect(bag).not.toMatch(/周转/);
  });

  it('reads lastInContextMessageId from the metadata line', () => {
    const content = [
      JSON.stringify({ chat_metadata: { lastInContextMessageId: 12 }, user_name: 'unused', character_name: 'unused' }),
      msg({ name: 'a', mes: '正文' }),
    ].join('\n');
    expect(parseChatFile('a.jsonl', content).lastInContextMessageId).toBe(12);
  });

  it('hidden messages (/hide sets is_system) keep their speaker; other is_system lines are notices', () => {
    const recs = [
      { user_name: 'u', character_name: '陆时衍' },
      { name: 'u', is_user: true, is_system: true, mes: '我藏起来的话' },
      { name: '陆时衍', is_user: false, is_system: true, mes: '角色藏起来的话' },
      { name: 'System', is_user: false, is_system: true, mes: '真正的系统通知' },
      { name: '陆时衍', is_user: false, mes: '正常回复' },
    ].map((r) => JSON.stringify(r)).join('\n');
    const roles = parseChatFile('陆时衍 - 2026-01-01@00h00m00s000ms.jsonl', recs).messages.map((m) => m.role);
    expect(roles).toEqual(['user', 'char', 'system', 'char']);
  });

  it('/sys narrator (extra.type, is_system false) is a system line, not the character', () => {
    const recs = [
      meta,
      msg({ name: 'System', is_user: false, is_system: false, mes: '夜幕降临。', extra: { type: 'narrator' } }),
      msg({ name: '林先生', is_user: false, mes: '嗯' }),
      msg({ name: '林先生', is_user: false, mes: '嗯嗯' }),
    ].join('\n');
    const chat = parseChatFile('a.jsonl', recs);
    expect(chat.messages.map((m) => m.role)).toEqual(['system', 'char', 'char']);
    expect(chat.charName).toBe('林先生');
  });

  it('/comment is a system line', () => {
    const recs = [
      msg({ name: 'Note', is_user: false, is_system: true, mes: 'OOC：先停一下', extra: { type: 'comment' } }),
      msg({ name: '林先生', is_user: false, mes: '正文' }),
    ].join('\n');
    expect(parseChatFile('a.jsonl', recs).messages.map((m) => m.role)).toEqual(['system', 'char']);
  });

  it('a hidden group member keeps char, not system', () => {
    const recs = [
      msg({ name: 'Alice', is_user: false, mes: '可见的 Alice' }),
      msg({ name: 'Alice', is_user: false, is_system: true, mes: '藏起来的 Alice' }),
      msg({ name: 'Bob', is_user: false, mes: 'Bob 1' }),
      msg({ name: 'Bob', is_user: false, mes: 'Bob 2' }),
      msg({ name: 'Bob', is_user: false, mes: 'Bob 3' }),
    ].join('\n');
    const chat = parseChatFile('group.jsonl', recs);
    expect(chat.charName).toBe('Bob');
    expect(chat.messages.map((m) => [m.name, m.role])).toEqual([
      ['Alice', 'char'],
      ['Alice', 'char'],
      ['Bob', 'char'],
      ['Bob', 'char'],
      ['Bob', 'char'],
    ]);
  });

  it('prefers extra.display_text over mes (what the UI showed)', () => {
    const rec = msg({ name: 'a', mes: '<status>123</status>原文', extra: { display_text: '她笑了。' } });
    expect(parseChatFile('a.jsonl', rec).messages[0].raw).toBe('她笑了。');
  });

  it('empty files and unknown formats warn readably', () => {
    expect(toZh(parseChatFile('a.jsonl', '  ').warnings[0])).toMatch(/空的/);
    expect(toZh(parseChatFile('a.jsonl', '这不是聊天记录').warnings[0])).toMatch(/认不出格式/);
  });

  it('versioned card names also yield the short name', () => {
    const chat = parseChatFile('a.jsonl', msg({ name: '逐梦演艺圈4.2', is_user: false, mes: '正文' }));
    const names = collectNames([chat]);
    expect(names).toContain('逐梦演艺圈4.2');
    expect(names).toContain('逐梦演艺圈');
  });
});

// @vitest-environment happy-dom
/** Import panel: the card-rule-pack note (notes/docs/23) and its one-click undo. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import ImportPanel, { type ImportSummary } from '../../src/ui/ImportPanel';
import { DEFAULT_ANALYZE_OPTIONS } from '../../src/core/analyze';
import type { DataBundle } from '../../src/core/bundle';
import { MAX_UPLOAD_BYTES } from '../../src/net/server';

afterEach(cleanup);

const summary: ImportSummary = { fileCount: 1, chars: 1000, uploadBytes: 3000, characters: ['排练厅的下午'], bundle: null, fromZip: false };

function panel(props: Partial<ComponentProps<typeof ImportPanel>> = {}) {
  return render(
    <ImportPanel summary={summary} options={DEFAULT_ANALYZE_OPTIONS} setOptions={vi.fn()}
      busy={false} progress={null} onStart={vi.fn()} onCancel={vi.fn()} onConfigureAi={vi.fn()}
      contribute={false} hasServer={false} {...props} />,
  );
}

describe('ImportPanel: card rule pack note', () => {
  it('shows nothing when no saved rule pack was applied', () => {
    panel({ cardRuleApplied: null });
    expect(screen.queryByText(/自动套用/)).toBeNull();
  });

  it('shows nothing when the applied count is zero', () => {
    panel({ cardRuleApplied: 0 });
    expect(screen.queryByText(/自动套用/)).toBeNull();
  });

  it('shows the count and an undo button when a saved pack was applied, and undo calls back', () => {
    const onUndo = vi.fn();
    panel({ cardRuleApplied: 3, onUndoCardRule: onUndo });
    expect(screen.getByText(/这张卡有你之前保存的 3 条修正，已自动套用/)).toBeTruthy();
    const undoBtn = screen.getByRole('button', { name: '撤销本次套用' });
    fireEvent.click(undoBtn);
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  /** A weak (name-only) match may be a different card that shares the name; the wording must not claim otherwise. */
  it('hedges the wording when only the weak fingerprint matched', () => {
    panel({ cardRuleApplied: 3, cardRuleWeak: true });
    expect(screen.queryByText(/这张卡有你之前保存的/)).toBeNull();
    expect(screen.getByText(/有一张同名的卡保存过 3 条修正/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '撤销本次套用' })).toBeTruthy();
  });
});

describe('ImportPanel: over the 10 MB upload cap', () => {
  /** The size shown must come from `uploadBytes`, not from `chars` — see notes/docs/31 §10.5. */
  const over = { ...summary, chars: 1_000_000, uploadBytes: MAX_UPLOAD_BYTES + 512 * 1024 };

  it('says the real upload size and the limit, and offers the local build for download', () => {
    panel({ hasServer: true, summary: over });
    expect(screen.getByText(/网页版上限 10 MB，这份传上去有 10\.5 MB/)).toBeTruthy();
    const link = screen.getByRole('link', { name: '下载本地版' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/download/index.html');
    expect(link.hasAttribute('download')).toBe(true);
  });

  it('stays quiet under the cap, and when there is no server to upload to', () => {
    panel({ hasServer: true, summary: { ...over, uploadBytes: MAX_UPLOAD_BYTES - 1 } });
    expect(screen.queryByText(/网页版上限 10 MB/)).toBeNull();
    cleanup();
    // A million characters would have tripped the old `chars * 3` estimate
    panel({ hasServer: false, summary: over });
    expect(screen.queryByText(/网页版上限 10 MB/)).toBeNull();
  });
});

describe('ImportPanel kind buckets', () => {
  it('shows the ops buckets, not the fine title/clothing buttons', () => {
    panel();
    for (const name of ['Names', 'Places', 'Time', 'Docs & organizations', 'Other', 'Common words']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${name}`) }), name).toBeTruthy();
    }
    // The fine kinds are not in the bucket row; they live inside the collapsed 「更多类别」.
    const buckets = screen.getByRole('button', { name: /^Names/ }).parentElement as HTMLElement;
    expect(buckets.querySelector('.import-more-kinds')).toBeNull();
    for (const name of ['Titles', 'Clothing']) {
      const btn = screen.getByRole('button', { name: new RegExp(`^${name}`) });
      expect(btn.closest('.import-more-kinds'), name).toBeTruthy();
    }
  });

  it('turning Names off drops person and title together', async () => {
    const user = userEvent.setup();
    let current = DEFAULT_ANALYZE_OPTIONS;
    const setOptions = vi.fn((fn: (o: typeof current) => typeof current) => { current = fn(current); });
    panel({ options: current, setOptions });
    await user.click(screen.getByRole('button', { name: /^Names/ }));
    expect(current.kinds).not.toContain('person');
    expect(current.kinds).not.toContain('title');
    expect(current.kinds).toContain('place');
  });
});

/**
 * The disclaimer under the import form used to say "uploaded to the server, discarded after"
 * whenever a server was reachable — but a zip, several files at once, or the visitor's own
 * cleaning regexes are analyzed in the worker and never leave the browser
 * (`shouldAnalyzeOnServer` in src/net/server.ts). The sentence now follows that rule.
 */
describe('ImportPanel: the disclaimer names the path this import actually takes', () => {
  const uploaded = /服务器不保存正文，处理完即丢弃/;
  const stays = /这次导入的正文不上传/;
  const localBuild = /所有处理都在这台电脑上完成，不出网/;

  it('says "uploaded" only for a single plain file with no custom regexes', () => {
    panel({ hasServer: true });
    expect(screen.getByText(uploaded)).toBeTruthy();
    expect(screen.queryByText(stays)).toBeNull();
  });

  it('says the text stays in the browser for a zip', () => {
    panel({ hasServer: true, summary: { ...summary, fromZip: true } });
    expect(screen.getByText(stays)).toBeTruthy();
    expect(screen.queryByText(uploaded)).toBeNull();
  });

  it('says the text stays in the browser for several files at once', () => {
    panel({ hasServer: true, summary: { ...summary, fileCount: 3 } });
    expect(screen.getByText(stays)).toBeTruthy();
    expect(screen.queryByText(uploaded)).toBeNull();
  });

  it('says the text stays in the browser when the visitor wrote cleaning regexes', () => {
    const withRules = {
      ...DEFAULT_ANALYZE_OPTIONS,
      clean: { ...DEFAULT_ANALYZE_OPTIONS.clean, customRules: [{ find: 'a', replace: '', flags: 'g' }] },
    };
    panel({ hasServer: true, options: withRules });
    expect(screen.getByText(stays)).toBeTruthy();
    expect(screen.queryByText(uploaded)).toBeNull();
  });

  it('says everything is local for the single-file edition, whatever the input is', () => {
    panel({ hasServer: false, summary: { ...summary, fromZip: true } });
    expect(screen.getByText(localBuild)).toBeTruthy();
    expect(screen.queryByText(uploaded)).toBeNull();
    expect(screen.queryByText(stays)).toBeNull();
  });
});


/**
 * A zip's warnings used to reach the user only through a toast that faded after a few
 * seconds: the site owner's 119 MB export showed «0 chats, 0 cards, 0 characters», a
 * 「开始」 button that did nothing, and no reason anywhere (2026-09-09).
 */
const bundleOf = (over: Partial<Omit<DataBundle, 'chats'>> = {}): Omit<DataBundle, 'chats'> => ({
  worldKeywords: [], worlds: [], characterCards: 0, readableCards: 0, regexScripts: [],
  source: 'chats', backupsDeduped: { kept: 0, dropped: 0 }, warnings: [], ...over,
});

describe('ImportPanel: the archive reader\u2019s warnings are in the dialog, not only in a toast', () => {
  const zipSummary = (bundle: Omit<DataBundle, 'chats'>, fileCount = 1): ImportSummary =>
    ({ ...summary, fileCount, characters: [], bundle, fromZip: true });

  it('lists the warnings under what was found', () => {
    panel({ summary: zipSummary(bundleOf({ warnings: [{ key: '\u8981\u8bfb\u7684\u6587\u4ef6\u52a0\u8d77\u6765\u8d85\u8fc7 512 MB\uff1a\u8df3\u8fc7\u4e86 {n} \u4e2a\u6587\u4ef6\u3001\u5171 {mb} MB', params: { n: 3, mb: '250' } }] })) });
    expect(screen.getByText(/512 MB/)).toBeTruthy();
    expect(screen.getByText(/250 MB/)).toBeTruthy();
  });

  it('lists at most five and counts the rest', () => {
    const warnings = Array.from({ length: 8 }, (_, i) => `\u7b2c ${i} \u6761\u8b66\u544a`);
    const { container } = panel({ summary: zipSummary(bundleOf({ warnings })) });
    expect(container.querySelectorAll('.import-warnings > .note')).toHaveLength(6); // 5 + the counter
    expect(screen.getByText('第 4 条警告')).toBeTruthy();
    expect(screen.queryByText('第 5 条警告')).toBeNull();
    expect(screen.getByText('还有 3 条')).toBeTruthy();
  });

  it('nothing read: 「开始」 is disabled and the first warning says why', () => {
    const why = '\u8fd9\u4e2a\u538b\u7f29\u5305\u91cc\u6ca1\u627e\u5230\u804a\u5929\u8bb0\u5f55\uff08\u5e94\u8be5\u5728 chats/<\u89d2\u8272\u5361\u540d>/ \u4e0b\uff09';
    panel({ summary: zipSummary(bundleOf({ warnings: [why] }), 0) });
    const go = screen.getByRole('button', { name: '开始' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    expect(screen.getByText(/没读到聊天记录，不能开始：No chat logs found in this archive/)).toBeTruthy();
    // …and the same warning is also listed above, in the 「读到了这些」 block.
    expect(screen.getAllByText(/No chat logs found in this archive/)).toHaveLength(2);
  });

  it('something read: 「开始」 stays enabled even when there are warnings', () => {
    panel({ summary: zipSummary(bundleOf({ warnings: ['\u4e00\u6761\u8b66\u544a'] }), 2) });
    expect((screen.getByRole('button', { name: '开始' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/没读到聊天记录/)).toBeNull();
  });

  it('marks the count as coming from backups only when it did', () => {
    panel({ summary: zipSummary(bundleOf({ source: 'backups', backupsDeduped: { kept: 4, dropped: 12 } }), 4) });
    expect(screen.getByText('（来自备份）')).toBeTruthy();
    cleanup();
    panel({ summary: zipSummary(bundleOf(), 4) });
    expect(screen.queryByText('（来自备份）')).toBeNull();
  });

  it('marks the count as partly from backups when some characters came from chats/ and others from backups/', () => {
    panel({ summary: zipSummary(bundleOf({ source: 'mixed', backupsDeduped: { kept: 1, dropped: 1 } }), 2) });
    expect(screen.getByText('（部分来自备份）')).toBeTruthy();
    expect(screen.queryByText('（来自备份）')).toBeNull();
  });
});

/**
 * The "N character cards" count used to be the number of distinct characters found among the
 * read chats (`summary.characters.length`) — a different thing from the archive's PNG cards,
 * and on the site owner's real export it showed 4 while `readDataBundle().characterCards` was
 * 6 (two characters had card PNGs but no chat logs at all; all six PNGs decoded fine). The
 * dialog now shows how many PNGs actually decoded (`readableCards`), with a separate line for
 * ones that did not.
 */
describe('ImportPanel: the card count is readable cards, not chat-derived character names', () => {
  const zipSummary = (bundle: Omit<DataBundle, 'chats'>, fileCount = 1): ImportSummary =>
    ({ ...summary, fileCount, characters: ['小雨'], bundle, fromZip: true });

  it('shows the number of PNGs that actually decoded, not the number of chat characters', () => {
    panel({ summary: zipSummary(bundleOf({ characterCards: 6, readableCards: 6 })) });
    expect(screen.getByText('6')).toBeTruthy();
    expect(screen.queryByText(/读不出角色卡数据/)).toBeNull();
  });

  it('adds a line for PNGs that could not be read as a character card', () => {
    panel({ summary: zipSummary(bundleOf({ characterCards: 6, readableCards: 4 })) });
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText('另有 2 个 PNG 读不出角色卡数据')).toBeTruthy();
  });

  it('falls back to the chat-derived character count for a plain (non-zip) import', () => {
    panel({ summary: { ...summary, characters: ['小雨', '林'], bundle: null, fromZip: false } });
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.queryByText(/读不出角色卡数据/)).toBeNull();
  });
});

/** The site owner read the six bucket buttons as «too few categories» (2026-09-09). */
describe('ImportPanel: the other kind groups fold out of 「更多类别」', () => {
  it('has a collapsed section that holds the fine kinds the buckets hide', () => {
    const { container } = panel();
    const more = container.querySelector('.import-more-kinds') as HTMLDetailsElement;
    expect(more).toBeTruthy();
    expect(more.open).toBe(false);
    // Rendered, just folded: the group headings and their buttons are in the DOM.
    expect(screen.getByText(/^People & identity/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Titles/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Clothing/ })).toBeTruthy();
  });

  it('a fine kind toggles like the bucket buttons do', async () => {
    const user = userEvent.setup();
    let current = DEFAULT_ANALYZE_OPTIONS;
    const setOptions = vi.fn((fn: (o: typeof current) => typeof current) => { current = fn(current); });
    panel({ options: current, setOptions });
    await user.click(screen.getByRole('button', { name: /^Titles/ }));
    expect(current.kinds).not.toContain('title');
  });
});

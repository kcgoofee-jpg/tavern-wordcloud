/**
 * Manual blocklist, applied after tokenization. One word per line, `#` for comments,
 * `## section` for the reason category:
 *   - 分词碎片  tokenizer artifacts (这句话 -> 这 / 句话)
 *   - 预设自带  instruction words written into the text by presets, world info or plugins
 *   - 其他      anything else that should not appear
 * Blocked words are excluded from the cloud, the table and exports; the count is reported.
 */
export const MANUAL_BLOCKLIST_TEXT = `
## 分词碎片（分词器机械、没常识；根治要改分词）
句话        # 「这句话」被切成 这|句话
话说        # 「换句话说」的碎片

## 预设自带（预设/插件写进正文的指令词，不是剧情）
输入        # 「用户输入」「本轮输入」这类包装词
小此        # 某预设的自带内容

## 其他
`;

export interface BlockEntry { word: string; reason: string }

/** Parse the text above: section headers are reasons, leading words are entries, `#` starts a comment. */
export function parseManualBlocklist(text: string): BlockEntry[] {
  const out: BlockEntry[] = [];
  let reason = '手动';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('##')) { reason = line.replace(/^#+\s*/, '').replace(/（.*$/, '').trim() || '手动'; continue; }
    if (line.startsWith('#')) continue;
    const word = line.split('#')[0].trim();
    if (word) out.push({ word, reason });
  }
  return out;
}

export const MANUAL_BLOCKLIST: readonly BlockEntry[] = parseManualBlocklist(MANUAL_BLOCKLIST_TEXT);

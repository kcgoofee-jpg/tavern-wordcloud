/**
 * Ground truth for the proper-noun evaluation. Each entry was counted in the
 * original files with grep; counts are recorded so anyone can verify them.
 * This set measures proper-noun segmentation only, not overall quality.
 */
export interface GroundTruthWord {
  /** The word */
  word: string;
  /** Occurrences in the local corpus */
  occurrences: number;
  /** Why it is a word */
  why: string;
}

export const GROUND_TRUTH: GroundTruthWord[] = [
  { word: '沈砚秋', occurrences: 880, why: '主角的母亲，正文里以完整形态反复出现' },
  { word: '沈高飞', occurrences: 358, why: '主角全名（随母姓沈），「沈高飞八岁」「沈高飞说」' },
  { word: '周敬亭', occurrences: 376, why: '配角，出现在「X说」「X的声音」等人名位置' },
  { word: '尹昭', occurrences: 304, why: '配角' },
  { word: '苏挽', occurrences: 194, why: '配角' },
  { word: '韩野', occurrences: 179, why: '配角' },
  { word: '佟慧', occurrences: 104, why: '配角' },
  { word: '郑晓龙', occurrences: 63, why: '真实存在的导演，正文里作为人物出现' },
  { word: '中央戏剧学院', occurrences: 41, why: '机构全名' },
  { word: '制片主任', occurrences: 33, why: '职务名' },
  { word: '通告单', occurrences: 27, why: '行业术语' },
  { word: '排练厅', occurrences: 24, why: '地点' },
];

/** Distractors: adjacent strings that cross a word boundary. Used to measure over-merging. */
export const DECOYS: string[] = [
  '秋把',   // 沈砚秋 + 把
  '飞说',   // 高飞 + 说
  '亭的',   // 周敬亭 + 的
  '昭没',   // 尹昭 + 没
];

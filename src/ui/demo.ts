/**
 * Sample cloud shown before any file is imported. Both lists are invented — no real chat
 * log, character card or world book ever feeds this file. They are data, not UI copy, so
 * they are not dictionary keys; the language switch picks a list instead of translating one.
 */
import type { Lang } from './i18n';
import type { WordCount } from '../core/types';

const RAW_ZH: [string, number][] = [['雨夜', 96], ['书房', 71], ['旧信', 64], ['沉默', 58], ['月台', 52], ['咖啡', 49], ['秘密', 47], ['钥匙', 43], ['晚风', 41], ['回头', 39], ['电话', 37], ['第一次', 35], ['窗外', 34], ['名字', 32], ['合同', 30], ['走廊', 29], ['台词', 27], ['故事', 26], ['安静', 25], ['门口', 24], ['抽屉', 22], ['照片', 21], ['海边', 20], ['诚实', 19], ['地铁', 18], ['答案', 17], ['清晨', 16], ['犹豫', 15], ['决定', 15], ['桌上', 14], ['过去', 13], ['信封', 12], ['厨房', 12], ['声音', 11], ['傍晚', 11], ['真相', 10], ['借口', 10], ['路灯', 9], ['告别', 9], ['开始', 8]]; // i18n-exempt: sample data

/**
 * The English visitor's first screen. Same shape as the Chinese list — two invented names,
 * then places, objects and feelings thinning out along a comparable long tail — so the
 * sample still reads as one story's word count rather than as a vocabulary list.
 */
const RAW_EN: [string, number][] = [['Elias', 98], ['rain', 73], ['lighthouse', 65], ['silence', 59], ['letter', 54], ['Nora', 50], ['harbor', 46], ['coffee', 44], ['secret', 42], ['key', 39], ['midnight', 37], ['whisper', 35], ['coat', 33], ['promise', 32], ['station', 30], ['hallway', 28], ['photograph', 27], ['storm', 26], ['name', 25], ['lantern', 23], ['attic', 22], ['fog', 21], ['goodbye', 20], ['truth', 19], ['doorway', 18], ['envelope', 17], ['kitchen', 16], ['footsteps', 16], ['regret', 15], ['tide', 14], ['winter', 13], ['notebook', 13], ['apology', 12], ['pier', 11], ['courage', 11], ['dusk', 10], ['matches', 9], ['excuse', 9], ['warmth', 8], ['beginning', 8]];

const toWords = (raw: [string, number][]): WordCount[] => raw.map(([text, count]) => ({ text, count }));

export const DEMO_WORDS: WordCount[] = toWords(RAW_ZH);
export const DEMO_WORDS_EN: WordCount[] = toWords(RAW_EN);

/**
 * Follows the interface language (settings.lang), so the language button swaps the sample in
 * the same render it swaps the copy — no reload. Both arrays are module constants, so their
 * identity is stable and the caller's useMemo does not relayout the cloud for nothing.
 */
export function demoWords(lang: Lang): WordCount[] {
  return lang === 'en' ? DEMO_WORDS_EN : DEMO_WORDS;
}

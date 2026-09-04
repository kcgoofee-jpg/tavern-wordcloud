/** Sample cloud shown before any file is imported. Fictional words; not UI copy, so not translated. */
import type { WordCount } from '../core/types';

const RAW: [string, number][] = [['雨夜', 96], ['书房', 71], ['旧信', 64], ['沉默', 58], ['月台', 52], ['咖啡', 49], ['秘密', 47], ['钥匙', 43], ['晚风', 41], ['回头', 39], ['电话', 37], ['第一次', 35], ['窗外', 34], ['名字', 32], ['合同', 30], ['走廊', 29], ['台词', 27], ['故事', 26], ['安静', 25], ['门口', 24], ['抽屉', 22], ['照片', 21], ['海边', 20], ['诚实', 19], ['地铁', 18], ['答案', 17], ['清晨', 16], ['犹豫', 15], ['决定', 15], ['桌上', 14], ['过去', 13], ['信封', 12], ['厨房', 12], ['声音', 11], ['傍晚', 11], ['真相', 10], ['借口', 10], ['路灯', 9], ['告别', 9], ['开始', 8]]; // i18n-exempt: sample data

export const DEMO_WORDS: WordCount[] = RAW.map(([text, count]) => ({ text, count }));

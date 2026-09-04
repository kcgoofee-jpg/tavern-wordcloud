---
name: wc-verify
description: 一把跑完 tavern-wordcloud 的全部检查（typecheck / lint / test / audit / eval）并只按退出码判定，改完代码后用。
---

在 tavern-wordcloud 目录下依次执行，每一步看退出码，任何一步非 0 就停下来修，不要继续：

1. `npm run typecheck`
2. `npm run lint`
3. `npm test`（`.env.local` 里的 WC_AI_* 不要导出到环境，否则「没配密钥」用例会红）
4. 改过 `src/ui/**` 或 `src/theme/**` 时：`npm run audit`，然后用 Read 看 `/tmp/shot/*.png`，至少看示例页、导入页、词云和改动过的面板
5. 改过 `src/core/**` 分词时：`npm run eval`（基线 107/108）和 `npm run eval:junk`（垃圾率：fixtures 0/40、本机真实语料 ≤2/40）

6. 想要数字而不只是红绿：`npm run optimize:measure && npm run optimize:gate`（写入 notes/optimize/metrics.jsonl，按 baseline.json 判定；UI 有意改动时 `node tools/optimize/visual.mjs /tmp/opt --update` 更新像素基线）

最后汇报每一步的退出码和测试计数，不要只说「通过」。

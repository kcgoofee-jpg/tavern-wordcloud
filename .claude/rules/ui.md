---
paths:
  - "src/ui/**"
---

# UI 规则（src/ui）

- 新的界面状态不进 App.tsx 的 useState：设置进 `hooks/useSettings`，长任务进 `hooks/useAnalyzeWorker`，弹层/面板互斥进 `hooks/useOverlay`。
- 新面板一文件一个放 `panels/`，在 `panels/index.ts` 导出，在 App 的 `PanelId` 和 `panelMeta` 登记；有设置的加 `RESET_SCOPE`。
- 新样式新建 `styles/NN-名字.css` 并登记进 `styles/index.css`，颜色/字号/圆角只用 `00-tokens-base.css` 的变量；手机覆盖写在 `37-mobile-overrides.css`，它必须保持最后。
- 用户可见文字一律 `t('中文原文')`，key 必须是字面量；核心层来的动态文本用 `tx()` / `txv()`。
- 每个新按钮或面板要有 `test/ui/*.test.tsx`（happy-dom）断言存在、启停、开合；worker 用桩、fetch 打离线。
- 改完跑 `npm run audit`，看 /tmp/shot 里的截图，别凭代码想象布局。

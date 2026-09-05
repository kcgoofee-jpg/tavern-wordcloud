---
paths:
  - "server/**"
---

# 服务端规则（server）

- 不记正文、不记查询串、不接受客户端传来的密钥；模型配置只从 `WC_AI_*` 环境变量读。
- 拒绝响应带 `code` 字段（前端按 code 翻译），中文 `error` 只是旧客户端的回退。
- 「客户端断开就中止上游」挂在 `res` 的 close 上，不是 `req`。
- 后台页只有一段内联脚本：`/admin/live` 轮询器（≤60 行，无外部依赖、无 eval、只写 `textContent`）。
  再加脚本要有很硬的理由；`server/test/server.test.ts` 的 `expectOnlyLivePoller` 钉死了它是唯一一段。
- 后台页每个表单的 303 都回到自己区块的 `#anchor`，别写成回顶部；自动刷新开关走 fetch，根本不跳转。
- `server/**` 不在 `tsc -b` 的覆盖范围里（`tsconfig.*.json` 只 include `src` 和 `vite.config.ts`），
  改服务端要么跑 `npx vitest run server/test`，要么单独 `npx tsc --ignoreConfig ...` 过一遍。
- `server/test/server.test.ts` 起真进程，需要 `npx vite-node` 可用。

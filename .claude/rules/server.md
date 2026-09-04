---
paths:
  - "server/**"
---

# 服务端规则（server）

- 不记正文、不记查询串、不接受客户端传来的密钥；模型配置只从 `WC_AI_*` 环境变量读。
- 拒绝响应带 `code` 字段（前端按 code 翻译），中文 `error` 只是旧客户端的回退。
- 「客户端断开就中止上游」挂在 `res` 的 close 上，不是 `req`。
- 后台页无脚本；`test/server.test.ts` 起真进程，需要 `npx vite-node` 可用。

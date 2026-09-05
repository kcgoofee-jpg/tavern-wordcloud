---
paths:
  - "server/**"
---

# 服务端规则（server）

- 不记正文、不记查询串、不接受客户端传来的密钥；模型配置只从 `WC_AI_*` 环境变量读。
- 拒绝响应带 `code` 字段（前端按 code 翻译），中文 `error` 只是旧客户端的回退。
- 「客户端断开就中止上游」挂在 `res` 的 close 上，不是 `req`。
- 后台页只有一段内联脚本：`/admin/live` 轮询器 + `data-quiet` 表单的 fetch 提交（≤60 行，无外部依赖、无 eval、只写 `textContent`）。
  再加脚本要有很硬的理由；`server/test/server.test.ts` 的 `expectOnlyLivePoller` 钉死了它是唯一一段，
  `server/test/admin-script.test.ts` 在 happy-dom 里真跑它一遍。
- 后台页每个表单的 303 都回到自己区块的 `#anchor`，别写成回顶部。
- **控件标签里印当前状态的，状态词一律走 `data-live`**：措辞只在 `toggleStates()` 写一次，页面渲染它、
  `GET /admin/live` 也答它，脚本在保存成功后立刻轮一次写回去。别在标签里直接内联 `x ? 'A' : 'B'`——
  quiet 保存不重载，那句话会跟操作反着说（2026-09-05 实测复现）。轮询器写字符串按原样进 `textContent`，
  只有数字过 `fmt`；这四个状态由 `server/test/admin-live-state.test.ts` 与 `admin-script.test.ts` 一起钉。
- 表单加 `quiet=1` 就答 204、不跳转；不加就 303。这一条在 admin 分发处统一处理（读一次请求体 → `quiet` → `back()`），
  新加的后台动作只要照常调 `back('anchor')` 就两条路都有了，不要自己再写一个 204 分支。
- `server/` 和 `tools/` 由 `tsconfig.server.json` 覆盖，`test/` 由 `tsconfig.test.json` 覆盖，两者都挂在 `tsc -b` 上，
  所以 `npm run typecheck` 是全覆盖的（2026-09-05 补，之前只查 `src`）。改了 include 之后要用注入错误验证它真的在查。
- `server/test/server.test.ts` 起真进程，需要 `npx vite-node` 可用。

---
paths:
  - "src/core/**"
  - "src/worker/**"
  - "src/theme/**"
  - "src/net/**"
---

# 核心层规则（core / worker / theme / net）

- 零 DOM、零 React；Node 也要能跑（服务端复用同一份代码）。
- 用户可见中文必须 `zh('…')` 标记；带变量的返回 `{ key: zh('… {n} …'), params }`（UserText），不要拼字符串。`test/i18n.test.ts` 会扫。
- 清洗用白名单结构判据，不用黑名单；分词不引大模型和词典文件；改分词先跑 `npm run eval`（基线 107/108）。
- 长任务的进度/日志/中止只有一套形状（worker 的 `job`），服务端路径转成同一形状。

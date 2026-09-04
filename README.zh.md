[English](README.md) · **中文**

# tavern-wordcloud · 酒馆词云

把 SillyTavern 的聊天记录变成词云，在浏览器里完成，可以完全离线。
网页版：<https://wordcloud.davidzhao.top>

```
 .jsonl / .json / .txt / .zip / .png
        │
        ▼
  解析 ──► 清洗 ──► 分词 ──► 加权与排版 ──► PNG / CSV
                     │
                     └── 可选：让你自己指定的大模型挑关键词
```

## 原理

**解析。** 输入就是酒馆自己导出的东西：单份聊天（`.jsonl` / `.json`）、纯文本导出（`.txt`）、整包备份（`.zip`），以及本工具导出的 PNG。整包里的世界书和角色卡关键词会当作专名词典，设置和角色卡里保存的正则脚本会当作清洗规则。本工具导出的 PNG 在 `tEXt` 块里带着完整词表和配色，拖回来就能复现，不需要原始记录。

**清洗。** 插件会把状态栏、变量块、网页代码、选项列表、思维链写进正文。清洗是一套**白名单结构规则**：非标准标签整块删，没闭合的 `<style>` / `<script>` 切到结尾，裸 CSS 或 JS 按连续三行代码形状判定，键值状态块和折叠摘要丢弃。随后跑你自己的正则脚本，再用统计删掉「大多数消息里各出现一次」的模板行，最后是站长维护的禁词表。用白名单而不是黑名单，是因为新插件出现时黑名单会静默漏网。

**分词。** 不带词典文件，不带模型。先用浏览器自带的 `Intl.Segmenter` 粗切，再按凝固度把碎片粘回词：候选至少出现四次、频次不低于其最高频部件的三分之一、且不含虚词。人名对任何分词器都是未登录词，所以走另一条路：九类上下文线索（「X说」「X的」、直接称呼等）把一个字串提升为人名，直接进词典；世界书关键词进同一个词典；再用最长匹配套回去。停用词、英文词形归并（`needs / needed / needing → need`，且只在原形真在文中出现时合并）、时间/地点/露骨词分类收尾。在所有消息里均匀铺开的词会被标成「常见词」、默认不进云；故事词是成簇出现的。108 题专名评测 107/108。

**加权与排版。** 字号随词频。词沿螺旋线摆进画布；十套配色用 OKLCH 生成，明度随词频单调。导出时冻结基准位姿，所以 PNG 按构造不重叠，可选屏幕的 1 到 3 倍。

**关键词模式（可选）。** 不数词频，而是让大模型读一遍清洗后的全文，挑出属于这个故事的词。模型会转述，所以每个挑出的词都要在原文里逐字核对，不存在的直接丢掉。字号仍然用本地词频。

### 使用你自己的 API 密钥时

不配接口、不手动触发，这个应用不会调用任何模型。所有请求都是 OpenAI 风格的 `POST /v1/chat/completions`，带 `Authorization: Bearer <你的密钥>`。

| 功能 | 何时触发 | 发出去什么 | 收回什么、怎么用 |
|---|---|---|---|
| 拉取模型列表 | 点「拉取可选模型」 | `GET <base>/models`，只带密钥 | `data[].id` 填进模型下拉框 |
| 关键词模式 | 点「开始挑词」 | 一条 system 提示（逐字复制、每条 1–10 字、挑故事独有的词、多要 40%）加上**清洗后的全文**作为 user 消息；`temperature 0.3`，流式 | 一行一个词加一段简短理由；原文里不存在的词直接丢弃；字号用本地词频 |
| 大模型分词 | 接口面板里勾选并手动运行 | 切词规则与示例，加上按每块不超过 1200 字切开的正文，`temperature 0`，同时两块 | 每块一个 JSON 数组；拼不回原文的块退回本地分词，并在日志里标出 |
| 为这份记录写清洗规则 | 点「写规则」 | 写规则的提示，加上**至多 5 条原始消息、每条不超过 2500 字** | 一个正则 JSON 数组；每条先在样本上试，删不到东西或删掉超过 70% 的丢弃 |

边界：密钥只存在你浏览器的本地存储里，明文。网页版为了绕过不开跨域的供应商，请求经本站 `/api/relay` 中转；中转只转发目标地址、请求体和 `Authorization` 头，只放行 `/chat/completions` 和 `/models`，不存任何东西。网站自己不提供任何模型密钥：关键词模式只能用你自己配置的接口，服务器只负责中转，不接受也不保存任何人的密钥。

## 本地运行

本地版就是一个 `index.html`。所有处理在你的浏览器里完成，不出网。

**一条命令。** macOS / Linux：

```bash
curl -fsSL https://wordcloud.davidzhao.top/install.sh | sh
```

Windows（PowerShell）：

```powershell
irm https://wordcloud.davidzhao.top/install.ps1 | iex
```

它把单文件下载到 `~/tavern-wordcloud/`，加一个 `tavern-wordcloud` 命令在 `127.0.0.1:5181` 起服务并打开。以后运行 `tavern-wordcloud`，或直接双击那个文件。

**不装脚本。** 下载 <https://wordcloud.davidzhao.top/download/index.html>，双击打开。想校验文件：`curl -s https://wordcloud.davidzhao.top/download/index.html.sha256` 给出当前构建的 SHA-256，和 `shasum -a 256 index.html` 对比。

**从源码构建。**

```bash
git clone https://github.com/kcgoofee-jpg/tavern-wordcloud.git
cd tavern-wordcloud
npm install
npm run build:single      # → dist-single/index.html
npm start                 # 构建并在本机起服务，带局域网地址
```

聊天记录在 `<酒馆目录>/data/default-user/chats/<角色卡名>/*.jsonl`。拖一个、拖几个、或拖整个文件夹都行。

## 功能一览

词频云与关键词云 · 用你自己的正则脚本清洗插件残留 · 中英文分词与自动识别人名 · 露骨词按类别标注、一键隐藏或只看 · 十套配色、自定义颜色、字体 · PNG（1–3 倍、透明底、内嵌词表）与 CSV 导出 · 匿名社区排行榜（可关） · 中英双语界面。界面操作见[使用手册](docs/使用手册.md)。

## 隐私

- 网页版服务器不保存正文、不记录查询串，处理完即丢。
- 本地版不发任何网络请求。
- 模型密钥只在浏览器里，服务器永不接受。

## 开发

```
npm run dev            # 本机开发
npm test               # vitest；依赖本机酒馆数据的用例找不到数据会跳过
npm run typecheck      # tsc -b
npm run lint           # oxlint
npm run audit          # 无头 Chrome 布局自检，桌面 + 手机
npm run eval           # 专名分词评测
npm run eval:junk      # TOP 40 里的垃圾词占比
```

```
src/core/     解析、清洗、分词、统计（纯逻辑，Node 也能跑）
src/render/   螺旋布局与画布绘制
src/theme/    配色与字体
src/legal/    五份法律文件（中英）
src/ui/       React 界面
src/worker/   在 Web Worker 里跑 core
tools/        构建、截图、评测
test/         vitest
```

本仓库是私有开发仓库的只读镜像；欢迎提 Issue，PR 请在说明里注明。每次推送都会跑 typecheck、lint、构建和测试。

## 许可

MIT

## 许可证

MIT，见 [LICENSE](LICENSE)。网页版由作者自行运营；这个仓库里的代码是给你自建用的。

[English](README.md) · **中文**

# tavern-wordcloud · 酒馆词云

把 SillyTavern 的聊天记录变成词云。不带词典文件，不带模型。

网页版：<https://wordcloud.davidzhao.top>

## 本地运行

本地版就是一个 `index.html`。所有处理在你的浏览器里完成；除非你主动选用那两款需要下载的繁体字体，否则不出网。

**一条命令。** macOS / Linux：

```bash
curl -fsSL https://wordcloud.davidzhao.top/install.sh | sh
```

把单文件下载到 `~/tavern-wordcloud/`，先与官方公布的 SHA-256 对比、不符就拒装，然后加一个 `tavern-wordcloud` 命令（软链到 `~/.local/bin`）用 `python3` 在 `127.0.0.1:5181` 起服务并打开。以后运行 `tavern-wordcloud`。

Windows（PowerShell）：

```powershell
irm https://wordcloud.davidzhao.top/install.ps1 | iex
```

把同一个文件下载到 `%USERPROFILE%\tavern-wordcloud\`，同样校验 SHA-256，然后打开。它**不装命令、不起服务**——单文件直接从 `file://` 就能跑。以后双击 `index.html`。

**不装脚本。** 下载 <https://wordcloud.davidzhao.top/download/index.html>，双击打开。想校验文件：`curl -s https://wordcloud.davidzhao.top/download/index.html.sha256` 给出当前构建的 SHA-256，和 `shasum -a 256 index.html` 对比。

**更新。** 本地版不会自己更新——下载下来是哪个版本就一直是哪个版本，而且它也无从知道有了新版。想换成当前构建，重跑上面那行安装命令即可：它会覆盖同一个文件并重新校验 SHA-256。手动下载的重新下一次；从源码构建的 `git pull` 后重新构建。

**从源码构建。**

```bash
git clone https://github.com/kcgoofee-jpg/tavern-wordcloud.git
cd tavern-wordcloud
npm install
npm run build:single      # → dist-single/index.html
npm start                 # 构建并在本机起服务，带局域网地址
```

`npm start` 的提示是中英双语。默认监听 5180，被占用就自动往后找一个空闲端口并在启动信息里说明用的是哪个；`PORT=5190 npm start` 换起始端口。

聊天记录在 `<酒馆目录>/data/default-user/chats/<角色卡名>/*.jsonl`。拖一个、拖几个、或拖整个文件夹都行。

## 深入了解

- [使用手册](docs/使用手册.md)——功能与界面说明。
- [原理与隐私](docs/原理与隐私.md)——解析、清洗、分词的原理，以及接了 API 发什么收什么。

## 许可证

MIT，见 [LICENSE](LICENSE)。本仓库是私有开发仓库的只读镜像；欢迎提 Issue，PR 请在说明里注明。

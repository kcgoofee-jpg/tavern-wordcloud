**English** · [中文](README.zh.md)

# tavern-wordcloud

Turn SillyTavern chat logs into a word cloud. No dictionary files, no models.

Web edition: <https://wordcloud.davidzhao.top>

## Run it locally

The local edition is one `index.html`. Everything happens in your browser, and nothing goes online — with one exception: picking either of the Traditional Chinese fonts in the font panel fetches it from Google Fonts. Leave them alone and the page never touches the network.

**One command.** macOS / Linux:

```bash
curl -fsSL https://wordcloud.davidzhao.top/install.sh | sh
```

Downloads the single file to `~/tavern-wordcloud/`, checks it against the published SHA-256 and refuses to install on a mismatch, then adds a `tavern-wordcloud` command (symlinked into `~/.local/bin`) that serves the file on `127.0.0.1:5181` with `python3`, and opens it. Afterwards run `tavern-wordcloud`.

Windows (PowerShell):

```powershell
irm https://wordcloud.davidzhao.top/install.ps1 | iex
```

Downloads the same file to `%USERPROFILE%\tavern-wordcloud\`, checks the SHA-256 the same way, and opens it. It installs **no command and starts no server** — the single file runs straight from `file://`. Afterwards double-click `index.html`.

**No script.** Download <https://wordcloud.davidzhao.top/download/index.html> and open it. To verify the file: `curl -s https://wordcloud.davidzhao.top/download/index.html.sha256` prints the SHA-256 of the current build; compare with `shasum -a 256 index.html`.

**Updating.** Nothing updates itself — the copy you downloaded stays on the version it was, and it cannot tell you a newer one exists. Re-run the install command above whenever you want the current build: it overwrites the same file and re-checks the SHA-256. If you downloaded by hand, download it again; from source, `git pull` and build again.

**From source.**

```bash
git clone https://github.com/kcgoofee-jpg/tavern-wordcloud.git
cd tavern-wordcloud
npm install
npm run build:single      # → dist-single/index.html
npm start                 # build and serve it locally, with a LAN address
```

`npm start` prints its addresses in English and Chinese. It listens on 5180, or on the next free port if that one is taken — the banner says which it picked. `PORT=5190 npm start` sets the starting point.

Chat logs live in `<SillyTavern>/data/default-user/chats/<character>/*.jsonl`. Drop one file, several, or the whole folder.

## Learn more

- [User manual](docs/manual.en.md) — features and interface.
- [How it works](docs/how-it-works.md) — parsing, cleaning, tokenization, privacy, and what is sent when you use an API key.

## License

MIT — see [LICENSE](LICENSE). This repository is a read-only mirror of the private development repository; issues are welcome, pull requests should say so in the description.

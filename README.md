**English** · [中文](README.zh.md)

# tavern-wordcloud

Turn SillyTavern chat logs into a word cloud, in the browser, offline.
Hosted version: <https://wordcloud.davidzhao.top>

```
 .jsonl / .json / .txt / .zip / .png
        │
        ▼
  parse ──► clean ──► tokenize ──► weight & layout ──► PNG / CSV
                        │
                        └── optional: a language model of your choice picks the keywords
```

## How it works

**Parse.** Input is whatever SillyTavern exports: a single chat (`.jsonl` / `.json`), a plain-text export (`.txt`), a full backup (`.zip`) or a PNG made by this tool. From a backup the lorebook and character-card keywords become a proper-noun dictionary, and the regex scripts saved in settings and cards become cleaning rules. A PNG exported here carries its own word table and palette in a `tEXt` chunk, so dragging it back reproduces the cloud without the original log.

**Clean.** Plugins write status bars, variable blocks, HTML, option lists and chain-of-thought into the message text. Cleaning is a **whitelist of structural rules**: non-standard tags are removed whole, unclosed `<style>` / `<script>` blocks are cut to the end, bare CSS or JS is recognised by three consecutive lines of code shape, key–value status blocks and collapsed summaries are dropped. Your own regex scripts run next, then a statistical pass removes template lines that appear once in most messages, then the maintainer's block lists. Whitelists rather than blacklists, because a new plugin would otherwise leak silently.

**Tokenize.** No dictionary files, no models. The browser's own `Intl.Segmenter` makes the first cut; fragments are glued back into words by cohesion (a candidate must occur at least four times, be at least a third as frequent as its most frequent part, and contain no function word). Names are unknown words to every segmenter, so they take a separate path: nine context cues (「X said」, 「X's」, direct address, and so on) promote a string to a person name, which then enters the dictionary directly. Lorebook keywords join the same dictionary; a longest-match merge applies it. Stop words, English lemma merging (`needs / needed / needing → need`, only when the base form exists in the text) and a classifier for time, place and explicit vocabulary finish the job. Words spread evenly over all messages are tagged *common* and hidden from the cloud by default; story words cluster. A 108-item proper-noun benchmark scores 107/108.

**Weight and layout.** Font size follows frequency. Words are placed on a spiral in a canvas; the ten palettes are generated in OKLCH so lightness stays monotonic with frequency. Export freezes the base pose, so the PNG is overlap-free by construction, at 1× to 3× the screen size.

**Keyword mode (optional).** Instead of counting, a language model reads the whole cleaned chat once and picks the words that belong to this story. Models paraphrase, so every picked word is verified against the text and dropped if it does not occur verbatim. Font sizes still come from the local counts.

### With your own API key

Nothing here calls a model unless you configure an endpoint and trigger it yourself. Every request is an OpenAI-style `POST /v1/chat/completions` with `Authorization: Bearer <your key>`.

| Feature | Trigger | What is sent | What comes back and how it is used |
|---|---|---|---|
| Load model list | "Load model list" button | `GET <base>/models`, key only | `data[].id` fills the model picker |
| Keyword mode | "Start picking" button | one system prompt (copy verbatim, 1–10 characters, story-specific words, ask for 40 % extra) plus the **whole cleaned chat** as the user message; `temperature 0.3`, streamed | one word per line plus a short rationale; words absent from the text are discarded; sizes come from local counts |
| Model tokenization | checkbox in the endpoint panel, run manually | segmentation rules with examples plus the text in chunks of ≤1200 characters, `temperature 0`, two chunks at a time | a JSON array per chunk; a chunk that does not join back into the original falls back to local tokenization and is noted in the log |
| Cleaning rules for this log | "Write rules" button | rule-writing prompt plus **at most 5 raw messages, ≤2500 characters each** | a JSON array of regexes; each is tested on the samples and kept only if it removes something without removing more than 70 % |

Boundaries: the key lives only in your browser's local storage, in plaintext. On the hosted version requests go through the site's `/api/relay` to get around providers without CORS; the relay forwards the target URL, the body and the `Authorization` header, allows only `/chat/completions` and `/models`, and stores nothing. The site provides no model key of its own: keyword mode only works with your own endpoint, and the server merely relays the request — it never accepts or stores a key from anyone else.

## Run it locally

The local edition is one `index.html`. Everything happens in your browser; nothing goes online.

**One command.** macOS / Linux:

```bash
curl -fsSL https://wordcloud.davidzhao.top/install.sh | sh
```

Windows (PowerShell):

```powershell
irm https://wordcloud.davidzhao.top/install.ps1 | iex
```

This downloads the single file to `~/tavern-wordcloud/`, adds a `tavern-wordcloud` command that serves it on `127.0.0.1:5181`, and opens it. Afterwards run `tavern-wordcloud` or double-click the file.

**No script.** Download <https://wordcloud.davidzhao.top/download/index.html> and open it. To verify the file: `curl -s https://wordcloud.davidzhao.top/download/index.html.sha256` prints the SHA-256 of the current build; compare with `shasum -a 256 index.html`.

**From source.**

```bash
git clone https://github.com/kcgoofee-jpg/tavern-wordcloud.git
cd tavern-wordcloud
npm install
npm run build:single      # → dist-single/index.html
npm start                 # build and serve it locally, with a LAN address
```

Chat logs live in `<SillyTavern>/data/default-user/chats/<character>/*.jsonl`. Drop one file, several, or the whole folder.

## Features in brief

Frequency and keyword clouds · cleaning of plugin residue with your own regex scripts · Chinese and English with automatic name detection · explicit words tagged by category, one switch to hide or isolate · ten palettes, custom colours, fonts · PNG (1–3×, transparent, embedded table) and CSV export · anonymous community board (optional) · interface in Chinese and English. The [user manual](docs/manual.en.md) covers the interface.

## Privacy

- The hosted server keeps no chat text and logs no query strings; text is discarded after processing.
- The local edition never makes a network request.
- Model keys stay in the browser; the server never accepts one.

## Development

```
npm run dev            # local development
npm test               # vitest; corpus tests skip without local SillyTavern data
npm run typecheck      # tsc -b
npm run lint           # oxlint
npm run audit          # headless Chrome layout audit, desktop + phone
npm run eval           # proper-noun tokenization benchmark
npm run eval:junk      # filler-word rate in the TOP 40
```

```
src/core/     parse, clean, tokenize, count (pure logic, runs in Node too)
src/render/   spiral layout and canvas drawing
src/theme/    palettes and fonts
src/legal/    the five legal documents (zh + en)
src/ui/       React interface
src/worker/   runs core in a Web Worker
tools/        build, screenshot, evaluation
test/         vitest
```

This repository is a read-only mirror of the private development repository; issues are welcome, pull requests should say so in the description. CI runs typecheck, lint, build and tests on every push.

## License

MIT

## License

MIT — see [LICENSE](LICENSE). The hosted instance is run by the author; the code here is what you deploy yourself.

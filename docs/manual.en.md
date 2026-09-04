**English** · [中文](使用手册.md)

# User manual

How it works (parsing, cleaning, tokenization, and what is sent when you use an API key) is in the repository [README](../README.md). This page covers the interface.

Two ways to use it. **The only difference: whether your chat text goes to a server.**

| | Local edition | Web edition |
|---|---|---|
| Where | one file on your computer | https://wordcloud.davidzhao.top |
| Where the text goes | never leaves your machine | uploaded, processed in memory, discarded |
| Keyword mode (model picks words) | your own endpoint; the browser calls it directly (some providers block CORS) | your own endpoint, relayed by the server when needed |
| Install | one command, or download one file | nothing |

## Local edition

macOS / Linux:

```bash
curl -fsSL https://wordcloud.davidzhao.top/install.sh | sh
```

Windows (PowerShell):

```powershell
irm https://wordcloud.davidzhao.top/install.ps1 | iex
```

This downloads the same single-file `index.html` the site serves to `~/tavern-wordcloud/` and opens it. Later: run `tavern-wordcloud`, or double-click the file. Without the script: download https://wordcloud.davidzhao.top/download/index.html and open it.

Everything in the local edition runs inside your browser and works offline. The interface is the same as the web edition, except the entry line reads "Everything is processed on this computer" and there is no community board.

## Web edition

Open https://wordcloud.davidzhao.top. You see a sample cloud first; click anywhere to reach the import page. Everything else is identical to the local edition.

## The interface

1. Drop SillyTavern exports onto the import page. Accepted:
   - a single chat `.jsonl` / `.json`
   - a plain-text export `.txt`
   - a full backup `.zip` (recommended: world-info and character-card keywords become a proper-noun dictionary, and regex scripts from the settings and cards are applied as cleaning rules)
   - `regex-*.json` exported by the Regex extension, together with the chat files
   - a cloud `.png` exported here: drop it back to reproduce the cloud
2. By default only **your** messages are counted. Open the Filters panel on the left to include the character's lines.
3. Left rail, top to bottom: add files, Filters & tokenizing, word table, advanced, model endpoint, export, clear.
4. Bottom left: palette, font, and the chat's card info (character, model, size, dates).
5. Top right: site notice (web only; the bell appears when the operator has published one, with a dot until you open it), community board (web only), language, light/dark.

Word kinds in **Filters & tokenizing**: Other / Names / Places / Time / Common words. Names are off by default (they dominate the counts); *Common words* are words spread evenly across all messages that do not belong to this story, also off by default, one click to bring them back. "See which words are in each kind" below the buttons lists what was classified into each kind, with counts, so misclassifications are visible.

Message counts: messages hidden with `/hide` still count under their speaker (SillyTavern marks them is_system, but they are your and the character's lines); real system notices are not counted.

**Export** (rail icon) opens a panel:

- Image: 1×, 2× or 3× the on-screen size (the pixel size is shown), optional transparent background, and an embedded word table plus palette. Drag such a PNG back onto the site and the cloud is reproduced without the original log.
- Word table: CSV of the words shown in the cloud or of every counted word, with a BOM so Excel opens it correctly. Columns: word, count, kind.
- File names follow one rule: `wordcloud_<card>_<frequency|keywords>_<date-time>_<N>words.png` (tables end in `_table.csv`); the Chinese interface uses `酒馆词云_…`.

**Community board** (chart icon, top right, web only): first click shows the board with aggregate statistics, second click shows only the community cloud, third click returns to your own cloud. The board aggregates the merged cloud only (frequent words with counts, message and character counts); card names are neither collected nor shown. Take part only if you are entitled to share statistics of the log.

**Keyword mode** (switch at the top): a model reads the whole chat once and picks the words that are specific to this story. One request, one to five minutes. On both the web and local editions, fill in an endpoint, model and key in the Model endpoint panel first; the web edition just relays the request through the server when needed.

### What happens when you configure your own endpoint

| Feature | Trigger | Sent | Returned |
|---|---|---|---|
| Load model list | "Load model list" | `GET /models` with the key only | list of model names |
| Keyword mode | "Start picking" | one prompt plus the whole cleaned chat | one word per line; words absent from the text are dropped |
| Model tokenization | checkbox in the panel, run manually | segmentation rules plus the text in chunks of ≤1200 characters | a JSON array per chunk; chunks that do not join back fall back to local tokenization |
| Cleaning rules | "Write rules" | a prompt plus at most 5 raw messages (≤2500 characters each) | regexes, each tested on the samples before use |

The key stays in your browser; the web edition's relay forwards only the URL, the body and the authorization header and stores nothing. Full details in the README section "With your own API key".

## Where cleaning rules come from

The cloud should not contain what plugins write into the text (status bars, variable blocks, options, chain-of-thought). Cleaning has four layers and needs no configuration:

1. Structural rules: non-standard tags are removed whole, along with HTML, bare JSON, key-value status blocks and collapsed summaries.
2. Your own regex scripts: drop `regex-*.json` or a full `.zip`; those scripts describe exactly the format your preset makes the model emit.
3. Statistical rules: a line present in most messages, or a word at the start or end of most messages, is treated as a template.
4. Block lists: the operator's manual and automatic lists; can be disabled in Advanced.

When a word in the table should not be there, click the ⚠ next to it to send feedback; the operator reviews it and updates the rules.

## Frequently asked questions

**Why so few words?** Only your messages are counted by default. Add the character's lines in Filters.

**Words like "that one", "a wave of", "extremely" show up.** Demonstrative + classifier combos, degree adverbs and relative-position words are now stop words; anything left can be hidden with × in the word table, and ⚠ sends feedback. Words spread evenly over every message are tagged *Common words* and hidden by default.

**Why is a name split into pieces?** Names are unknown words; the tool discovers them statistically. Drop the full `.zip` so world-info and card keywords act as a dictionary, or add the word under Advanced → forced words.

**Cannot load the model list / Failed to fetch.** Web edition: a base URL is fine (`/chat/completions` is appended), pick the model from the list. Local edition: providers without CORS fail on a direct browser call; use the web edition or another provider.

**Reasoning models are slow.** Models that "think" first take close to a minute per chunk and may exceed five minutes for keyword picking. Use a fast model such as DeepSeek-V4-Flash.

**Does the site keep my chat?** No. The server processes the text in memory and discards it. Only the cleaning-feedback snippets you explicitly confirm are stored. See the [Privacy Policy](https://wordcloud.davidzhao.top/#/privacy).

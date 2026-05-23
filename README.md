# mupdf4llm

[![npm](https://img.shields.io/npm/v/%40nalinor%2Fmupdf4llm.svg)](https://www.npmjs.com/package/@nalinor/mupdf4llm)
[![CI](https://github.com/iamnalinor/mupdf4llm/actions/workflows/ci.yml/badge.svg)](https://github.com/iamnalinor/mupdf4llm/actions/workflows/ci.yml)
[![Docs](https://github.com/iamnalinor/mupdf4llm/actions/workflows/docs.yml/badge.svg)](https://iamnalinor.github.io/mupdf4llm/)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

TypeScript/Bun port of
[`pymupdf4llm`](https://github.com/pymupdf/RAG) on top of the official
[`mupdf`](https://www.npmjs.com/package/mupdf) WASM package. Converts
PDFs into LLM-ready Markdown with reading-order text, headers, bullets,
inline styling (bold, italic, monospaced), tables, images, and
per-word coordinates. It tracks `pymupdf4llm.to_markdown(doc)` closely —
a set of synthetic fixtures match exactly, but real-world PDFs can
diverge; the
[parity & limits guide](https://iamnalinor.github.io/mupdf4llm/guide/parity-and-limits)
documents what differs and why.

**📖 Full documentation: [iamnalinor.github.io/mupdf4llm](https://iamnalinor.github.io/mupdf4llm/)**

## Install

```sh
npm i mupdf4llm
# or
bun add mupdf4llm
```

Requires Node 20+ or Bun ≥ 1.0. The only runtime dependency is `mupdf`
(WASM, no native build).

## Quick start

```ts
import { toMarkdown } from "mupdf4llm";
import { readFileSync } from "node:fs";

const md = toMarkdown(readFileSync("paper.pdf"));
console.log(md);
```

Per-page chunks for RAG:

```ts
import { toMarkdownPages } from "mupdf4llm";

const chunks = toMarkdownPages(readFileSync("paper.pdf"), {
  extractWords: true,
});
```

See the [quick start guide](https://iamnalinor.github.io/mupdf4llm/guide/quick-start)
for more, including options, table strategies, image extraction, and the
LlamaIndex adapter.

## What's in scope

- Reading-order text extraction with header inference (`IdentifyHeaders`, `TocHeaders`)
- Multi-column layout detection
- Four table strategies: `lines_strict`, `lines`, `text`, `explicit`
- Image extraction (`writeImages`) and inline base64 embedding (`embedImages`)
- Per-word coordinates (`extractWords`)
- Form-field extraction (`getKeyValues`)
- Page rotation handling
- LlamaIndex adapter at the `mupdf4llm/llama` subpath

## What's NOT available (and why)

- **`pymupdf.layout` features** (`to_text`, `to_json`, layout-mode
  `to_markdown`) — require Artifex's closed-source `pymupdf-layout`
  ONNX wheel (Polyform Noncommercial license, no JS distribution).
- **OCR** — the official `mupdf` WASM bundle ships without
  Tesseract/Leptonica. See
  [`src/ocr/README.md`](src/ocr/README.md) for a `tesseract.js` recipe.

Detailed write-up: [parity and limits](https://iamnalinor.github.io/mupdf4llm/guide/parity-and-limits).

## Development

```sh
bun install
pip install pymupdf4llm   # required for the parity test suite
bun test                  # parity + unit tests
bun run lint              # prettier --write + eslint + tsc
bun run docs:dev          # local doc preview at http://localhost:5173
bun run build             # emits dist/{index,llama}.{js,cjs,d.ts}
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for release workflow and project layout.

## License

AGPL-3.0-or-later — inherited from
[PyMuPDF / pymupdf4llm](https://github.com/pymupdf/pymupdf4llm) and
[MuPDF](https://mupdf.com/). See [`LICENSE`](LICENSE). Commercial
licensing of MuPDF is available from
[Artifex Software](https://www.artifex.com/).

## Credits

- **Artifex Software** — author of MuPDF and the `mupdf` npm package
- **pymupdf4llm authors** — the Python algorithms this port reimplements

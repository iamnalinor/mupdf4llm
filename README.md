# mupdf4llm

[![npm](https://img.shields.io/npm/v/mupdf4llm.svg)](https://www.npmjs.com/package/mupdf4llm)
[![CI](https://github.com/iamnalinor/mupdf4llm/actions/workflows/ci.yml/badge.svg)](https://github.com/iamnalinor/mupdf4llm/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

TypeScript/Bun port of [pymupdf4llm](https://github.com/pymupdf/pymupdf4llm)'s
`to_markdown` on top of the official [`mupdf`](https://www.npmjs.com/package/mupdf)
WASM package. Converts PDFs into LLM-ready Markdown with reading-order
text extraction, header inference from font sizes, bullet lists, inline
styling (bold/italic/mono/strikethrough), and lines-strict tables.

Output is **byte-identical** to `pymupdf4llm.to_markdown(doc)` (with
`pymupdf4llm.use_layout(False)`) on the fixtures in this repository's
`tests/parity.test.ts`.

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

const buf = readFileSync("doc.pdf");
const md = toMarkdown(buf);
console.log(md);
```

Bun:

```ts
import { toMarkdown } from "mupdf4llm";
const buf = await Bun.file("doc.pdf").bytes();
console.log(toMarkdown(buf));
```

Page chunks (one record per page with metadata):

```ts
import { toMarkdownPages } from "mupdf4llm";
const chunks = toMarkdownPages(buf);
for (const c of chunks) {
  console.log(c.metadata.page, c.text.length);
}
```

## API

| Export                                                           | Description                                                                                    |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `toMarkdown(buf, opts?): string`                                 | Convert a PDF buffer to a single Markdown string.                                              |
| `toMarkdownPages(buf, opts?): PageChunk[]`                       | Convert to one chunk per page (`{ metadata, text, words, tables, images, ... }`).              |
| `IdentifyHeaders`                                                | Class that maps font sizes to `#…###` header levels.                                           |
| `TocHeaders`                                                     | Class that uses the document's TOC to assign header levels.                                    |
| `getKeyValues(doc)`                                              | Extract every PDF form field as `FormField[]` (name, value, type, bbox).                       |
| `extractWords(page)`                                             | Per-word coords: `{ x0, y0, x1, y1, text, block, line, word }[]`. Mirrors `get_text("words")`. |
| `getPageRotation`, `setPageRotation`, `removeRotation`           | Read/write the page's `/Rotate` entry.                                                         |
| `clusterStripes`, `computeReadingOrder`                          | Reading-order helpers (port subset of `pymupdf4llm.helpers.utils`).                            |
| `ProgressBar`                                                    | Minimal stderr progress wrapper, mirrors `pymupdf4llm.helpers.progress`.                       |
| `Rect`, `Point`                                                  | Geometry helpers re-exported for advanced users.                                               |
| `mupdf4llm/llama → PDFMarkdownReader`                            | LlamaIndex adapter (subpath export; `llamaindex` is an optional peer dep).                     |
| `MarkdownOptions`, `PageChunk`, `FormField`, `ImageInfo`, `Word` | TypeScript types.                                                                              |

## Options

````ts
toMarkdown(buf, {
  pages: [0, 1], // 0-based page indices; default: all pages
  margins: 0, // number | [top, bottom] | [l, t, r, b]
  ignoreCode: false, // suppress ``` blocks for monospaced fonts
  forceText: true, // emit text on top of images
  pageChunks: false, // see toMarkdownPages
  pageSeparators: false, // insert "--- end of page=N ---" between pages
  tableStrategy: "lines_strict", // "lines" | "text" | "explicit" | null to disable
  explicitTableGrids: [], // { hLines, vLines } per table for "explicit" mode
  writeImages: false, // save each image as a file under imagePath
  embedImages: false, // inline images as base64 data: URIs
  imagePath: "", // output directory for writeImages
  imageFormat: "png", // "png" | "jpg" | "jpeg"
  dpi: 150, // rasterization DPI for image extraction
  imageSizeLimit: 0.05, // skip images smaller than this fraction of the page
  extractWords: false, // emit per-word coords into PageChunk.words
  removeRotation: true, // unrotate pages before processing (restored after)
  showProgress: false, // render a progress bar on stderr
  hdrInfo: undefined, // false to skip header inference, or a custom IdentifyHeaders / TocHeaders
  filename: "", // surfaced inside PageChunk.metadata.file_path
});
```

### LlamaIndex adapter

```ts
import { PDFMarkdownReader } from "mupdf4llm/llama";

const reader = new PDFMarkdownReader();
const docs = await reader.loadData("paper.pdf");
// one Document per page; if `llamaindex` is installed it's a real Document,
// otherwise a plain { text, extra_info } record with the same shape.
````

See `src/helpers/types.ts` for the full `MarkdownOptions` interface.

## Parity & scope

What matches `pymupdf4llm.to_markdown` byte-for-byte today:

- single- and multi-column text layout (port of `multi_column.column_boxes`)
- header levels via `IdentifyHeaders` (font-size frequency) and `TocHeaders` (document outline)
- bullet lists (`startswith_bullet` semantics)
- inline styling — bold, italic, monospaced/code, strikethrough — derived
  from MuPDF font properties
- ruled tables detected via the `lines_strict` strategy (plus tolerant
  `lines`, text-alignment `text`, and caller-supplied `explicit` modes)
- page rotation handling (`removeRotation` option, default `true`)
- form-field extraction via `getKeyValues`
- image extraction & embedding (`writeImages` / `embedImages`)
- per-word coordinates (`extractWords` → `PageChunk.words`)
- LlamaIndex adapter at `mupdf4llm/llama`

Not available (and why):

- **`pymupdf.layout` features** (`to_text`, `to_json`, layout-mode markdown)
  — require Artifex's separate closed-source `pymupdf-layout` wheel
  (an ONNX-based ML model under a Polyform Noncommercial license), which
  has no JS distribution.
- **OCR** — the official `mupdf` WASM bundle is built without
  Tesseract/Leptonica (`"No OCR support in this build"`). See
  `src/ocr/README.md` for a recipe using `tesseract.js`.

## Development

```sh
bun install
pip install pymupdf4llm   # required for parity tests
bun run typecheck
bun test
bun run lint              # prettier --write . && eslint . && tsc --noEmit
bun run build             # emits dist/{index,llama}.{js,cjs} + .d.ts files
```

## How parity is enforced

`tests/parity.test.ts` runs both implementations on each fixture:

1. Generates the fixture with `pymupdf` (`pip install pymupdf4llm`).
2. Calls `toMarkdown(buf)` in TypeScript.
3. Calls `pymupdf4llm.to_markdown(file)` in Python via `execSync`.
4. Asserts strict string equality.

CI runs the suite on every push (see `.github/workflows/ci.yml`).

See `CONTRIBUTING.md` for the release workflow.

## License

AGPL-3.0-or-later — inherited from [PyMuPDF / pymupdf4llm](https://github.com/pymupdf/pymupdf4llm)
and [MuPDF](https://mupdf.com/). See [`LICENSE`](LICENSE) for the full
text. Commercial licensing of MuPDF is available from
[Artifex Software](https://www.artifex.com/).

## Credits

- **Artifex Software** — author of MuPDF and the `mupdf` npm package.
- **pymupdf4llm authors** — the Python algorithms this port reimplements.

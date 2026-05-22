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

| Export                                            | Description                                                       |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| `toMarkdown(buf, opts?): string`                  | Convert a PDF buffer to a single Markdown string.                 |
| `toMarkdownPages(buf, opts?): PageChunk[]`        | Convert to one chunk per page (`{ metadata, text, ... }`).        |
| `IdentifyHeaders`                                 | Class that maps font sizes to `#…###` header levels.              |
| `Rect`, `Point`                                   | Geometry helpers re-exported for advanced users.                  |
| `MarkdownOptions`, `PageChunk`                    | TypeScript types.                                                 |

`toJson` and `toText` exist as placeholders that throw — they require
PyMuPDF's proprietary Layout mode which is not available in the WASM
build.

## Options

```ts
toMarkdown(buf, {
  pages: [0, 1],         // 0-based page indices; default: all pages
  margins: 0,            // number | [top, bottom] | [l, t, r, b]
  ignoreCode: false,     // suppress ``` blocks for monospaced fonts
  forceText: true,       // emit text on top of images
  pageChunks: false,     // see toMarkdownPages
  pageSeparators: false, // insert "--- end of page=N ---" between pages
  tableStrategy: "lines_strict", // or null to disable table detection
  showProgress: false,   // log per-page progress to stderr
  hdrInfo: undefined,    // pass false to skip header inference, or a custom IdentifyHeaders
  filename: "",          // surfaced inside PageChunk.metadata.file_path
});
```

See `src/types.ts` for the full `MarkdownOptions` interface.

## Parity & scope

What matches `pymupdf4llm.to_markdown` byte-for-byte today:

- single- and multi-column text layout (port of `multi_column.column_boxes`)
- header levels via `IdentifyHeaders` (font-size frequency)
- bullet lists (`startswith_bullet` semantics)
- inline styling — bold, italic, monospaced/code, strikethrough — derived
  from MuPDF font properties
- ruled tables detected via the `lines_strict` strategy (`tableFinder.ts`)

Not yet implemented (raise an issue if you need any of these):

- `pymupdf.layout` features (`to_text`, `to_json`, layout-mode markdown)
- OCR
- image extraction and embedding (`write_images` / `embed_images`)
- page rotation (`page.remove_rotation`)
- `extract_words` / `page_chunks=true` with per-word coordinates
- table strategies other than `lines_strict`
- TOC-driven headers (`TocHeaders`)

For PDFs that depend on those features the port still produces sensible
Markdown, but may diverge from the Python output.

## How parity is enforced

`tests/parity.test.ts` runs both implementations on each fixture:

1. Generates the fixture with `pymupdf` (`pip install pymupdf4llm`).
2. Calls `toMarkdown(buf)` in TypeScript.
3. Calls `pymupdf4llm.to_markdown(file)` in Python via `execSync`.
4. Asserts strict string equality.

CI runs the suite on every push (see `.github/workflows/ci.yml`).

## Development

```sh
bun install
pip install pymupdf4llm   # required for parity tests
bun run typecheck
bun test
bun run build             # emits dist/{index.js,index.cjs,index.d.ts}
```

See `CONTRIBUTING.md` for the release workflow.

## License

AGPL-3.0-or-later — inherited from [PyMuPDF / pymupdf4llm](https://github.com/pymupdf/pymupdf4llm)
and [MuPDF](https://mupdf.com/). See [`LICENSE`](LICENSE) for the full
text. Commercial licensing of MuPDF is available from
[Artifex Software](https://www.artifex.com/).

## Credits

- **Artifex Software** — author of MuPDF and the `mupdf` npm package.
- **pymupdf4llm authors** — the Python algorithms this port reimplements.

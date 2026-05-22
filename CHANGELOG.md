# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-05-22

First release. TypeScript/Bun port of
[`pymupdf4llm`](https://github.com/pymupdf/RAG)'s classic
(non-layout) backend on top of the official `mupdf` WASM package.

### Core API

- `toMarkdown(buf, opts?): string` — convert a PDF buffer to a single
  Markdown string.
- `toMarkdownPages(buf, opts?): PageChunk[]` — convert to one chunk per
  page, each with `{ metadata, toc_items, text, tables, images, words, ... }`.
- `IdentifyHeaders` — font-size-based header inference.
- `TocHeaders` — outline-based header inference.
- `getKeyValues(doc)` — AcroForm field extraction.
- `extractWords(page)` — per-word coordinates
  (`{ x0, y0, x1, y1, text, block, line, word }[]`).
- `ProgressBar` — stderr progress bar (mirrors `pymupdf4llm.helpers.progress`).
- `Rect`, `Point` — geometry primitives.
- `clusterStripes`, `computeReadingOrder` — reading-order helpers.
- `getPageRotation`, `setPageRotation`, `removeRotation` — `/Rotate`
  helpers.

### Subpath export `mupdf4llm/llama`

- `PDFMarkdownReader` — LlamaIndex adapter. Returns one `Document` (or
  plain `{ text, extra_info }`) per page. `llamaindex` is declared as
  an optional peer dependency.

### `MarkdownOptions` knobs

- Pages: `pages`, `margins`, `filename`, `pageChunks`, `pageSeparators`.
- Text: `ignoreCode`, `forceText`, `hdrInfo`.
- Tables: `tableStrategy: "lines_strict" | "lines" | "text" | "explicit" | null`,
  `explicitTableGrids`.
- Images: `writeImages`, `embedImages`, `imagePath`, `imageFormat`,
  `dpi`, `imageSizeLimit`.
- Words / chunks: `extractWords`.
- Rotation: `removeRotation` (default `true`).
- Misc: `showProgress`, `ignoreAlpha`, `fontsizeLimit`.

### Parity

Byte-for-byte parity with `pymupdf4llm.to_markdown(doc, use_layout=False)`
for single-column / multi-column text, headers, bullets, inline styling,
ruled tables (`lines_strict`), form-field extraction, and the synthetic
fixtures in `tests/parity.test.ts`. Five real-world fixtures vendored
from [py-pdf/sample-files](https://github.com/py-pdf/sample-files)
(MIT) are exercised in `tests/realFixtures.test.ts` at three tiers
(`exact` / `similar` / `smoke`).

Ligatures are decomposed by default (`ﬁ → fi`) to match
`page.get_text("rawdict")`. Pass `{ preserveLigatures: true }` to
`extractTextDict` if you need the original glyphs.

### Not available

- **`pymupdf.layout` features** (`to_text`, `to_json`, layout-mode
  `to_markdown`) — require Artifex's closed-source `pymupdf-layout`
  ONNX wheel (Polyform Noncommercial). No JS distribution exists and
  the model can't legally be repackaged. The previous placeholder
  `toJson` / `toText` exports that threw at runtime are removed.
- **OCR** — the official `mupdf` WASM bundle is built without
  Tesseract/Leptonica. `src/ocr/README.md` documents a `tesseract.js`
  recipe for callers who need it.

### Known parity gaps

Surfaced by `tests/realFixtures.test.ts`:

- **Span grouping** — TS groups characters into spans on
  `(font, size, color)`; libmupdf via PyMuPDF breaks more aggressively,
  so a bare en-dash doesn't surface as its own span and the
  pymupdf4llm "en-dash + space → '- '" bullet rule never fires.
- **Multi-column tables** — column header grouping in the trailing
  table of `multicolumn.pdf` differs.
- **Cropped/rotated pages** — our default `removeRotation: true`
  emits ~10× more content for `cropped-rotated-scaled.pdf` than
  Python's default-off behaviour. Intentional.
- **`text` table strategy** — produces a usable grid but column
  boundaries are heuristic and may not byte-match PyMuPDF.

### Project structure

- `src/index.ts` — public API entry
- `src/helpers/` — concern-based subdirectories (`text/`, `tables/`,
  `layout/`, `images/`, `forms/`) + shared primitives
  (`pymupdfRag.ts`, `types.ts`, `constants.ts`, `geometry.ts`,
  `utils.ts`, `progress.ts`) at root
- `src/llama/pdfMarkdownReader.ts` — LlamaIndex adapter
- `src/ocr/README.md` — why-no-OCR and tesseract.js recipe
- `tests/{parity,realFixtures,units}.test.ts` — 15 tests total
- `docs/` — VitePress + TypeDoc documentation site

### Tooling

- Linter pipeline: `bun lint` (write) and `bun lint:check` (CI-style)
  run Prettier + ESLint v10 + tsc. The CI workflow enforces lint:check
  on every push and PR.
- Documentation site: VitePress + `typedoc-plugin-markdown`. Built and
  deployed to GitHub Pages by `.github/workflows/docs.yml` on push to
  main. CI smoke-builds the site on every PR.

[Unreleased]: https://github.com/iamnalinor/mupdf4llm/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/iamnalinor/mupdf4llm/releases/tag/v0.1.0

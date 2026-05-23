# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Table cells whose text wraps across multiple visual lines no longer duplicate
  the trailing line or leak it into the neighbouring cell. `extractCellText`
  now filters by per-character bbox >50% overlap with the cell rectangle
  (matching `pymupdf.table.extract_cells` 1.27.2.3), and coalesces consecutive
  same-style spans the way upstream does.
- Header row of a rendered table is no longer wrapped in `**…**` markdown
  bold. Upstream `pymupdf.Table.to_markdown` takes header text from plain
  `header.names`; the port now renders row 0 plain and rewrites internal
  newlines to `<br>` for the markdown layout.
- `removeRotation` (default `true`) now performs a visual-preserving
  derotation — prepending a derotation matrix to the content stream and
  swapping the MediaBox for 90°/270° pages — faithfully porting PyMuPDF's
  `page.remove_rotation()`. Previously it only cleared the `/Rotate` flag,
  which transposed the rows and columns of every table on a quarter-turned
  page (e.g. landscape financial disclosures). The rotation is no longer
  restored afterwards since the in-memory document is never written back.

### Tests

- `tests/parity.test.ts` + `tests/realFixtures.test.ts` merged into
  `tests/fixtures.test.ts` (`synthetic` + `vendored` describe blocks).
- New synthetic `tableWrapped.pdf` parity fixture exercises wrapped cells +
  plain headers byte-for-byte against `pymupdf4llm`.
- Vendored `nics-background-checks-2015-11.pdf` (FBI, US gov public domain
  via 17 USC §105) at `smoke` mode — a real document with heavy multi-line
  cell content.

## [0.1.0] - 2026-05-22

First release. TypeScript/Bun port of
[`pymupdf4llm`](https://github.com/pymupdf/RAG)'s classic (non-layout)
backend on top of the official `mupdf` WASM package.

### Public API

`mupdf4llm`:

- `toMarkdown(buf, opts?): string` — convert a PDF buffer to a
  single Markdown string.
- `toMarkdownPages(buf, opts?): PageChunk[]` — convert to one
  chunk per page, each with
  `{ metadata, toc_items, text, tables, images, words }`.
- `IdentifyHeaders` — font-size-based header inference.
- `TocHeaders` — outline-based header inference.
- `getKeyValues(doc)` — AcroForm field extraction
  (`FormField[]`).
- `extractWords(page)` — per-word coordinates matching
  `page.get_text("words")` in PyMuPDF (per-line word index reset).
- `ProgressBar` — stderr progress bar (mirrors
  `pymupdf4llm.helpers.progress`). `showProgress: true` enables it.
- `Rect`, `Point` — geometry primitives.
- `clusterStripes`, `computeReadingOrder` — reading-order helpers
  (subset of `pymupdf4llm.helpers.utils`).
- `getPageRotation`, `setPageRotation`, `removeRotation` —
  `/Rotate` helpers.

`mupdf4llm/llama` (subpath export, `llamaindex` is an optional peer
dep):

- `PDFMarkdownReader` — LlamaIndex adapter. Returns one
  `{ text, metadata }` record per page (a real `Document` when
  `llamaindex` is installed; a plain object with the same shape
  otherwise).

### `MarkdownOptions`

- **Page selection**: `pages`, `margins`, `filename`,
  `pageSeparators`.
- **Text**: `ignoreCode`, `forceText`, `hdrInfo`.
- **Tables**: `tableStrategy` — four modes (`"lines_strict"`,
  `"lines"`, `"text"`, `"explicit"`); `explicitTableGrids` for
  the last.
- **Images**: `writeImages`, `embedImages`, `imagePath`,
  `imageFormat`, `dpi`, `imageSizeLimit`.
- **Words/chunks**: `extractWords`.
- **Rotation**: `removeRotation` (default `true`) — strips
  `/Rotate` before processing, restores afterwards.
- **Filtering**: `fontsizeLimit` — mirrors upstream
  `FONTSIZE_LIMIT`.
- **Misc**: `showProgress`.

### Parity

Byte-for-byte parity with
`pymupdf4llm.to_markdown(doc, use_layout=False)` on the four
synthetic fixtures in `tests/parity.test.ts` (single-column,
multi-column, multi-page, ruled table).

Ligatures are decomposed by default (`ﬁ → fi`) to match
`page.get_text("rawdict")`.

Five real-world fixtures vendored from
[py-pdf/sample-files](https://github.com/py-pdf/sample-files) (MIT)
are exercised in `tests/realFixtures.test.ts` at three tiers
(`exact` / `similar` / `smoke`).

### Not available (hard blockers)

- **`pymupdf.layout` features** (`to_text`, `to_json`,
  layout-mode `to_markdown`) require Artifex's closed-source
  `pymupdf-layout` ONNX wheel (Polyform Noncommercial). No JS
  distribution exists; the model can't legally be repackaged.
- **OCR** — the official `mupdf` WASM bundle ships without
  Tesseract/Leptonica. `src/ocr/README.md` documents a
  `tesseract.js` recipe.
- **Strikethrough detection** — `mupdf.js`'s `StructuredText.walk`
  doesn't expose per-character flags or alpha; we can't read
  `FZ_STEXT_STRIKEOUT`.
- **Invisible / OCR-layer text filter** — same root cause (no
  per-char alpha from the walker).

### Known parity gaps (soft)

- **Span grouping** — TS groups characters into spans on
  `(font, size, color)`; libmupdf via PyMuPDF breaks more
  aggressively, so a bare en-dash doesn't surface as its own span
  and the upstream "en-dash + space → `- `" bullet rule never
  fires.
- **Multi-column late-page tables** — column header grouping in
  `multicolumn.pdf` still differs slightly even with `avoid` /
  `noImageText` plumbed through to `columnBoxes`.
- **Cropped/rotated pages** — default `removeRotation: true`
  emits ~10× more content for `cropped-rotated-scaled.pdf` than
  Python's default-off behaviour. Intentional.
- **`text` table strategy** — produces a usable grid for tables
  with no rules but column boundaries are heuristic and may not
  byte-match PyMuPDF.
- **Cell styling per-font, not per-char** — `extractCellText`
  derives `**` / `_` / `` ` `` from font flags (the only level the
  walker surfaces). PyMuPDF reads char-level flags. Visible on
  documents where the same font carries both plain and styled
  runs.
- **Image positioning** — port emits all detected images after
  text + tables; upstream interleaves them inline at reading
  order.

### Project structure

```
src/
  index.ts                      public API entry
  helpers/
    pymupdfRag.ts               toMarkdown orchestrator (pymupdf_rag.py)
    types.ts  constants.ts  geometry.ts  utils.ts  progress.ts
    text/                       textPage, getTextLines, extractWords, identifyHeaders
    tables/                     tableFinder (all 4 strategies), drawingDevice
    layout/                     multiColumn, pageRotation
    images/                     imageExtract
    forms/                      formFields
  llama/pdfMarkdownReader.ts    LlamaIndex adapter (mupdf4llm/llama subpath)
  ocr/README.md                 why no OCR + tesseract.js recipe
tests/
  parity.test.ts                synthetic PyMuPDF-generated fixtures, exact parity
  realFixtures.test.ts          vendored real-world PDFs, tiered parity
  units.test.ts                 unit tests (20 in total)
  fixtures/                     5 PDFs vendored from py-pdf/sample-files (MIT)
docs/                           VitePress + TypeDoc documentation site
```

### Build & release

- Dual ESM + CJS bundles for `mupdf4llm` and `mupdf4llm/llama`
  via `bun build --target=node --external mupdf`.
- `.d.ts` files emitted by `tsc -p tsconfig.build.json`.
- `package.json` `exports` map covers both subpaths; `files`
  ships only `dist/`, README, CHANGELOG, LICENSE.
- `prepublishOnly` runs typecheck + tests + build.
- `npm publish --provenance --access public` on `v*.*.*` tags via
  `.github/workflows/release.yml`, authenticated through
  [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers)
  (OIDC, no long-lived `NPM_TOKEN` secret).
- AGPL-3.0-or-later, inherited from PyMuPDF / pymupdf4llm.

### Tooling

- **Lint pipeline**: `bun lint` (writes via Prettier, runs
  ESLint v10 flat config and `tsc --noEmit`) and `bun lint:check`
  (CI-style — fails on style drift). Enforced on every push and
  PR by `.github/workflows/ci.yml`.
- **Documentation site**: VitePress 1.6 +
  `typedoc-plugin-markdown` (hand-written guides + auto-generated
  API reference). Deployed to GitHub Pages by
  `.github/workflows/docs.yml` on push to `main`. CI smoke-builds
  the site on every PR.
- **Reproducible parity tests**: `requirements.txt` pins
  `pymupdf4llm==1.27.2.3`; CI installs via `pip install -r
requirements.txt`. Tests `skipIf` Python or `pymupdf4llm` is
  missing so JS-only contributors can run `bun test` cleanly.

[0.1.0]: https://github.com/iamnalinor/mupdf4llm/releases/tag/v0.1.0

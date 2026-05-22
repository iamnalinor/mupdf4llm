# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Rotation restore now lives in a `try/finally`** in
  `pymupdfRag.toMarkdown`. Previously an exception inside page
  processing (drawings, tables, image extraction, `writeText`) would
  leave the document's `/Rotate` entry mutated.
- **`columnBoxes` receives `avoid` + `noImageText` + `ignoreImages`**,
  matching upstream `pymupdf_rag.py:1140`. Closes (or shrinks) the
  multi-column-tables parity gap surfaced by `multicolumn.pdf`.
- **`extractWords` resets `word` index per line** to match
  `page.get_text("words")` in PyMuPDF (previously it was a single
  per-page counter).
- **`MarkdownOptions.fontsizeLimit` is now implemented** — drops
  spans below the configured point size in
  `text/getTextLines.sanitizeSpans`. Mirrors upstream `FONTSIZE_LIMIT`.

### Changed

- **Image markdown matches upstream**: emitted as `\n![](<ref>)\n`
  with empty alt text (was `![image-N-I](<ref>)`). Mirrors
  `pymupdf_rag.GRAPHICS_TEXT`.
- **`PageChunk.images` carries real `width` / `height`** from the
  detected image, not hardcoded zeros.
- **`PageChunk.graphics` field removed.** It was always `[]` —
  publishing a never-populated field broke the public contract. Will
  return when we actually surface drawing-path data.
- **`PageChunk.words` typed as `Word[]`** instead of `unknown[]`.
- **LlamaIndex adapter returns one shape** — `{ text, metadata }` —
  whether or not `llamaindex` is installed. Previously the
  no-llamaindex fallback returned `{ text, extra_info }`, which lied
  to consumers about the field name. `LlamaIndexDocumentLike` is
  exported and reflects this.

### Removed

- **Seven `MarkdownOptions` knobs that were silently ignored**:
  `ignoreImages`, `ignoreGraphics`, `detectBgColor`, `pageWidth`,
  `pageHeight`, `graphicsLimit`, `useGlyphs`. Plus `pageChunks` as a
  public option (use `toMarkdownPages` instead). They never affected
  output — keeping them in the type was misleading.
- **Strikethrough detection** removed from `writeText` and table cell
  styling. `mupdf.js`'s `StructuredText.walk` doesn't expose
  per-character flags or alpha, so `char_flags & FZ_STEXT_STRIKEOUT`
  could never be true on this port. The README/CHANGELOG previously
  advertised "strikethrough" — corrected.
- Unused constant `CHAR_ITALIC = 0` (always false).

### Tests / CI

- `tests/parity.test.ts` and `tests/realFixtures.test.ts` skip
  themselves (instead of erroring) when `python3 -c "import
pymupdf4llm"` fails. JS-only contributors can run `bun test`
  cleanly.
- `requirements.txt` pinned to `pymupdf4llm==1.27.2.3` (the version
  this port was validated against). CI now installs via
  `pip install -r requirements.txt`.
- `release.yml` runs `bun run lint:check` before tests, symmetric
  with `ci.yml`.
- New unit tests in `tests/units.test.ts`: `extractWords` per-line
  index, `getKeyValues` shape, `fontsizeLimit` filter,
  `PageChunk` shape, `PDFMarkdownReader` returned shape.

### Documentation

- README tightens the "byte-identical" claim — it's true on the
  synthetic fixtures in `tests/parity.test.ts`, not globally.
  Strikethrough removed from the inline-styling list.
- `docs/guide/parity-and-limits.md` adds four new known-gaps
  sections: strikethrough, invisible/OCR-layer text, cell styling
  per-font vs per-char, image positioning at end of page vs inline.
- `docs/guide/options.md` reflects the trimmed type and documents
  `fontsizeLimit`.
- `docs/guide/llamaindex.md` and `docs/guide/words-and-chunks.md`
  updated to the new return shapes.

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

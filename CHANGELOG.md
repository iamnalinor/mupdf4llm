# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Real-world parity fixtures** in `tests/fixtures/` (vendored from
  [py-pdf/sample-files](https://github.com/py-pdf/sample-files), MIT)
  exercising LaTeX ligatures, document outlines, AcroForm widgets,
  multi-column layout, and page rotation. Tested in
  `tests/realFixtures.test.ts` with three parity levels (`exact`,
  `similar`, `smoke`).
- `TocHeaders` class — assigns header levels from the document outline,
  mirroring `pymupdf4llm.helpers.pymupdf_rag.TocHeaders`.
- `getKeyValues(doc)` — extracts every PDF form field as a `FormField[]`,
  porting `pymupdf4llm.helpers.utils.get_key_values`.
- `ProgressBar` — minimal stderr progress bar mirroring
  `pymupdf4llm.helpers.progress.ProgressBar`. `showProgress: true` in
  `MarkdownOptions` now renders a bar instead of a per-page log line.
- `removeRotation` option (default `true`) — strips `/Rotate` from each
  page before processing and restores it afterwards, matching
  `page.remove_rotation()` behaviour in PyMuPDF.

### Changed

- **Ligature decomposition** now matches PyMuPDF: `textPage.extractTextDict`
  no longer passes `preserve-ligatures` to MuPDF's stext options by default
  (`ﬁ` is decomposed to `fi`, etc.), matching `pymupdf.get_text("rawdict")`.
  Pass `{ preserveLigatures: true }` to opt back in.
- **Restructured source layout** to mirror the upstream Python repo:
  every module moved from `src/*.ts` into `src/helpers/*.ts`, and
  `rag.ts` → `pymupdfRag.ts` (matches `pymupdf_rag.py`). New empty
  folders `src/ocr/` and `src/llama/` reserved for future ports.

### Removed

- **`toJson` and `toText`** removed from the public API. They previously
  threw — they require Artifex's closed-source `pymupdf-layout` wheel
  (Polyform Noncommercial license, ONNX ML model) which has no JS
  distribution and cannot legally be repackaged. See `src/ocr/README.md`
  for the parallel story on OCR.

### Planned

- Table strategies `lines`, `text`, `explicit` (only `lines_strict`
  today). This is the largest remaining parity gap — for tables without
  full cell rules.
- Image extraction & embedding (`writeImages` / `embedImages`).
- Per-word coordinates (`extractWords`) in `PageChunk`.
- LlamaIndex adapter at `mupdf4llm/llama` subpath export.

### Known parity gaps

Surfaced by the real-world fixtures in `tests/realFixtures.test.ts`:

- **Span grouping** — our `charsToSpans` groups characters into spans by
  (font, size, color), but libmupdf via PyMuPDF breaks more aggressively.
  In LaTeX-produced PDFs this means an en-dash "–" embedded in body text
  arrives as part of a longer span instead of as its own span; downstream,
  pymupdf4llm's bullet-substitution rule (en-dash + space → "- ") never
  fires, so our output keeps "–" where Python's has "-".
- **Multi-column tables** — the late-page table in `multicolumn.pdf`
  groups columns differently in TS vs Python.
- **Cropped/rotated pages** — `cropped-rotated-scaled.pdf` produces ~10×
  more output in TS than Python because our default `removeRotation: true`
  unrotates the page before extraction; Python without that flag emits
  only the un-rotated subset.

## [0.1.0] - 2026-05-22

Initial release. TypeScript/Bun port of the classic
`pymupdf4llm.helpers.pymupdf_rag.to_markdown` pipeline on top of the
official `mupdf` WASM package.

### Added

- `toMarkdown(buf, opts?)` and `toMarkdownPages(buf, opts?)` public API.
- Walker-based text extractor that groups MuPDF characters into
  PyMuPDF-shaped spans (`textPage.ts`).
- Reading-order line builder ported from
  `pymupdf4llm.helpers.get_text_lines.get_raw_lines` (`getTextLines.ts`).
- Font-size-based header inference via `IdentifyHeaders`.
- Three-phase column detection ported from
  `pymupdf4llm.helpers.multi_column.column_boxes` (`multiColumn.ts`).
- Custom `mupdf.Device` subclass that records `fillPath` / `strokePath`
  / `fillImage` callbacks, replacing `page.get_drawings()` and
  `page.get_image_info()` (`drawingDevice.ts`).
- `lines_strict` table finder built on top of the drawing device, with
  cell extraction and GitHub-flavored Markdown table emission
  (`tableFinder.ts`).
- Byte-for-byte parity tests against `pymupdf4llm.to_markdown` for
  single-column, multi-column, multi-page, headers + bullets, and a
  ruled-table fixture.

### Known limitations

- PyMuPDF's `pymupdf.layout` mode (`to_text`, `to_json`, layout-aware
  markdown) is out of scope and the corresponding entry points throw.
- No OCR, image extraction/embedding, or page rotation handling yet.
- Only `tableStrategy: "lines_strict"` is implemented.

[Unreleased]: https://github.com/iamnalinor/mupdf4llm/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/iamnalinor/mupdf4llm/releases/tag/v0.1.0

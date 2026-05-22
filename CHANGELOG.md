# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

# Getting started

`mupdf4llm` is a TypeScript port of the classic
[`pymupdf4llm.to_markdown`](https://github.com/pymupdf/RAG) pipeline. It
takes PDF bytes and returns LLM-friendly Markdown with reading-order
text, headings, bullets, inline styling, and tables.

## What it does

| You give it                           | You get back                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `Uint8Array` / `ArrayBuffer` of a PDF | A `string` of GitHub-flavored Markdown                                                          |
| Same buffer + `toMarkdownPages`       | One `PageChunk` per page with metadata, optional per-word coordinates, table bboxes, image refs |

## What it doesn't do

Two upstream features are blocked at the ecosystem level, not by this
port:

- **`pymupdf.layout` features** (`to_text`, `to_json`, layout-mode
  `to_markdown`) — they need Artifex's separate closed-source
  `pymupdf-layout` ONNX wheel, distributed under a Polyform
  Noncommercial license. No JS distribution exists; we can't legally
  repackage the model.
- **OCR** — the official `mupdf` npm WASM bundle ships **without**
  Tesseract/Leptonica linked in. See
  [`src/ocr/README.md`](https://github.com/iamnalinor/mupdf4llm/blob/main/src/ocr/README.md)
  for a `tesseract.js` recipe.

For everything else — see [parity and limits](/guide/parity-and-limits).

## Next steps

1. [Install](/guide/installation) the package.
2. Run through the [quick start](/guide/quick-start).
3. Explore the [options reference](/guide/options) to tune for your
   PDFs.

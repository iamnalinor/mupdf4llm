# Parity and limits

## What matches `pymupdf4llm.to_markdown` byte-for-byte today

- single- and multi-column text layout (port of `multi_column.column_boxes`)
- header levels via `IdentifyHeaders` (font-size frequency) and
  `TocHeaders` (document outline)
- bullet lists (`startswith_bullet` semantics, including the bullet
  table)
- inline styling — **bold**, _italic_, `monospaced`, ~~strikethrough~~
  — derived from MuPDF font properties
- ruled tables detected via the `lines_strict` strategy
- page rotation (`removeRotation` option, default `true`)
- form-field extraction via `getKeyValues`
- per-word coordinates via `extractWords`
- image extraction & embedding (`writeImages` / `embedImages`)
- LlamaIndex adapter (`mupdf4llm/llama`)

## Hard blockers — not available in this port

### `pymupdf.layout` features

`to_text`, `to_json`, and layout-aware `to_markdown` all require
Artifex's separate closed-source `pymupdf-layout` ONNX wheel. It's
licensed under
[Polyform Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/),
incompatible with our AGPL distribution. There is no JS port of the
model, and we can't legally repackage it. The corresponding entry
points were removed from `mupdf4llm`'s public API in v0.1 — they used
to throw at runtime, which was misleading.

### OCR

The official `mupdf` npm WASM bundle is built **without** Tesseract /
Leptonica. The binary literally contains the string
`"No OCR support in this build"`. If you need OCR, the realistic path
is [`tesseract.js`](https://github.com/naptha/tesseract.js) on a
rasterized `mupdf.Pixmap` — see
[`src/ocr/README.md`](https://github.com/iamnalinor/mupdf4llm/blob/main/src/ocr/README.md)
for a recipe.

## Known parity gaps (soft)

Surfaced by the real-world fixtures in
[`tests/realFixtures.test.ts`](https://github.com/iamnalinor/mupdf4llm/blob/main/tests/realFixtures.test.ts):

| Fixture                      | Mode    | Gap                                                                                   |
| ---------------------------- | ------- | ------------------------------------------------------------------------------------- |
| `pdflatex-forms.pdf`         | exact   | none — byte-identical                                                                 |
| `pdflatex-4-pages.pdf`       | similar | en-dash → "- " bullet substitution doesn't fire (span-grouping difference vs PyMuPDF) |
| `pdflatex-outline.pdf`       | similar | same en-dash divergence                                                               |
| `multicolumn.pdf`            | similar | late-page table groups columns differently                                            |
| `cropped-rotated-scaled.pdf` | smoke   | TS unrotates by default → ~10× more content; intentional                              |

### Span grouping

We group characters into spans on `(font, size, color)` triples;
libmupdf via PyMuPDF breaks more aggressively, so a bare en-dash
between two words doesn't surface as its own span. Downstream the
pymupdf4llm rule "en-dash followed by space → `- ` bullet" never
triggers, and our output keeps the en-dash.

### Text-strategy tables

`tableStrategy: "text"` is a deliberately lightweight port — it
produces a usable grid for tables with no rules but column boundaries
are heuristic and may not byte-match PyMuPDF's pdfplumber-style
algorithm.

# Parity and limits

## What matches `pymupdf4llm.to_markdown` byte-for-byte today

Byte-for-byte parity is asserted by the `synthetic fixtures` block in
`tests/fixtures.test.ts` on a set of generated PDFs (single /
multi-column text, headers, bullets, ruled table, wrapped-cell table).
The following features are exercised there:

- single- and multi-column text layout (port of `multi_column.column_boxes`)
- header levels via `IdentifyHeaders` (font-size frequency) and
  `TocHeaders` (document outline)
- bullet lists (`startswith_bullet` semantics, including the bullet
  table)
- inline styling — **bold**, _italic_, `monospaced` — derived from
  MuPDF font properties (see "strikethrough" gap below)
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

Surfaced by the `vendored fixtures` block in
[`tests/fixtures.test.ts`](https://github.com/iamnalinor/mupdf4llm/blob/main/tests/fixtures.test.ts):

| Fixture                              | Mode    | Gap                                                                                    |
| ------------------------------------ | ------- | -------------------------------------------------------------------------------------- |
| `pdflatex-forms.pdf`                 | exact   | none — byte-identical                                                                  |
| `pdflatex-4-pages.pdf`               | similar | en-dash → "- " bullet substitution doesn't fire (span-grouping difference vs PyMuPDF)  |
| `pdflatex-outline.pdf`               | similar | same en-dash divergence                                                                |
| `multicolumn.pdf`                    | similar | late-page table groups columns differently                                             |
| `cropped-rotated-scaled.pdf`         | smoke   | cropped + scaled content; `mupdf` recovers less than PyMuPDF on this pathological file |
| `nics-background-checks-2015-11.pdf` | smoke   | rotated multi-line table; column-boundary detection still diverges                     |

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

### Strikethrough not detected

`mupdf` (the JS WASM bindings) exposes `StructuredText.walk` with an
`onChar(c, origin, font, size, quad, color)` signature — no per-char
flags, no alpha. So we can't read `FZ_STEXT_STRIKEOUT` and the
`~~text~~` wrapper PyMuPDF emits for struck-through spans is not
produced here. **bold**, _italic_, `monospaced` still work because
they're font-property-derived; strikeout is a per-character flag.

### Invisible / OCR-layer text not filtered

For the same reason — no per-char `alpha` from the walker — the
`alpha === 0` filter that PyMuPDF uses to drop invisible OCR-layer
text and watermarks is a no-op here. If your input has invisible
text overlaid on visual glyphs you'll see both in the markdown.

### Cell styling reads per-font, not per-character

`extractCellText` styles cells with `**`/`_`/`` ` `` derived from the
span's font flags. PyMuPDF reads char-level `flags` / `char_flags`
from each character. For PDFs where the same font is used for both
plain and styled runs, the divergence is visible.

### Images emitted at end of page, not inline

The port emits all detected images after the page text + tables,
with alt text `![]()`. PyMuPDF interleaves images inline at their
position in reading order with a recursive `force_text` pass over
each image region. Closing this gap requires reworking the
`writeText` main loop; deferred.

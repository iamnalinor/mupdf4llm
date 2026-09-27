# OCR for tables

Tables in scans, or in PDFs whose text layer is broken (a font with a
wrong or missing `ToUnicode` map), can be read from the rendered page
instead of the PDF's internal structure. Two options control this, and
they are independent:

| Option          | Answers                         | Values                                                              |
| --------------- | ------------------------------- | ------------------------------------------------------------------- |
| `tableStrategy` | How is the grid found?          | `"lines_strict"`, `"lines"`, `"text"`, `"explicit"`, **`"pixels"`** |
| `textSource`    | Where does cell text come from? | `"pdf"`, `"ocr"`, `"auto"`                                          |

## Scanned tables: `tableStrategy: "pixels"`

```ts
const md = await toMarkdown(buf, { tableStrategy: "pixels" });
```

The page is rendered at `ocrDpi` (default 300) and the table is read off
the pixels, so it works when the page is one scanned image with no text
and no vector graphics. On a page without a text layer every cell is
cropped from the rendered page and recognised on its own, which is much
more accurate than OCR of the whole page fitted into the grid afterwards.

What it handles, as found in real printed tables:

- **Columns ruled, rows not.** Most printed tables rule the columns and
  the header only. Columns come from the vertical rules, and body rows
  from the text lines between them. A wrapped label (ink in one column
  only) joins the data line next to it; when values sit on the last line
  of an entry and the row number on the first, the number line starts the
  row.
- **Headers with group labels** ("MALES." over Total / Cities / Rural)
  become merged cells.
- **Scan defects:** tinted or grey paper and a shadow at the binding
  (the ink threshold follows the local background), specks and noise
  (dropped before OCR), show-through from the back of the page, broken
  thin rules, and pages fed askew up to 3° (the page is deskewed first).
- **Leader dots** ("Total ........ 1900") are removed from cell text.

Not handled yet: tables without any vertical rules (borderless), text
set vertically in the header (it is recognised as noise or skipped).
A heading set in the first column only ("Northern region") directly
above data rows is joined to the next row like a wrapped label.

A page scanned askew is deskewed when all cell text comes from OCR:
with `textSource: "ocr"`, and with `"auto"` (the default) on a page
without a text layer. Otherwise the grid must stay in the coordinates of
the PDF's text layer.

### Accuracy

Numeric cells read correctly on a public-domain census page (US 1900,
245 values), with the default engine:

| Scan                          | Correct |
| ----------------------------- | ------- |
| original, 200 dpi             | 99.6%   |
| fed askew 1°                  | 98.4%   |
| fed askew −1.5°               | 87.8%   |
| grey noise (σ 15)             | 90.2%   |
| black specks (0.4% of pixels) | 85.7%   |
| 150 dpi, JPEG quality 40      | 82.4%   |

The table structure (rows and columns) stays exact in all of these.
Heavy noise (σ 25) and resolutions below about 120 dpi also break the
structure. Aim for 200–300 dpi scans.

## Broken text layer: `textSource`

When the table grid is fine but the text is garbage, keep the vector
grid and OCR only the text:

```ts
await toMarkdown(buf, { textSource: "ocr" }); // grid from lines_strict, text from OCR
```

- `"pdf"` — the PDF text layer; never runs OCR.
- `"ocr"` — every cell is OCR'd; the text layer is ignored.
- `"auto"` (default) — the text layer, and OCR only for cells whose text is empty
  or looks broken: replacement (`U+FFFD`), private-use or control
  characters, a letter of another script slipped into a word (a Latin
  "c" in "Иcтория" reads right but breaks search; whole pieces like
  "ITотдел" are fine), or text of 4+ characters that
  is mostly neither letters nor digits. When some text of a font has
  such characters, every cell set in that font is OCR'd: a font embedded
  without a `ToUnicode` map often yields control characters for its first
  glyphs and printable gibberish (`DE=BA`) for the rest. A wrong encoding that still produces letters (Latin
  gibberish instead of Cyrillic) is **not** detected — use `"ocr"` for
  such documents.

Only `"auto"` mixes sources within a table, and the source of every cell
is always reported (see below).

## Default engine: RapidOCR

Without an `ocr` option the library uses the RapidOCR stack — PaddleOCR
PP-OCRv5 models on ONNX Runtime — through two **optional** peer
dependencies. Install them once:

```sh
npm install ppu-paddle-ocr onnxruntime-node
```

The CPU build of ONNX Runtime ships inside the package; if its
postinstall script fails behind a proxy, `--ignore-scripts` is safe.
Nothing is loaded unless a cell actually needs OCR. If the packages are
missing, the call rejects with the install command above — except under
the default `textSource` on a page that has a text layer, which is then
kept as it is. Models (about
13 MB) are downloaded and cached on first use.

The default model is `v5-cyrillic-mobile` (Cyrillic and Latin script:
Russian, English and more). Pick another one, or reuse one loaded engine across many
documents, with `createRapidOcr`:

```ts
import { toMarkdown, createRapidOcr } from "@nalinor/mupdf4llm";

{
  // The models are released when the block ends.
  await using ocr = await createRapidOcr({ model: "v5-latin-mobile" });
  for (const buf of pdfs) await toMarkdown(buf, { tableStrategy: "pixels", ocr });
}
```

`await using` runs natively on Node ≥ 24 and Bun; on Node 20.4–22 it
works in code compiled by TypeScript ≥ 5.2 (or a bundler that supports
it). Otherwise call `await ocr.dispose()` in a `finally` block.

`model` takes any `ppu-paddle-ocr` preset name (`"v5-en-mobile"`,
`"v5-eslav-mobile"`, `"v6-small"`, …) or explicit
`{ detection, recognition, charactersDictionary }` files.

## Your own engine

Any object with `recognize(image)` works: Tesseract.js, a cloud API, a
model server.

```ts
import type { OcrEngine } from "@nalinor/mupdf4llm";
import Tesseract from "tesseract.js";

const worker = await Tesseract.createWorker("rus+eng");
const ocr: OcrEngine = {
  async recognize(img) {
    const { data } = await worker.recognize(Buffer.from(img.png()));
    return data.text;
  },
};
await toMarkdown(buf, { tableStrategy: "pixels", ocr });
```

The image is one table cell: 8-bit grayscale (`img.data`, `img.width`,
`img.height`) with a white margin, also available as PNG (`img.png()`).
Return the text with lines separated by `\n`. Throw `OcrSetupError`
(exported by the package) when the engine cannot work at all — a missing
model, rejected credentials: it aborts the conversion. Any other error
only marks that cell as `"failed"`. A multi-line cell whose
result has fewer lines than the cell shows is recognised again line by
line (a text detector may drop a short last line), so an engine can be
called more than once per cell, one call at a time. Engines you pass in are never disposed by
the library.

## Which cells came from OCR

`toMarkdownPages` reports the text and source of every cell:

```ts
const [page] = await toMarkdownPages(buf, { textSource: "auto" });
for (const row of page.tables[0].cells) {
  for (const cell of row) {
    if (cell) console.log(cell.source, cell.text); // "pdf" | "ocr" | "failed"
  }
}
```

`null` marks a position covered by a merged cell. A cell is `"failed"`
when the engine threw or returned nothing although the cell holds ink;
it is rendered empty (under `"auto"` it keeps its text-layer text) and
processing continues. Set `DEBUG_MUPDF4LLM=1`
to log the errors. Cells without ink are empty and never sent to the
engine.

## Performance

OCR is much slower than reading the text layer. Each non-empty cell is
one or a few model runs; the US census page above (two tables, about 300
cells) takes about 8 seconds on one CPU core, plus about a second to load
the models once per `toMarkdown` call when the default engine is used.
`"pixels"` also renders every page at `ocrDpi` before any OCR (about
0.3–0.8 s per page), even pages without a table. Pass a shared engine
(above) when converting many documents. This cost
only applies when `"pixels"`, `"ocr"` or `"auto"` is requested; the
default path is unchanged.

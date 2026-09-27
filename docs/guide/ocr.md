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

The page is rendered at `ocrDpi` (default 300) and ruling lines are
found in the pixels, so it works when the page is one scanned image with
no text and no vector graphics. `"pixels"` implies `textSource: "ocr"`:
every cell is cropped from the rendered page and recognised on its own.
Recognising cell by cell is much more accurate than OCR of a whole page
and then fitting the text into the grid.

Only ruled tables are detected (borderless scanned tables are not yet
supported). Slight skew (about 1°) is tolerated; the page is not
deskewed.

## Broken text layer: `textSource`

When the table grid is fine but the text is garbage, keep the vector
grid and OCR only the text:

```ts
await toMarkdown(buf, { textSource: "ocr" }); // grid from lines_strict, text from OCR
```

- `"pdf"` — the PDF text layer. Default for every strategy except
  `"pixels"`; never runs OCR.
- `"ocr"` — every cell is OCR'd; the text layer is ignored. Default for
  `"pixels"`.
- `"auto"` — the text layer, and OCR only for cells whose text is empty
  or looks broken: replacement (`U+FFFD`), private-use or control
  characters, or text of 4+ characters that is mostly neither letters
  nor digits. A wrong encoding that still produces letters (Latin
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
missing, the call rejects with the install command above. Models (about
13 MB) are downloaded and cached on first use.

The default model is `v5-eslav-mobile` (Russian, Ukrainian, Belarusian
and English). Pick another one, or reuse one loaded engine across many
documents, with `createRapidOcr`:

```ts
import { toMarkdown, createRapidOcr } from "@nalinor/mupdf4llm";

const ocr = await createRapidOcr({ model: "v5-latin-mobile" });
try {
  for (const buf of pdfs) await toMarkdown(buf, { tableStrategy: "pixels", ocr });
} finally {
  await ocr.dispose?.();
}
```

`model` takes any `ppu-paddle-ocr` preset name (`"v5-en-mobile"`,
`"v5-cyrillic-mobile"`, `"v6-small"`, …) or explicit
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
Return the text with lines separated by `\n`. Engines you pass in are
never disposed by the library.

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
it is rendered empty and processing continues. Set `DEBUG_MUPDF4LLM=1`
to log the errors. Cells without ink are empty and never sent to the
engine.

## Performance

OCR is much slower than reading the text layer: every non-empty cell is
one model run (roughly 50–100 ms on a laptop CPU), plus about a second
to load the models once per `toMarkdown` call when the default engine is
used. Pass a shared engine (above) when converting many documents. This
cost only applies when `"pixels"`, `"ocr"` or `"auto"` is requested;
the default path is unchanged.

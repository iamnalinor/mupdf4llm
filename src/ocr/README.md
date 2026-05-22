# OCR — not implemented

The upstream Python `pymupdf4llm` ships five OCR backends under
`pymupdf4llm/ocr/`: Tesseract, PaddleOCR, RapidOCR, and two
Tesseract-overlay variants. None of them work in the JS port out of the
box because:

- The official `mupdf` npm package ships a WASM bundle built **without**
  Tesseract / Leptonica linked in. The bundle even carries the literal
  string `"No OCR support in this build"` — there is no
  `page.get_textpage_ocr()` to call.
- PaddleOCR and RapidOCR are Python-only (ONNX/PaddlePaddle ML stacks
  with no JS distributions).

If you need OCR in this port, the realistic path is to add
[`tesseract.js`](https://github.com/naptha/tesseract.js) yourself:

```ts
import * as mupdf from "mupdf";
import Tesseract from "tesseract.js";

const page = doc.loadPage(0) as mupdf.PDFPage;
const pixmap = page.toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB);
const png = pixmap.asPNG();
const { data: { text } } = await Tesseract.recognize(png, "eng");
```

We deliberately don't pull `tesseract.js` in as a dependency — it's
~10 MB of WASM and most users of `mupdf4llm` are processing PDFs with
selectable text where OCR is unnecessary.

# Page rotation

PDFs can carry a `/Rotate` entry (0, 90, 180, 270) on each page. By
default `mupdf4llm` strips it before processing and restores it
afterwards — that matches PyMuPDF's `page.remove_rotation()` flow and
keeps text extraction consistent across landscape / portrait
orientations.

## Default behaviour

```ts
toMarkdown(buf); // removeRotation: true by default
```

The original `/Rotate` value is restored after each page is processed,
so the input document is not mutated on disk.

## Opt out

For inputs you know are correctly oriented (or where stripping
rotation worsens extraction):

```ts
toMarkdown(buf, { removeRotation: false });
```

## Manual control

Three helpers are exported for advanced use:

```ts
import { getPageRotation, setPageRotation, removeRotation } from "mupdf4llm";

const before = getPageRotation(page); // 0 | 90 | 180 | 270
setPageRotation(doc, page, 90);
const prev = removeRotation(doc, page); // strips, returns the old value
```

All three operate on the page's PDF dictionary entry — no rasterization
involved.

## Trade-off

`removeRotation: true` is closer to PyMuPDF parity, but for documents
where the rotation is meaningful (e.g. a fold-out poster page in
landscape, deliberately rotated by the author), turning it off may
produce a better reading order.

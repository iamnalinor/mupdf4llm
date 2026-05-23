# Page rotation

PDFs can carry a `/Rotate` entry (0, 90, 180, 270) on each page. By
default `mupdf4llm` removes it before processing — a faithful port of
PyMuPDF's `page.remove_rotation()`, which upstream `pymupdf4llm` calls on
every page.

Crucially, removing rotation **preserves the visual appearance**: a
derotation matrix is prepended to the page content stream and the
MediaBox is swapped for 90°/270° pages. Simply clearing the `/Rotate`
flag would leave content in the page's raw authoring orientation, which
transposes the rows and columns of any table on a quarter-turned page.

## Default behaviour

```ts
toMarkdown(buf); // removeRotation: true by default
```

The document is loaded from an in-memory buffer and never written back,
so the input file on disk is untouched.

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

`removeRotation: true` matches PyMuPDF parity and keeps tables on
rotated pages correctly oriented. Turning it off skips the content
rewrite entirely; `mupdf` then extracts in display space, which is
usually fine for upright pages but is not what upstream does.

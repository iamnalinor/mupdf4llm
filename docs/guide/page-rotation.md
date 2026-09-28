# Page rotation

PDFs can carry a `/Rotate` entry (0, 90, 180, 270) on each page. By
default `@nalinor/mupdf4llm` removes it before processing — a faithful port of
PyMuPDF's `page.remove_rotation()`, which upstream `pymupdf4llm` calls on
every page.

Crucially, removing rotation **preserves the visual appearance**: a
derotation matrix is prepended to the page content stream and the
MediaBox is swapped for 90°/270° pages. Simply clearing the `/Rotate`
flag would leave content in the page's raw authoring orientation, which
transposes the rows and columns of any table on a quarter-turned page.

## Default behaviour

```ts
await toMarkdown(buf); // removeRotation: true by default
```

The document is loaded from an in-memory buffer and never written back,
so the input file on disk is untouched.

## Opt out

For inputs you know are correctly oriented (or where stripping
rotation worsens extraction):

```ts
await toMarkdown(buf, { removeRotation: false });
```

## Scans turned without `/Rotate`

A sheet fed into the scanner sideways often comes out as a page with no
`/Rotate` at all: the image itself lies on its side, and a table read off
its pixels would have its rows and columns swapped. With
`tableStrategy: "pixels"`, a page without a text layer is checked first:
letters stand closer to their neighbours in a word, and words to theirs
in a line, than to the lines above and below, so each letter- or
word-sized piece of ink votes for the direction of its nearest neighbour.
Rules, borders and the dark surround of a photographed page are too
large to vote, and skew does not matter. A page whose lines clearly run
vertically is turned a quarter before its tables are read, the same way
`removeRotation` bakes a `/Rotate`; when the votes are close, the page is
left as it is. Like `removeRotation`, the turn is made in the loaded
document, also when `removeRotation` is off.
Which quarter — clockwise or back — the ink cannot tell; when the cells
are going to be OCR'd anyway (`textSource` other than `"pdf"`), a few of
the longest lines are recognised both ways up and the page is turned so
that they read as words. Pages with a text layer are never turned.

```ts
await toMarkdown(buf, { tableStrategy: "pixels" }); // detectOrientation: true by default
await toMarkdown(buf, { tableStrategy: "pixels", detectOrientation: false });
```

## Manual control

Three helpers are exported for advanced use:

```ts
import { getPageRotation, setPageRotation, removeRotation } from "@nalinor/mupdf4llm";

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

# Headers

Two strategies decide which spans become Markdown headings.

## `IdentifyHeaders` (default)

Font-size frequency: counts how many characters appear at each rounded
font size, picks the most common size as the body limit, then assigns
`#` … `######` to the larger sizes in descending order.

```ts
import { toMarkdown, IdentifyHeaders } from "@nalinor/mupdf4llm";

const md = toMarkdown(buf); // implicit IdentifyHeaders
```

Tune it manually:

```ts
import * as mupdf from "mupdf";
import { toMarkdown, IdentifyHeaders } from "@nalinor/mupdf4llm";

const doc = mupdf.PDFDocument.openDocument(buf, "application/pdf");
const hdr = new IdentifyHeaders(doc, {
  body_limit: 11, // body text size in pt (inclusive)
  max_levels: 4, // cap at H4
  pages: [0, 1, 2], // analyze only the first three pages
});

const md = toMarkdown(buf, { hdrInfo: hdr });
```

## `TocHeaders`

Uses the PDF outline (table of contents). Each TOC entry maps a title +
level to a specific page; on that page the first span whose trimmed
text matches the title gets that level's `#`. Useful when font sizes
don't reliably encode structure (e.g. reports with a flat type
hierarchy but an authored outline).

```ts
import { toMarkdown, TocHeaders } from "@nalinor/mupdf4llm";

const md = toMarkdown(buf, { hdrInfo: new TocHeaders(doc) });
```

## Custom provider

Anything with a `get_header_id(span, pageCtx?): string` method works:

```ts
const hdr = {
  get_header_id(span) {
    return span.font.includes("Heading-1") ? "# " : "";
  },
};
toMarkdown(buf, { hdrInfo: hdr });
```

## Disabling

Pass `false` to skip header inference entirely (everything becomes body
text):

```ts
toMarkdown(buf, { hdrInfo: false });
```

# Form fields

PDF AcroForm widgets (text inputs, checkboxes, radios, dropdowns,
signatures) are extracted with `getKeyValues`. Mirrors
`pymupdf4llm.helpers.utils.get_key_values`.

## Basic usage

```ts
import * as mupdf from "mupdf";
import { getKeyValues } from "@nalinor/mupdf4llm";

const doc = mupdf.PDFDocument.openDocument(buf, "application/pdf");
const fields = getKeyValues(doc);

for (const f of fields) {
  console.log(`${f.name} = ${f.value}  (page ${f.page}, ${f.type})`);
}
doc.destroy();
```

## Returned record

```ts
interface FormField {
  page: number; // 0-based page index
  name: string; // field name (`T` entry, e.g. "applicant_dob")
  label: string; // user-facing label (`TU` if present)
  value: string; // current value as a string
  type: "text" | "checkbox" | "radio" | "choice" | "signature" | "unknown";
  bbox: [x0, y0, x1, y1]; // widget bounding box in PDF user space
}
```

For checkboxes the value is `"Yes"` / `"Off"` (or whatever the
appearance state in the PDF). For radios the value is the selected
option key. For signatures the value is the signer name when present.

## Round-tripping into markdown

`getKeyValues` is intentionally separate from `toMarkdown` — for most
LLM use cases you want forms as structured JSON, not rendered into the
prose. If you do want them inlined, do it yourself:

```ts
let md = toMarkdown(buf);
for (const f of getKeyValues(doc)) {
  md += `\n- **${f.name}**: ${f.value}\n`;
}
```

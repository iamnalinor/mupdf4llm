# Extract form fields

Pull every AcroForm widget out of a filled-out PDF.

```ts
import * as mupdf from "mupdf";
import { getKeyValues } from "mupdf4llm";
import { readFileSync } from "node:fs";

const buf = readFileSync("application.pdf");
const doc = mupdf.PDFDocument.openDocument(
  new Uint8Array(buf),
  "application/pdf",
) as mupdf.PDFDocument;

try {
  const fields = getKeyValues(doc);
  const byName = Object.fromEntries(fields.map((f) => [f.name, f.value]));

  console.log("applicant_name:", byName.applicant_name);
  console.log("date_of_birth:", byName.date_of_birth);
  console.log("agreed_to_terms:", byName.agreed_to_terms === "Yes");
} finally {
  doc.destroy();
}
```

## Filter by type / page

```ts
const textFields = fields.filter((f) => f.type === "text");
const onPageZero = fields.filter((f) => f.page === 0);
```

## Combine with `toMarkdown`

If you want both the text and the form values in one shot:

```ts
import { toMarkdown, getKeyValues } from "mupdf4llm";

const md = toMarkdown(buf);
const fields = getKeyValues(doc);

const fullMd =
  md +
  "\n\n## Form values\n\n" +
  fields.map((f) => `- **${f.label || f.name}**: ${f.value}`).join("\n");
```

## A note on baking

`toMarkdown` internally calls `doc.bake()` so widget appearances are
rendered into the page stream and AcroForm overlays become regular
text in the markdown output. `getKeyValues` reads the widget objects
directly, so it doesn't need baking.

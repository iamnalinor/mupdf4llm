# Basic usage

## Node 20+

```ts
import { toMarkdown } from "mupdf4llm";
import { readFileSync, writeFileSync } from "node:fs";

const pdf = readFileSync("report.pdf");
const md = toMarkdown(pdf);
writeFileSync("report.md", md);
```

## Bun

```ts
import { toMarkdown } from "mupdf4llm";

const pdf = await Bun.file("report.pdf").bytes();
await Bun.write("report.md", toMarkdown(pdf));
```

## Browser

```ts
import { toMarkdown } from "mupdf4llm";

const res = await fetch("/report.pdf");
const buf = await res.arrayBuffer();
console.log(toMarkdown(buf));
```

## With options

```ts
toMarkdown(pdf, {
  pages: [0, 1, 2, 3, 4], // first five only
  margins: [36, 36, 36, 36], // crop 0.5" margin all around
  tableStrategy: "lines",
  pageSeparators: true,
});
```

## From a URL pipeline

```ts
async function pdfToMd(url: string): Promise<string> {
  const buf = await fetch(url).then((r) => r.arrayBuffer());
  return toMarkdown(buf);
}
```

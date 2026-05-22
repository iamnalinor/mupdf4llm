# Extract images

## Save to disk and link from markdown

```ts
import { toMarkdown } from "mupdf4llm";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

mkdirSync("out/images", { recursive: true });
const md = toMarkdown(readFileSync("report.pdf"), {
  writeImages: true,
  imagePath: "out/images",
  imageFormat: "jpg",
  dpi: 200,
  imageSizeLimit: 0.05,
  filename: "report.pdf", // becomes the filename prefix
});
writeFileSync("out/report.md", md);
```

The markdown picks up references like
`![image-3-0](out/images/report-3-0.jpg)`.

## Embed inline as base64

```ts
const md = toMarkdown(buf, {
  embedImages: true, // mutually exclusive with writeImages
  imageFormat: "png",
  dpi: 150,
});
// ![image-0-1](data:image/png;base64,iVBORw0KGgo...)
```

## Per-page metadata for filtering

In page-chunks mode each `PageChunk.images` carries the bbox and the
emitted ref:

```ts
import { toMarkdownPages } from "mupdf4llm";

const chunks = toMarkdownPages(buf, {
  writeImages: true,
  imagePath: "out/images",
});

for (const c of chunks) {
  for (const img of c.images) {
    console.log({ page: c.metadata.page, bbox: img.bbox, file: img.ref });
  }
}
```

Use that to filter out small icons, badges, or page furniture before
shipping into a downstream pipeline.

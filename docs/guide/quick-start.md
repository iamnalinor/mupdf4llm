# Quick start

Five-minute tour of the two main entry points and a few common
options.

## `toMarkdown(buf, opts?)`

Returns a single Markdown string for the whole document.

```ts
import { toMarkdown } from "mupdf4llm";
import { readFileSync } from "node:fs";

const md = toMarkdown(readFileSync("paper.pdf"));
```

On Bun:

```ts
const md = toMarkdown(await Bun.file("paper.pdf").bytes());
```

Browser:

```ts
const buf = await fetch("paper.pdf").then((r) => r.arrayBuffer());
const md = toMarkdown(buf);
```

## `toMarkdownPages(buf, opts?)`

Returns one record per page. Useful for chunked RAG, where you want
each chunk to carry the page number / TOC items as metadata.

```ts
import { toMarkdownPages } from "mupdf4llm";

const chunks = toMarkdownPages(readFileSync("paper.pdf"));
for (const c of chunks) {
  console.log(`page ${c.metadata.page}: ${c.text.length} chars`);
}
```

## Common combinations

Selected pages only:

```ts
toMarkdown(buf, { pages: [0, 4, 5] });
```

Embed images inline as base64 data URLs:

```ts
toMarkdown(buf, { embedImages: true });
```

Or save them to a folder and link by path:

```ts
toMarkdown(buf, {
  writeImages: true,
  imagePath: "out/images",
  imageFormat: "jpg",
  dpi: 200,
});
```

Per-word coordinates inside the chunks:

```ts
toMarkdownPages(buf, { extractWords: true });
// chunks[0].words[i] = { x0, y0, x1, y1, text, block, line, word }
```

Page separators in the joined output:

```ts
toMarkdown(buf, { pageSeparators: true });
```

Disable table detection if it gets in the way:

```ts
toMarkdown(buf, { tableStrategy: null });
```

## Next

- Full [options reference](/guide/options)
- [Tables guide](/guide/tables) — `lines_strict` vs `lines` vs `text` vs `explicit`
- [LlamaIndex adapter](/guide/llamaindex)

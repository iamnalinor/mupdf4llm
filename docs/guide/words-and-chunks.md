# Words and chunks

For RAG-style indexing where each page becomes its own chunk.

## `toMarkdownPages(buf, opts?)`

Returns one `PageChunk` per page:

```ts
import { toMarkdownPages } from "@nalinor/mupdf4llm";

const chunks = toMarkdownPages(buf);
// chunks[i] = {
//   metadata: { title, author, page, page_count, file_path, ... },
//   toc_items: [level, title, page][],   // matching the page's TOC entries
//   tables:    [{ bbox, rows, columns }],
//   images:    [{ bbox, ref?, width, height, number }],
//   text:      string,                   // the markdown
//   words:     Word[],                   // when extractWords: true, else []
// }
```

## Per-word coordinates

Set `extractWords: true` to populate `words`:

```ts
const chunks = toMarkdownPages(buf, { extractWords: true });
const first = chunks[0].words[0];
// { x0, y0, x1, y1, text, block, line, word }
```

The shape mirrors `page.get_text("words")` from PyMuPDF. Words are
split on whitespace, ordered by reading flow within each line.

## Standalone extraction

If you already have a `mupdf.Page`, use the lower-level helper:

```ts
import * as mupdf from "mupdf";
import { extractWords } from "@nalinor/mupdf4llm";

const page = doc.loadPage(0);
const words = extractWords(page);
```

## Chunking strategies

`toMarkdownPages` gives you one chunk per page, which is the common
RAG default. For finer or coarser chunking:

- **Per-section** — split the per-page `text` on heading regex
  (`/^#{1,3} /m`).
- **Per-paragraph** — split on `\n{2,}`.
- **Token-bounded** — concatenate per-page chunks, then run your own
  token-aware splitter on the join.

See [the RAG pipeline example](/examples/rag-pipeline) for a concrete
recipe.

## Page separators (non-chunk mode)

If you want page boundaries in the single-string output, use
`pageSeparators: true`:

```ts
toMarkdown(buf, { pageSeparators: true });
// "...page 1 md...\n\n--- end of page=0 ---\n\n...page 2 md..."
```

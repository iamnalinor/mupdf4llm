# RAG pipeline

A minimal retrieval-augmented-generation indexing pass: PDF → per-page
chunks → embeddings → vector store.

```ts
import { toMarkdownPages } from "@nalinor/mupdf4llm";
import { readFileSync } from "node:fs";
// pseudocode — swap in your embedding model & vector store of choice
import { embed } from "./my-embeddings";
import { upsert } from "./my-vector-store";

async function indexPdf(filePath: string) {
  const buf = readFileSync(filePath);
  const chunks = toMarkdownPages(buf, { extractWords: true });

  for (const c of chunks) {
    if (!c.text.trim()) continue;
    const vec = await embed(c.text);
    await upsert({
      id: `${filePath}#p${c.metadata.page}`,
      vector: vec,
      payload: {
        source: filePath,
        page: c.metadata.page,
        title: c.metadata.title,
        toc: c.toc_items,
        wordCount: c.words?.length ?? 0,
      },
    });
  }
}
```

## Sub-page chunking

For very dense pages, split on section headers:

```ts
function sectionChunks(text: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (const line of text.split("\n")) {
    if (/^#{1,3} /.test(line) && buf) {
      out.push(buf);
      buf = "";
    }
    buf += line + "\n";
  }
  if (buf) out.push(buf);
  return out;
}

for (const c of toMarkdownPages(pdf)) {
  for (const sub of sectionChunks(c.text)) {
    await upsert({ /* ... */ payload: { page: c.metadata.page, text: sub } });
  }
}
```

## Token-bounded chunking

Concatenate pages, then run your model's tokenizer + a splitter
(@anthropic-ai/tokenizer, tiktoken, etc.). The per-page chunks above
already give you a natural seam to recombine.

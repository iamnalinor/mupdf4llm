# LlamaIndex RAG

End-to-end RAG using
[`llamaindex`](https://ts.llamaindex.ai/) + `mupdf4llm/llama`.

```sh
npm i mupdf4llm llamaindex @llamaindex/openai
```

```ts
import { PDFMarkdownReader } from "mupdf4llm/llama";
import { Settings, VectorStoreIndex } from "llamaindex";
import { OpenAI, OpenAIEmbedding } from "@llamaindex/openai";

Settings.llm = new OpenAI({ model: "gpt-4o-mini" });
Settings.embedModel = new OpenAIEmbedding({ model: "text-embedding-3-small" });

const reader = new PDFMarkdownReader();
const docs = await reader.loadData("paper.pdf");

const index = await VectorStoreIndex.fromDocuments(docs);
const engine = index.asQueryEngine();

const answer = await engine.query({
  query: "What's the main contribution of the paper?",
});
console.log(answer.message);
```

Each page becomes a `Document`. Per-page metadata (`page`,
`total_pages`, `title`, `file_path`) is attached automatically, so
the LLM can cite source pages in its answer.

## Filtering metadata

If you want to control what makes it into the embedding model's
context window:

```ts
const reader = new PDFMarkdownReader({
  metaFilter: (m) => ({
    page: m.page,
    title: m.title,
    file_path: m.file_path,
  }),
});
```

## Forwarding extraction options

To embed images or extract per-word coords:

```ts
const docs = await reader.loadData(
  "paper.pdf",
  /* extraInfo */ { collection: "papers/2026" },
  /* MarkdownOptions */ { embedImages: true },
);
```

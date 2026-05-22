# LlamaIndex adapter

`mupdf4llm` ships a [LlamaIndex](https://ts.llamaindex.ai/) reader at
the `mupdf4llm/llama` subpath export — a one-for-one port of
`pymupdf4llm.llama.PDFMarkdownReader`.

## Setup

`llamaindex` is declared as an **optional peer dependency**. Install
it in your project if you want a real `Document`:

```sh
npm i llamaindex
```

If you don't, the reader still works — it returns plain
`{ text, extra_info }` records with the same shape.

## Usage

```ts
import { PDFMarkdownReader } from "mupdf4llm/llama";

const reader = new PDFMarkdownReader();
const docs = await reader.loadData("paper.pdf");
// docs[i] is a Document (or { text, extra_info }) — one per page
```

## Filter metadata

```ts
const reader = new PDFMarkdownReader({
  metaFilter: (m) => ({ page: m.page, title: m.title }),
});
```

## Forwarding `MarkdownOptions`

`loadData(path, extra?, opts?)` forwards a third argument to
`toMarkdown` — handy if you want images, words, etc. inside each
`Document`:

```ts
const docs = await reader.loadData(
  "paper.pdf",
  {},
  {
    embedImages: true,
    extractWords: true,
  },
);
```

## End-to-end example

See [examples/llama-rag](/examples/llama-rag) for a complete RAG
pipeline using `VectorStoreIndex` + an OpenAI / Anthropic-backed LLM.

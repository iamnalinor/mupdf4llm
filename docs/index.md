---
layout: home

hero:
  name: mupdf4llm
  text: PDFs → LLM-ready Markdown
  tagline: TypeScript port of pymupdf4llm on top of the official mupdf WASM package. Byte-for-byte parity with the Python upstream on the supported feature set.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: View on npm
      link: https://www.npmjs.com/package/mupdf4llm
    - theme: alt
      text: GitHub
      link: https://github.com/iamnalinor/mupdf4llm

features:
  - title: Drop-in for pymupdf4llm
    details: Same algorithms as the Python reference (`pymupdf4llm.helpers.pymupdf_rag.to_markdown`). Validated by parity tests that diff every fixture against the live Python output.
  - title: Pure JS, no native build
    details: Runs on Node 20+ and Bun out of the box. The only runtime dependency is the official `mupdf` WASM package from Artifex.
  - title: Headers, tables, images, forms
    details: Font-size or TOC-driven headers, four table strategies, image extraction or base64 embedding, AcroForm field dump, per-word coordinates — all via the same `toMarkdown()` entry point.
  - title: LlamaIndex-ready
    details: Optional `mupdf4llm/llama` subpath export ships a `PDFMarkdownReader` that yields one `Document` per page, with `llamaindex` as an optional peer dependency.
---

## Why a TS port?

The Python `pymupdf4llm` is excellent, but RAG pipelines increasingly
live in Node / Bun / browser-adjacent stacks. Spinning up a Python
sidecar just to call `to_markdown` is friction. This package gives you
the same output, the same options, and the same fixtures — straight
from the JavaScript runtime you already have.

## Install

::: code-group

```sh [npm]
npm i mupdf4llm
```

```sh [bun]
bun add mupdf4llm
```

```sh [pnpm]
pnpm add mupdf4llm
```

:::

## 30-second tour

```ts
import { toMarkdown } from "mupdf4llm";
import { readFileSync } from "node:fs";

const md = toMarkdown(readFileSync("paper.pdf"));
console.log(md);
```

Need per-page chunks for RAG? Switch to `toMarkdownPages`:

```ts
import { toMarkdownPages } from "mupdf4llm";

const chunks = toMarkdownPages(readFileSync("paper.pdf"), {
  extractWords: true,
});
for (const c of chunks) console.log(c.metadata.page, c.text.length);
```

See the [quick start](/guide/quick-start) for more.

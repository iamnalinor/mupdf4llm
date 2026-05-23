# Installation

## Requirements

- **Node ≥ 20** or **Bun ≥ 1.0**
- The only runtime dependency is [`mupdf`](https://www.npmjs.com/package/mupdf)
  (Artifex's official WASM bindings). No native build, no system libs.

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

```sh [yarn]
yarn add mupdf4llm
```

:::

## Optional: LlamaIndex adapter

If you want the `PDFMarkdownReader` integration, install
[`llamaindex`](https://www.npmjs.com/package/llamaindex) alongside —
it's declared as an optional peer dependency:

```sh
npm i llamaindex
```

Without `llamaindex`, the adapter still loads — it just returns plain
`{ text, metadata }` objects with the same shape as a LlamaIndex
`Document` (the metadata field is always `metadata`, never
`extra_info`).

## Optional: parity tests

To run the parity suite locally you also need Python with
`pymupdf4llm`:

```sh
pip install pymupdf4llm
```

The tests spawn `python3 -c "..."` to compare the TS output against
the upstream. CI sets this up automatically — only needed if you
contribute to the library itself.

## Verify

```ts
import { toMarkdown } from "mupdf4llm";
import { readFileSync } from "node:fs";

const md = toMarkdown(readFileSync("any.pdf"));
console.log(md.slice(0, 80));
```

If you see Markdown coming out, you're set. Continue to the
[quick start](/guide/quick-start).

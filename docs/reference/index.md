# API reference

The pages under `/reference/api/` are auto-generated from the
TypeScript sources by [TypeDoc](https://typedoc.org/) — they reflect
exactly what's exported from the package on every build.

If a symbol's name doesn't appear here, treat it as an internal
detail not covered by the public API contract.

## Entry points

| Subpath           | Source                                                                                                               | Description                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `@nalinor/mupdf4llm`       | [`src/index.ts`](https://github.com/iamnalinor/mupdf4llm/blob/main/src/index.ts)                                     | Main API: `toMarkdown`, `toMarkdownPages`, types and helpers |
| `@nalinor/mupdf4llm/llama` | [`src/llama/pdfMarkdownReader.ts`](https://github.com/iamnalinor/mupdf4llm/blob/main/src/llama/pdfMarkdownReader.ts) | LlamaIndex adapter (`PDFMarkdownReader`)                     |

## Generated index

The TypeDoc-built tree is at
[/reference/api/README](/reference/api/README) — `bun run docs:api`
regenerates it from `typedoc.json`.

For prose-style guides, see [the guide section](/guide/getting-started).

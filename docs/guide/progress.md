# Progress bar

For long documents, set `showProgress: true` to render a per-page
progress bar on `stderr`:

```ts
toMarkdown(buf, { showProgress: true });
// pages [##########----------]  50% (50/100)
```

The implementation is a tiny iterable wrapper — `pymupdf4llm`'s
`progress.ProgressBar` ported one-for-one.

## Standalone use

The class is exported, so you can wrap any iterable:

```ts
import { ProgressBar } from "mupdf4llm";

for (const file of new ProgressBar(filesToProcess, { prefix: "pdfs " })) {
  await ingest(file);
}
```

Options:

- `width` — bar width in chars (default `40`)
- `prefix` — string drawn before the bar
- `stream` — anything with `.write(s: string)`; defaults to
  `process.stderr`

The bar redraws via `\r`, so output looks right in real terminals but
prints multiple lines if you pipe stderr to a file. Pass a
no-op `stream` to suppress.

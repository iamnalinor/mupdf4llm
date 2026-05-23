# Options reference

Every option on `MarkdownOptions`. Defaults match
[`pymupdf4llm.helpers.pymupdf_rag.to_markdown`](https://github.com/pymupdf/RAG/blob/main/src/helpers/pymupdf_rag.py).

## Page selection

| Key        | Type                               | Default   | Notes                                                                   |
| ---------- | ---------------------------------- | --------- | ----------------------------------------------------------------------- |
| `pages`    | `number[]`                         | all pages | 0-based indices.                                                        |
| `margins`  | `number \| [t, b] \| [l, t, r, b]` | `0`       | Crop the page before extraction.                                        |
| `filename` | `string`                           | `""`      | Surfaced in `PageChunk.metadata.file_path` and used in image filenames. |

## Output mode

| Key              | Type      | Default | Notes                                                    |
| ---------------- | --------- | ------- | -------------------------------------------------------- |
| `pageSeparators` | `boolean` | `false` | Insert `--- end of page=N ---` markers in joined output. |

Use `toMarkdownPages` instead of `toMarkdown` when you want per-page
chunks — the choice of return shape isn't an option, it's a separate
entry point.

## Text and styling

| Key          | Type                                                 | Default                | Notes                                             |
| ------------ | ---------------------------------------------------- | ---------------------- | ------------------------------------------------- |
| `ignoreCode` | `boolean`                                            | `false`                | Suppress fenced code blocks for monospaced spans. |
| `forceText`  | `boolean`                                            | `true`                 | Emit text even on top of images.                  |
| `hdrInfo`    | `IdentifyHeaders \| TocHeaders \| function \| false` | auto `IdentifyHeaders` | See [Headers](/guide/headers).                    |

## Tables

| Key                  | Type                                                        | Default          | Notes                                                   |
| -------------------- | ----------------------------------------------------------- | ---------------- | ------------------------------------------------------- |
| `tableStrategy`      | `"lines_strict" \| "lines" \| "text" \| "explicit" \| null` | `"lines_strict"` | See [Tables](/guide/tables). `null` disables detection. |
| `explicitTableGrids` | `{ hLines: number[]; vLines: number[] }[]`                  | `[]`             | For `"explicit"` only.                                  |

## Images

| Key              | Type                       | Default | Notes                                                   |
| ---------------- | -------------------------- | ------- | ------------------------------------------------------- |
| `writeImages`    | `boolean`                  | `false` | Save each detected image region to `imagePath`.         |
| `embedImages`    | `boolean`                  | `false` | Inline images as `data:` URIs in the Markdown.          |
| `imagePath`      | `string`                   | `""`    | Output directory for `writeImages`. Created if missing. |
| `imageFormat`    | `"png" \| "jpg" \| "jpeg"` | `"png"` | Encoding format.                                        |
| `dpi`            | `number`                   | `150`   | Rasterization DPI.                                      |
| `imageSizeLimit` | `number`                   | `0.05`  | Skip images smaller than this fraction of a page edge.  |

## Words / chunks

| Key            | Type      | Default | Notes                                            |
| -------------- | --------- | ------- | ------------------------------------------------ |
| `extractWords` | `boolean` | `false` | Populate `PageChunk.words` with per-word bboxes. |

## Page rotation

| Key              | Type      | Default | Notes                                                                                        |
| ---------------- | --------- | ------- | -------------------------------------------------------------------------------------------- |
| `removeRotation` | `boolean` | `true`  | Derotate the page (visual-preserving) before processing, like PyMuPDF's `remove_rotation()`. |

## Filtering

| Key             | Type      | Default     | Notes                                                                                                                  |
| --------------- | --------- | ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| `fontsizeLimit` | `number`  | `undefined` | Skip spans whose font size is below this (in pt). Mirrors upstream `FONTSIZE_LIMIT`.                                   |
| `ignoreAlpha`   | `boolean` | `false`     | Accept invisible text. **No-op today** — `mupdf.js` doesn't expose per-char alpha; field reserved for upstream parity. |

## Misc

| Key            | Type      | Default | Notes                                                 |
| -------------- | --------- | ------- | ----------------------------------------------------- |
| `showProgress` | `boolean` | `false` | Render `ProgressBar` to stderr while iterating pages. |

For the canonical types, see
[`src/helpers/types.ts`](https://github.com/iamnalinor/mupdf4llm/blob/main/src/helpers/types.ts).

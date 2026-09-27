# Tables

`tableStrategy` controls how table regions are detected. Set it to
`null` to disable detection entirely. Where the cell text comes from is
a separate option, `textSource` — see [OCR for tables](/guide/ocr).

## `lines_strict` (default)

Requires a **complete grid** of horizontal and vertical rules. Best
parity with PyMuPDF for ruled tables (financial reports, spec sheets,
scientific tables with rules on every cell boundary).

```ts
await toMarkdown(buf); // implicit "lines_strict"
```

## `lines`

Same algorithm with **looser edge thresholds**. Picks up tables drawn
with partial rules — e.g. only horizontal separators, or thin
hair-lines that fall below the strict 3-px threshold.

```ts
await toMarkdown(buf, { tableStrategy: "lines" });
```

## `text`

**No rules required.** Detects tables purely from text alignment. Text
lines are first grouped into visual rows, so it does not matter whether
the PDF stores a row as one line with a span per cell or as one line (or
block) per cell. A contiguous run of rows sharing ≥2 column starts is a
table body; a start that falls inside a word of another row (a
right-aligned or centred cell) is ignored. A header directly above the
body whose labels wrap over several lines defines the columns: the
boundary between two labels is placed where no body word crosses it.

Lightweight port — for tables with no rules it produces a usable grid
but the column boundaries are heuristic and may not byte-match PyMuPDF.

```ts
await toMarkdown(buf, { tableStrategy: "text" });
```

## `explicit`

Pass the grid yourself. Useful when you already know cell boundaries
(e.g. from a layout-aware preprocessing pass).

```ts
await toMarkdown(buf, {
  tableStrategy: "explicit",
  explicitTableGrids: [
    {
      hLines: [120, 145, 170, 195, 220], // horizontal coords
      vLines: [50, 180, 310, 450], // vertical coords
    },
  ],
});
```

## `pixels`

Finds the ruling lines on the **rendered page** rather than in the PDF
drawings, so it works on scans. Cell text comes from OCR by default —
see [OCR for tables](/guide/ocr).

```ts
await toMarkdown(buf, { tableStrategy: "pixels" });
```

## Inspecting detected tables

In `pageChunks` mode every detected table surfaces in `PageChunk.tables`:

```ts
const chunks = await toMarkdownPages(buf);
for (const c of chunks) {
  for (const t of c.tables) {
    console.log(t.bbox, t.rows, t.columns);
    console.log(t.cells); // [row][col] → { text, source: "pdf" | "ocr" | "failed" } | null
  }
}
```

## Cells inside markdown

Each detected table is rendered as a GitHub-flavored markdown table.

- **Wrapped cells.** When a cell's text wraps across several visual
  lines, the lines are joined with `<br>` (MD-safe). Cell membership is
  decided per character — a glyph belongs to a cell only when its
  bounding box overlaps the cell by more than 50% of its own area
  (matching `pymupdf.table.extract_cells`). This prevents a span that
  grazes a row boundary from being duplicated into both neighbouring
  rows.
- **Header row.** The first row is rendered as plain text, mirroring
  upstream `Table.to_markdown`, which takes header text from the plain
  `header.names` rather than the markdown-styled cell path. Inline
  `**bold**` / `_italic_` styling is applied only to body cells.

## Rotated pages

Tables on pages with a `/Rotate` of 90° or 270° are extracted correctly
because the page is derotated (visual-preserving) before detection — see
[Page rotation](/guide/page-rotation). Without that step the rows and
columns of the table would be transposed.

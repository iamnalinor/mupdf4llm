# Tables

`tableStrategy` controls how table regions are detected. Set it to
`null` to disable detection entirely.

## `lines_strict` (default)

Requires a **complete grid** of horizontal and vertical rules. Best
parity with PyMuPDF for ruled tables (financial reports, spec sheets,
scientific tables with rules on every cell boundary).

```ts
toMarkdown(buf); // implicit "lines_strict"
```

## `lines`

Same algorithm with **looser edge thresholds**. Picks up tables drawn
with partial rules — e.g. only horizontal separators, or thin
hair-lines that fall below the strict 3-px threshold.

```ts
toMarkdown(buf, { tableStrategy: "lines" });
```

## `text`

**No rules required.** Detects tables purely from text alignment:
clusters x-coordinates of span starts across adjacent lines, treats a
contiguous run of lines sharing ≥2 column positions as a table.

Lightweight port — for tables with no rules it produces a usable grid
but the column boundaries are heuristic and may not byte-match PyMuPDF.

```ts
toMarkdown(buf, { tableStrategy: "text" });
```

## `explicit`

Pass the grid yourself. Useful when you already know cell boundaries
(e.g. from a layout-aware preprocessing pass).

```ts
toMarkdown(buf, {
  tableStrategy: "explicit",
  explicitTableGrids: [
    {
      hLines: [120, 145, 170, 195, 220], // horizontal coords
      vLines: [50, 180, 310, 450], // vertical coords
    },
  ],
});
```

## Inspecting detected tables

In `pageChunks` mode every detected table surfaces in `PageChunk.tables`:

```ts
const chunks = toMarkdownPages(buf);
for (const c of chunks) {
  for (const t of c.tables) {
    console.log(t.bbox, t.rows, t.columns);
  }
}
```

## Cells inside markdown

Each detected table is rendered as a GitHub-flavored markdown table.
Newlines inside a cell become `<br>` (MD-safe).

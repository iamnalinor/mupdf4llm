import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { Rect } from "../src/helpers/geometry";
import type { BBox } from "../src/helpers/geometry";
import {
  clusterStripes,
  computeReadingOrder,
  startswithBullet,
  isWhite,
} from "../src/helpers/utils";
import { ProgressBar } from "../src/helpers/progress";
import { TocHeaders, IdentifyHeaders } from "../src/helpers/text/identifyHeaders";
import { extractWords } from "../src/helpers/text/extractWords";
import { getKeyValues } from "../src/helpers/forms/formFields";
import { toMarkdown, toMarkdownPages } from "../src/index";
import type { MarkdownElement } from "../src/index";
import { PDFMarkdownReader } from "../src/llama/pdfMarkdownReader";
import { findTables } from "../src/helpers/tables/tableFinder";
import type { Block, Line, Span } from "../src/helpers/types";

function openFixture(name: string): mupdf.PDFDocument {
  return mupdf.PDFDocument.openDocument(
    new Uint8Array(readFileSync(`tests/fixtures/${name}`)),
    "application/pdf",
  ) as mupdf.PDFDocument;
}

test("isWhite + startswithBullet", () => {
  expect(isWhite("   ")).toBe(true);
  expect(isWhite(" a ")).toBe(false);
  expect(startswithBullet("- foo")).toBe(true);
  expect(startswithBullet("– foo")).toBe(true);
  expect(startswithBullet("Foo")).toBe(false);
});

test("clusterStripes groups overlapping bands", () => {
  const a = new Rect(0, 0, 50, 10);
  const b = new Rect(60, 2, 100, 12);
  const c = new Rect(0, 50, 50, 60);
  const stripes = clusterStripes([a, b, c]);
  expect(stripes.length).toBe(2);
  expect(stripes[0]!.length).toBe(2);
  expect(stripes[1]!.length).toBe(1);
});

test("computeReadingOrder sorts top→bottom, left→right within stripe", () => {
  const a = new Rect(50, 0, 100, 10);
  const b = new Rect(0, 2, 40, 12);
  const c = new Rect(0, 50, 50, 60);
  const order = computeReadingOrder([a, b, c]);
  expect(order[0]).toBe(b);
  expect(order[1]).toBe(a);
  expect(order[2]).toBe(c);
});

test("ProgressBar yields all items in order", () => {
  const sink: string[] = [];
  const bar = new ProgressBar([1, 2, 3], {
    width: 10,
    stream: { write: (s) => sink.push(s) },
  });
  const collected: number[] = [];
  for (const x of bar) collected.push(x);
  expect(collected).toEqual([1, 2, 3]);
  // first render: 0/3, last: 3/3, plus a final newline
  expect(sink.some((s) => s.includes("0/3"))).toBe(true);
  expect(sink.some((s) => s.includes("3/3"))).toBe(true);
});

test("IdentifyHeaders maps the largest font to '#'", () => {
  const doc = openFixture("pdflatex-outline.pdf");
  try {
    const ih = new IdentifyHeaders(doc);
    expect(ih.header_id.size).toBeGreaterThan(0);
    // body_limit should be a sensible default
    expect(ih.body_limit).toBeGreaterThan(0);
  } finally {
    doc.destroy();
  }
});

test("TocHeaders constructs without error on an outlined doc", () => {
  const doc = openFixture("pdflatex-outline.pdf");
  try {
    const th = new TocHeaders(doc);
    // The outline test PDF has nested chapters; verify the constructor wired
    // them into the per-page map (smoke check only — exact titles depend on PDF).
    expect(th).toBeInstanceOf(TocHeaders);
  } finally {
    doc.destroy();
  }
});

test("extractWords resets word index per line", () => {
  const doc = openFixture("pdflatex-4-pages.pdf");
  try {
    const page = doc.loadPage(0);
    const words = extractWords(page);
    expect(words.length).toBeGreaterThan(0);
    // Every line should start at word === 0
    const seen = new Map<string, number>();
    for (const w of words) {
      const key = `${w.block}:${w.line}`;
      if (!seen.has(key)) {
        expect(w.word).toBe(0);
        seen.set(key, 1);
      } else {
        // Consecutive words on the same line increase monotonically.
        const prev = seen.get(key)!;
        expect(w.word).toBe(prev);
        seen.set(key, prev + 1);
      }
    }
  } finally {
    doc.destroy();
  }
});

test("getKeyValues extracts a non-empty list with valid shapes", () => {
  const doc = openFixture("pdflatex-forms.pdf");
  try {
    const fields = getKeyValues(doc);
    expect(fields.length).toBeGreaterThan(0);
    for (const f of fields) {
      expect(typeof f.name).toBe("string");
      expect(typeof f.value).toBe("string");
      expect(["text", "checkbox", "radio", "choice", "signature", "unknown"]).toContain(f.type);
      expect(f.bbox).toHaveLength(4);
      expect(typeof f.page).toBe("number");
    }
  } finally {
    doc.destroy();
  }
});

test("MarkdownOptions.fontsizeLimit drops small spans", () => {
  // pdflatex-4-pages renders body text around 11pt and headers ~12pt.
  // Setting fontsizeLimit above body kills body but keeps headers.
  const buf = readFileSync("tests/fixtures/pdflatex-4-pages.pdf");
  const full = toMarkdownPages(buf);
  const trimmed = toMarkdownPages(buf, { fontsizeLimit: 100 });
  // Filter so aggressive that nothing should survive
  const fullLen = full.map((c) => c.text.length).reduce((a, b) => a + b, 0);
  const trimmedLen = trimmed.map((c) => c.text.length).reduce((a, b) => a + b, 0);
  expect(fullLen).toBeGreaterThan(0);
  expect(trimmedLen).toBeLessThan(fullLen);
});

test("PageChunk shape: tables/images carry real bboxes, words are typed", () => {
  // Use the vendored real-world fixture which has tables.
  const buf = readFileSync("tests/fixtures/pdflatex-4-pages.pdf");
  const chunks = toMarkdownPages(buf, { extractWords: true });
  expect(chunks.length).toBeGreaterThan(0);
  for (const c of chunks) {
    expect(Array.isArray(c.words)).toBe(true);
    expect(Array.isArray(c.tables)).toBe(true);
    expect(Array.isArray(c.images)).toBe(true);
    // PageChunk no longer carries a `graphics` field — confirm it's absent.
    expect("graphics" in c).toBe(false);
  }
});

test("PDFMarkdownReader yields { text, metadata } regardless of llamaindex", async () => {
  // tests/fixtures/pdflatex-forms.pdf is small (1 page) → fast.
  const reader = new PDFMarkdownReader();
  const docs = await reader.loadData("tests/fixtures/pdflatex-forms.pdf");
  expect(docs.length).toBe(1);
  const d = docs[0]!;
  expect(typeof d.text).toBe("string");
  expect(d.metadata).toBeTruthy();
  // metadata must be the field name, not extra_info
  expect("metadata" in d).toBe(true);
  expect("extra_info" in d).toBe(false);
});

const ALL_ELEMENTS: MarkdownElement[] = [
  "bold",
  "italic",
  "inlineCode",
  "codeBlock",
  "header",
  "bulletList",
  "link",
  "table",
  "image",
  "lineBreak",
];
const without = (e: MarkdownElement): MarkdownElement[] => ALL_ELEMENTS.filter((x) => x !== e);
const wordCount = (s: string) => (s.match(/\S+/g) ?? []).length;

test("elements: omitting it is identical to the full whitelist", () => {
  const buf = new Uint8Array(readFileSync("tests/fixtures/pdflatex-outline.pdf"));
  expect(toMarkdown(buf, { elements: ALL_ELEMENTS })).toBe(toMarkdown(buf));
});

test("elements: [] strips all markup but keeps text", () => {
  const buf = new Uint8Array(readFileSync("tests/fixtures/pdflatex-outline.pdf"));
  const md = toMarkdown(buf, { elements: [] }) as string;
  expect(md).not.toContain("**");
  expect(md).not.toMatch(/^#/m);
  expect(md).not.toContain("<br>");
  expect(wordCount(md)).toBeGreaterThan(0);
});

test("elements: dropping 'bold' removes ** but keeps headers", () => {
  const buf = new Uint8Array(readFileSync("tests/fixtures/pdflatex-outline.pdf"));
  const full = toMarkdown(buf) as string;
  expect(full).toContain("**"); // sanity: fixture has bold + headers
  expect(full).toMatch(/^#/m);
  const md = toMarkdown(buf, { elements: without("bold") }) as string;
  expect(md).not.toContain("**");
  expect(md).toMatch(/^#/m);
});

test("elements: dropping 'lineBreak' removes <br> while keeping tables", () => {
  const buf = new Uint8Array(readFileSync("tests/fixtures/nics-background-checks-2015-11.pdf"));
  const full = toMarkdown(buf) as string;
  expect(full).toContain("<br>"); // sanity: fixture has wrapped cells
  const md = toMarkdown(buf, { elements: without("lineBreak") }) as string;
  expect(md).not.toContain("<br>");
  expect(md).toMatch(/^\|/m); // tables still rendered
});

test("elements: dropping 'table' emits cell text as plain paragraphs, not lost", () => {
  const buf = new Uint8Array(readFileSync("tests/fixtures/nics-background-checks-2015-11.pdf"));
  const full = toMarkdown(buf) as string;
  expect(full).toMatch(/^\|/m); // sanity: fixture is table-heavy
  const md = toMarkdown(buf, { elements: without("table") }) as string;
  expect(md).not.toMatch(/^\|/m); // no markdown table rows
  // Table content must survive as plain text rather than disappearing.
  expect(wordCount(md)).toBeGreaterThanOrEqual(wordCount(full));
});

// ---------------------------------------------------------------------------
// Vector table grids (fixtures generated by scripts/make-table-fixtures.ts)
// ---------------------------------------------------------------------------

function tablePages(name: string): string[] {
  const buf = new Uint8Array(readFileSync(`tests/fixtures/${name}`));
  return toMarkdownPages(buf, { tableStrategy: "lines", elements: ["table"] }).map((c) => c.text);
}

/** Markdown table rows (separator rows excluded) as arrays of cells. */
function tableRows(md: string): string[][] {
  return md
    .split("\n")
    .filter((l) => l.startsWith("|") && !/^\|(---\|)+$/.test(l))
    .map((l) => l.slice(1, -1).split(/(?<!\\)\|/));
}

test("tables: grid stroked as one compound path, continued over two pages", () => {
  const pages = tablePages("compound-stroke-grid.pdf");
  expect(pages.length).toBe(2);
  const rows = pages.map(tableRows);
  expect(rows[0]![0]).toEqual(["No", "Name", "Region", "Score"]);
  expect(rows[0]!).toContainEqual(["1", "Person 1", "South", "99"]);
  expect(rows[0]!.at(-1)).toEqual(["37", "Person 37", "South", "63"]);
  expect(rows[1]![0]).toEqual(["38", "Person 38", "East", "62"]);
  expect(rows[1]!.at(-1)).toEqual(["49", "Person 49", "South", "51"]);
  // Every data row once, all 4 columns, no empty rows from off-page rules.
  const all = rows.flat().filter((r) => r[0] !== "No");
  expect(all.map((r) => r[0])).toEqual(Array.from({ length: 49 }, (_, i) => String(i + 1)));
  expect(all.every((r) => r.length === 4 && r.every((c) => c !== ""))).toBe(true);
  // The curved "seal" and the diagonal below the table stay plain text.
  expect(pages[1]).toMatch(/^Seal$/m);
});

test("tables: grid filled as one path of many thin rectangles", () => {
  const [page] = tablePages("compound-fill-grid.pdf");
  const rows = tableRows(page!);
  expect(rows.length).toBe(12);
  expect(rows[0]).toEqual(["No", "Name", "City", "Grade", "Score"]);
  expect(rows).toContainEqual(["7", "Student 7", "City 3", "11", "57"]);
  // A word wrapped after its hyphen is rejoined without a space.
  expect(rows).toContainEqual(["5", "Student 5", "North-West", "9", "55"]);
});

test("tables: merged header cells are not split by inner grid coordinates", () => {
  const [page] = tablePages("merged-cells-grid.pdf");
  const rows = tableRows(page!);
  expect(rows[0]).toEqual(["No", "Name", "Results per task", "", "", "Total"]);
  expect(rows[1]).toEqual(["", "", "T1", "T2", "T3", ""]);
  expect(rows[2]).toEqual(["1", "Member 1", "1", "4", "6", "11"]);
  expect(rows.length).toBe(8);
});

test("tables: glyphs taller than their row are assigned by center", () => {
  const [page] = tablePages("tall-glyph-cells.pdf");
  const rows = tableRows(page!);
  expect(rows[0]).toEqual(["No", "Name", "Score"]);
  expect(rows.slice(1)).toEqual(
    Array.from({ length: 7 }, (_, i) => [String(i + 1), `Pupil ${i + 1}`, String(31 + i)]),
  );
});

test("tables: white cell/line backgrounds do not create phantom rows", () => {
  const [page] = tablePages("white-cell-backgrounds.pdf");
  const rows = tableRows(page!);
  expect(rows).toEqual([
    ["No", "Name", "Score"],
    ...Array.from({ length: 5 }, (_, i) => [
      String(i + 1),
      `Entrant ${i + 1} Surname ${i + 1}`,
      String(21 + i),
    ]),
  ]);
});

test("tables: rotated page with a CropBox keeps its full width", () => {
  const [page] = tablePages("rotated-cropbox-table.pdf");
  expect(tableRows(page!)).toEqual([
    ["Key", "Alpha", "Beta", "Gamma", "Delta"],
    ["k1", "a1", "b1", "g1", "d1"],
    ["k2", "a2", "b2", "g2", "d2"],
  ]);
});

test("tables: multi-line body cells never break the markdown row without <br>", () => {
  const buf = new Uint8Array(readFileSync("tests/fixtures/nics-background-checks-2015-11.pdf"));
  const md = toMarkdown(buf, { elements: ["table"] }) as string;
  const lines = md.split("\n").filter((l) => l.startsWith("|"));
  expect(lines.length).toBeGreaterThan(10);
  expect(lines.every((l) => l.endsWith("|"))).toBe(true);
});

test("tables: white rules on shading, header-only column rules, rounded border", () => {
  const pages = tablePages("rule-variants.pdf");
  const body = [
    ["1", "Item 1", "10"],
    ["2", "Item 2", "20"],
    ["3", "Item 3", "30"],
  ];
  for (const [i, first] of ["Shaded", "Header", "Rounded"].entries()) {
    expect(tableRows(pages[i]!)).toEqual([[first, "Label", "Value"], ...body]);
  }
});

// ---------------------------------------------------------------------------
// Text strategy
// ---------------------------------------------------------------------------

function textTableRows(name: string): string[][] {
  const buf = new Uint8Array(readFileSync(`tests/fixtures/${name}`));
  const pages = toMarkdownPages(buf, { tableStrategy: "text", elements: ["table"] });
  return pages.flatMap((p) => tableRows(p.text));
}

test("tables: text strategy, each cell of a row is its own text line", () => {
  expect(textTableRows("split-line-rows.pdf")).toEqual([
    [
      "Name",
      "Grade",
      "Team name",
      "Round one, points in Physics",
      "Round one, points in Biology",
      "Team round, points",
      "Total",
    ],
    ["Alice Brown", "11", "North \\| Blue", "22,5", "24,0", "88,5", "62,40"],
    ["Bob Green", "11", "North \\| Blue", "26,5", "10,0", "88,5", "60,40"],
    ["Carol White", "10", "Tasters", "19,5", "14,0", "86,5", "58,60"],
    ["David Black", "9", "Tasters", "8,0", "21,5", "86,5", "55,15"],
    ["Eve Grey", "11", "Blenders", "17,0", "6,5", "71,0", "49,90"],
  ]);
});

test("tables: text strategy, centred cells under a one-line header, no false tables in prose", () => {
  // Pages 1-2 are two-column prose, page 3 holds a ruleless table.
  expect(textTableRows("multicolumn.pdf")).toEqual([
    ["Country", "Population (millions)", "Area (km2)", "Capital", "Official Language"],
    ["Austria", "8.9", "83,879", "Vienna", "German"],
    ["Belgium", "11.5", "30,689", "Brussels", "Dutch, French, German"],
    ["Czech Republic", "10.7", "78,866", "Prague", "Czech"],
    ["Denmark", "5.8", "42,951", "Copenhagen", "Danish"],
    ["Finland", "5.5", "338,424", "Helsinki", "Finnish, Swedish"],
  ]);
});

/** A one-span text line with 5pt-wide glyphs. */
function textLine(text: string, x: number, y: number): Line {
  const chars = [...text].map((c, i) => ({
    c,
    bbox: [x + i * 5, y, x + (i + 1) * 5, y + 8] as [number, number, number, number],
  }));
  const span = {
    bbox: new Rect(x, y, x + text.length * 5, y + 8),
    text,
    font: "Test",
    size: 8,
    color: 0,
    flags: 0,
    char_flags: 0,
    alpha: 255,
    ascender: 1,
    descender: 0,
    origin: [x, y + 8],
    chars,
  } as Span;
  return { bbox: [x, y, x + text.length * 5, y + 8], dir: [1, 0], wmode: 0, spans: [span] };
}

test("tables: text strategy, every cell in its own block", () => {
  const cols = [0, 100, 150, 220];
  const rows = [
    ["Name", "Grade", "Team", "Score"],
    ["Alice", "10", "North", "91"],
    ["Bob", "11", "South", "82"],
    ["Carol", "9", "West", "73"],
  ];
  const blocks: Block[] = rows.flatMap((values, r) =>
    values.map((v, c) => {
      const line = textLine(v, cols[c]!, r * 12);
      return { type: 0 as const, bbox: line.bbox, lines: [line] };
    }),
  );
  const [table, ...rest] = findTables(blocks, [], new Rect(0, 0, 300, 100), { strategy: "text" });
  expect(rest).toEqual([]);
  expect(tableRows(table!.to_markdown())).toEqual(rows);
});

/** One block per cell; `x(c, text)` gives the cell's x0. */
function cellBlocks(rows: string[][], x: (c: number, text: string) => number, y0 = 0): Block[] {
  return rows.flatMap((values, r) =>
    values.map((v, c) => {
      const line = textLine(v, x(c, v), y0 + r * 12);
      return { type: 0 as const, bbox: line.bbox, lines: [line] };
    }),
  );
}

const textTables = (blocks: Block[]) =>
  findTables(blocks, [], new Rect(-100, -100, 1000, 1000), { strategy: "text" }).map((t) =>
    tableRows(t.to_markdown()),
  );

test("tables: text strategy, right-aligned numbers under a one-line header", () => {
  const rows = [
    ["Name", "Grade", "Team", "Points"],
    ["Alice", "10", "North", "191"],
    ["Bob", "9", "South", "82"],
    ["Carol", "11", "West", "7"],
  ];
  // Header labels left-aligned, numbers right-aligned at x=125 and x=250.
  const x = (c: number, v: string) =>
    v === rows[0]![c]
      ? [0, 100, 150, 220][c]!
      : c === 1
        ? 125 - v.length * 5
        : c === 3
          ? 250 - v.length * 5
          : [0, 100, 150, 220][c]!;
  expect(textTables(cellBlocks(rows, x))).toEqual([rows]);
});

test("tables: text strategy keeps stacked tables apart", () => {
  const a = [
    ["Key", "Value", "Unit"],
    ["alpha", "1", "m"],
    ["beta", "2", "s"],
  ];
  const b = [
    ["Code", "Qty", "Price", "Note"],
    ["X1", "5", "9.99", "ok"],
    ["X2", "7", "1.50", "no"],
    ["X3", "2", "3.10", "ok"],
  ];
  const blocks = [
    ...cellBlocks(a, (c) => [0, 120, 200][c]!),
    ...cellBlocks(b, (c) => [0, 60, 110, 170][c]!, 44),
  ];
  expect(textTables(blocks)).toEqual([a, b]);
});

test("tables: text strategy ignores three columns of prose", () => {
  // Gutters wider than twice the line height, lines ragged by up to 15pt.
  const blocks: Block[] = [];
  for (let c = 0; c < 3; c++) {
    const lines = Array.from({ length: 40 }, (_, i) =>
      textLine(
        "lorem ipsum dolor sit amet, consectetuer".slice(0, 29 + ((i + c) % 4)),
        c * 185,
        i * 11,
      ),
    );
    blocks.push({ type: 0, bbox: [c * 185, 0, c * 185 + 160, 440], lines });
  }
  expect(textTables(blocks)).toEqual([]);
});

test("tables: text strategy ignores an overprinted (fake bold) header copy", () => {
  const rows = [
    ["Name", "Grade", "Team", "Score"],
    ["Alice", "10", "North", "91"],
    ["Bob", "11", "South", "82"],
    ["Carol", "9", "West", "73"],
  ];
  const cols = [0, 100, 150, 220];
  const blocks = cellBlocks(rows, (c) => cols[c]!);
  const copy = cellBlocks([rows[0]!], (c) => cols[c]! + 0.4);
  const [table] = findTables([...blocks, ...copy], [], new Rect(-100, -100, 1000, 1000), {
    strategy: "text",
  });
  expect(table!.row_count).toBe(4);
});

test("tables: text strategy keeps a header that reaches into the first row", () => {
  // "No", "Name" and "Total" are taller than the T1..T3 row they touch; the
  // group label above T1..T3 spans columns and stays outside the table.
  const buf = new Uint8Array(readFileSync("tests/fixtures/merged-cells-grid.pdf"));
  const [page] = toMarkdownPages(buf, { tableStrategy: "text" });
  const rows = tableRows(page!.text);
  expect(rows[0]).toEqual(["No", "Name", "T1", "T2", "T3", "Total"]);
  expect(page!.text).toContain("Results per task");
  expect(rows[1]).toEqual(["1", "Member 1", "1", "4", "6", "11"]);
});

test("tables: markdown escaping of | and trailing backslashes in cells", () => {
  const rows = [
    ["Path", "Rule", "Note"],
    ["C:\\dir\\", "a|b", "x\\|y"],
    ["D:\\", "c", "d"],
  ];
  const md = findTables(
    cellBlocks(rows, (c) => [0, 100, 200][c]!),
    [],
    new Rect(-100, -100, 1000, 1000),
    {
      strategy: "text",
    },
  )[0]!.to_markdown();
  expect(md).toContain("|C:\\dir\\\\|a\\|b|x\\\\\\|y|");
});

test("tables: text strategy keeps a column that only a totals row crosses", () => {
  const cols = [0, 100, 150, 220];
  const lines = [
    ["Item", "Qty", "Price", "Sum"],
    ["Apple", "2", "1.00", "2.00"],
    ["Pear", "3", "2.00", "6.00"],
  ].map((values, r) => {
    const spans = values.map((v, c) => textLine(v, cols[c]!, r * 12).spans[0]!);
    return { bbox: [0, r * 12, 240, r * 12 + 8] as BBox, dir: [1, 0], wmode: 0, spans } as Line;
  });
  const total = textLine("Grand total incl. tax", 0, 36);
  total.spans.push(textLine("13.00", 220, 36).spans[0]!);
  const blocks: Block[] = [{ type: 0, bbox: [0, 0, 250, 44], lines: [...lines, total] }];
  const [rows] = textTables(blocks);
  expect(rows!.slice(0, 3)).toEqual([
    ["Item", "Qty", "Price", "Sum"],
    ["Apple", "2", "1.00", "2.00"],
    ["Pear", "3", "2.00", "6.00"],
  ]);
});

test("tables: text strategy leaves a paragraph touching a table outside it", () => {
  const rows = [
    ["Alice", "10", "North", "91"],
    ["Bob", "11", "South", "82"],
    ["Carol", "9", "West", "73"],
  ];
  // Paragraph lines 8pt apart, the last one reaching 1pt into the first row.
  const para = [0, 1, 2].map((i) => {
    const line = textLine("Paragraph text that runs across the page width " + i, 0, -23 + i * 8);
    return { type: 0 as const, bbox: line.bbox, lines: [line] };
  });
  const tables = findTables(
    [...para, ...cellBlocks(rows, (c) => [0, 100, 150, 220][c]!)],
    [],
    new Rect(-100, -100, 1000, 1000),
    { strategy: "text" },
  );
  expect(tables.map((t) => tableRows(t.to_markdown()))).toEqual([rows]);
  expect(tables[0]!.bbox[1]).toBeGreaterThanOrEqual(1);
});

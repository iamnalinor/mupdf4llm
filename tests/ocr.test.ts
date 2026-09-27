import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { toMarkdown, toMarkdownPages, createRapidOcr, OcrSetupError, Rect } from "../src/index";
import type { OcrEngine, OcrImage } from "../src/index";
import { PageRaster } from "../src/helpers/ocr/engine";
import { looksBroken } from "../src/helpers/ocr/cellText";
import { detectRulings } from "../src/helpers/tables/pixelGrid";
import { degrade, type Degradation } from "./helpers/degrade";

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/${name}`));

/** Fake engine: answers "cell<n>" and records every image it was given. */
function fakeEngine(answer?: (n: number) => string): OcrEngine & { calls: OcrImage[] } {
  const calls: OcrImage[] = [];
  return {
    calls,
    async recognize(img) {
      calls.push(img);
      return answer ? answer(calls.length) : `cell${calls.length}`;
    },
  };
}

const rows = (md: string) =>
  md
    .split("\n")
    .filter((l) => l.startsWith("|") && !l.startsWith("|---"))
    .map((l) => l.slice(1, -1).split("|"));

describe("detectRulings", () => {
  // 100 dpi-ish raster (scale 1.5), white background.
  const W = 600;
  const H = 400;
  const raster = () => {
    const data = new Uint8Array(W * H).fill(255);
    const fill = (x0: number, y0: number, x1: number, y1: number, v = 0) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data[y * W + x] = v;
    };
    return { data, fill };
  };

  test("finds thin rules, bridges dropouts, ignores fills and text-like ink", () => {
    const { data, fill } = raster();
    fill(50, 50, 550, 52); // h rule, 2px
    fill(50, 150, 550, 151); // h rule, 1px ...
    fill(300, 150, 302, 151, 255); // ... with a 2px scan dropout
    fill(50, 50, 52, 300); // v rule
    fill(548, 50, 550, 300); // v rule
    fill(100, 200, 500, 260); // filled bar: too thick to be a rule
    // "text": short dark runs with gaps
    for (let x = 80; x < 500; x += 9) fill(x, 100, x + 5, 115);
    const edges = detectRulings(new PageRaster(data, W, H, 1.5));
    const h = edges.filter((e) => e.kind === "h");
    const v = edges.filter((e) => e.kind === "v");
    expect(h.map((e) => Math.round(e.y))).toEqual([34, 100]);
    expect(h.every((e) => e.x0 < 35 && e.x1 > 365)).toBe(true);
    expect(v.map((e) => Math.round(e.x)).sort((a, b) => a - b)).toEqual([34, 366]);
  });

  test("a slightly skewed rule stays one edge", () => {
    const { data, fill } = raster();
    // 500px long, drops 6px: one pixel every ~83px.
    for (let i = 0; i < 6; i++) fill(50 + i * 84, 100 + i, 50 + (i + 1) * 84, 102 + i);
    const edges = detectRulings(new PageRaster(data, W, H, 1.5));
    expect(edges.length).toBe(1);
    expect(edges[0]!.kind).toBe("h");
  });
});

test("PageRaster.crop drops empty cells and trims ruling lines", () => {
  const W = 200;
  const H = 100;
  const data = new Uint8Array(W * H).fill(255);
  // A 1pt frame around (10,10)-(190,90) at scale 1, and a glyph inside.
  for (let x = 10; x < 190; x++) data[10 * W + x] = data[89 * W + x] = 0;
  for (let y = 10; y < 90; y++) data[y * W + 10] = data[y * W + 189] = 0;
  const r = new PageRaster(data, W, H, 1);
  expect(r.crop(new Rect(10, 10, 100, 90))).toBeNull();
  for (let y = 40; y < 60; y++) for (let x = 40; x < 50; x++) data[y * W + x] = 0;
  const img = new PageRaster(data, W, H, 1).crop(new Rect(10, 10, 100, 90))!;
  expect(img).not.toBeNull();
  // No row of the crop is a leftover rule.
  for (let y = 0; y < img.height; y++) {
    let ink = 0;
    for (let x = 0; x < img.width; x++) if (img.data[y * img.width + x]! < 160) ink++;
    expect(ink).toBeLessThan(img.width / 2);
  }
  expect(Array.from(img.png().slice(1, 4))).toEqual([0x50, 0x4e, 0x47]); // "PNG"
});

test("looksBroken", () => {
  const pua = String.fromCharCode(0xe021, 0xe04e, 0xe06f);
  expect(looksBroken("")).toBe(true);
  expect(looksBroken("  ")).toBe(true);
  expect(looksBroken(pua)).toBe(true);
  expect(looksBroken("ab" + String.fromCharCode(0xfffd))).toBe(true);
  expect(looksBroken("#$%&*()!")).toBe(true);
  expect(looksBroken("North")).toBe(false);
  expect(looksBroken("Север")).toBe(false);
  expect(looksBroken("12.5%")).toBe(false);
  expect(looksBroken("—")).toBe(false);
  expect(looksBroken("(1)")).toBe(false);
});

describe("pixels strategy on a scan", () => {
  test("without OCR options nothing changes: no text, no table", async () => {
    const [page] = await toMarkdownPages(fixture("scanned-grid.pdf"));
    expect(page!.tables).toEqual([]);
    expect(page!.text.trim()).toBe("");
  });

  test("finds the grid and OCRs each cell, reporting the source", async () => {
    const ocr = fakeEngine();
    const [page] = await toMarkdownPages(fixture("scanned-grid.pdf"), {
      tableStrategy: "pixels",
      ocr,
    });
    expect(page!.tables.length).toBe(1);
    const t = page!.tables[0]!;
    expect([t.rows, t.columns]).toEqual([5, 4]);
    expect(ocr.calls.length).toBe(20);
    // Crops follow the column widths (100, 140, 100, 120 pt at 300 dpi).
    const w = ocr.calls.slice(0, 4).map((i) => i.width);
    expect(w[1]! > w[0]! && w[3]! > w[2]!).toBe(true);
    expect(t.cells.flat().every((c) => c?.source === "ocr")).toBe(true);
    expect(rows(page!.text)[1]).toEqual(["cell5", "cell6", "cell7", "cell8"]);
    // Bbox in page coordinates (grid spans x 60..520).
    expect(Math.abs(t.bbox[0] - 60)).toBeLessThan(1.5);
    expect(Math.abs(t.bbox[2] - 520)).toBeLessThan(1.5);
  });

  test("a failing engine marks cells as failed and keeps going", async () => {
    let n = 0;
    const ocr: OcrEngine = {
      async recognize() {
        n++;
        if (n % 2) throw new Error("boom");
        return "";
      },
    };
    const [page] = await toMarkdownPages(fixture("scanned-grid.pdf"), {
      tableStrategy: "pixels",
      ocr,
    });
    expect(n).toBe(20);
    expect(page!.tables[0]!.cells.flat().every((c) => c?.source === "failed")).toBe(true);
    expect(rows(page!.text)[0]).toEqual(["", "", "", ""]);
  });

  test("an engine setup error is raised, not swallowed per cell", async () => {
    const ocr: OcrEngine = {
      async recognize() {
        throw new OcrSetupError("no models");
      },
    };
    expect(
      toMarkdown(fixture("scanned-grid.pdf"), { tableStrategy: "pixels", ocr }),
    ).rejects.toThrow("no models");
  });
});

describe("textSource on a vector grid with a broken text layer", () => {
  const pua = /[\uE000-\uF8FF]/u;

  test('"pdf" (default) keeps the text layer', async () => {
    const [page] = await toMarkdownPages(fixture("broken-text-grid.pdf"));
    const t = page!.tables[0]!;
    expect(t.cells[0]!.map((c) => c!.text)).toEqual(["No", "Region", "Count", "Share"]);
    expect(pua.test(t.cells[1]![1]!.text)).toBe(true);
    expect(t.cells.flat().every((c) => c?.source === "pdf")).toBe(true);
  });

  test('"ocr" keeps the vector grid and OCRs every cell', async () => {
    const ocr = fakeEngine();
    const [page] = await toMarkdownPages(fixture("broken-text-grid.pdf"), {
      textSource: "ocr",
      ocr,
    });
    expect(ocr.calls.length).toBe(20);
    expect(page!.tables[0]!.cells.flat().every((c) => c?.source === "ocr")).toBe(true);
    expect(pua.test(page!.text)).toBe(false);
  });

  test('"auto" OCRs only the broken cells', async () => {
    const ocr = fakeEngine();
    const [page] = await toMarkdownPages(fixture("broken-text-grid.pdf"), {
      textSource: "auto",
      ocr,
    });
    expect(ocr.calls.length).toBe(16);
    const cells = page!.tables[0]!.cells;
    expect(cells[0]!.map((c) => c!.source)).toEqual(["pdf", "pdf", "pdf", "pdf"]);
    expect(
      cells
        .slice(1)
        .flat()
        .every((c) => c?.source === "ocr"),
    ).toBe(true);
    expect(rows(page!.text)[0]).toEqual(["No", "Region", "Count", "Share"]);
    expect(pua.test(page!.text)).toBe(false);
  });

  test('"auto" keeps the text-layer text of a cell whose OCR failed', async () => {
    const ocr: OcrEngine = {
      async recognize() {
        throw new Error("engine down");
      },
    };
    const [page] = await toMarkdownPages(fixture("broken-text-grid.pdf"), {
      textSource: "auto",
      ocr,
    });
    const cell = page!.tables[0]!.cells[1]![1]!;
    expect(cell.source).toBe("failed");
    expect(pua.test(cell.text)).toBe(true);
  });

  test('"auto" on a healthy document never calls OCR', async () => {
    const ocr = fakeEngine();
    const buf = fixture("merged-cells-grid.pdf");
    const md = await toMarkdown(buf, { tableStrategy: "lines", textSource: "auto", ocr });
    expect(ocr.calls.length).toBe(0);
    expect(md).toBe(await toMarkdown(buf, { tableStrategy: "lines" }));
  });
});

// Real RapidOCR (ppu-paddle-ocr + onnxruntime-node); downloads models on first run.
const testOcr = process.env.MUPDF4LLM_OCR_IT ? test : test.skip;

testOcr(
  "RapidOCR reads the scanned and the broken-text tables",
  async () => {
    const ocr = await createRapidOcr();
    try {
      const scan = await toMarkdown(fixture("scanned-grid.pdf"), { tableStrategy: "pixels", ocr });
      expect(rows(scan)).toEqual([
        ["No", "Region", "Count", "Share"],
        ["1", "North", "120", "40"],
        ["2", "South", "90", "30"],
        ["3", "East", "60", "20"],
        ["4", "West", "30", "10"],
      ]);
      const broken = await toMarkdown(fixture("broken-text-grid.pdf"), { textSource: "ocr", ocr });
      expect(rows(broken)).toEqual(rows(scan));
    } finally {
      await ocr.dispose?.();
    }
  },
  120_000,
);

const hasRapidOcr = (() => {
  try {
    Bun.resolveSync("ppu-paddle-ocr", import.meta.dir);
    return true;
  } catch {
    return false;
  }
})();

(hasRapidOcr ? test.skip : test)(
  "without the optional OCR packages the error says what to install",
  async () => {
    const buf = fixture("scanned-grid.pdf");
    expect(toMarkdown(buf, { tableStrategy: "pixels" })).rejects.toThrow(
      "npm install ppu-paddle-ocr onnxruntime-node",
    );
    // No OCR needed (no tables) → the packages are never loaded.
    expect(await toMarkdown(fixture("pdflatex-outline.pdf"), { textSource: "ocr" })).toBe(
      await toMarkdown(fixture("pdflatex-outline.pdf")),
    );
  },
);

// ---------------------------------------------------------------------------
// Real scans (public domain): tables ruled by column only, show-through,
// tinted paper. Structure is checked with a fake engine; values with the
// real one (MUPDF4LLM_OCR_IT=1).
// ---------------------------------------------------------------------------

/** [rows, columns] of each table found with `tableStrategy: "pixels"`. */
async function scanShapes(name: string): Promise<number[][]> {
  const pages = await toMarkdownPages(fixture(name), {
    tableStrategy: "pixels",
    ocr: fakeEngine(),
  });
  return pages.flatMap((p) => p.tables.map((t) => [t.rows, t.columns]));
}

describe("pixels strategy on real scans", () => {
  test("US census 1900: two tables, a row per 1900/1890 line, group headers", async () => {
    expect(await scanShapes("scan-us-census-1900.pdf")).toEqual([
      [22, 10],
      [14, 7],
    ]);
  });

  test("Russian census 1918: dense rows, values on the last line of an entry", async () => {
    // Header, entries 7-24, total.
    expect(await scanShapes("scan-ru-census-1918.pdf")).toEqual([[20, 6]]);
  });

  test("a page of prose (with show-through) has no table", async () => {
    expect(await scanShapes("scan-ru-prose-1918.pdf")).toEqual([]);
  });

  // Worse copies of the same pages. The body rows and the columns must not
  // change; the header may gain a row when one more short header rule shows.
  const variants: [string, Degradation][] = [
    ["askew 1°", { deg: 1 }],
    ["askew -1.5°", { deg: -1.5 }],
    ["specks, 150 dpi, JPEG q40", { speck: 0.004, dpi: 150, q: 40 }],
  ];
  for (const [name, d] of variants) {
    test(`degraded scans: ${name}`, async () => {
      for (const [file, expected] of [
        [
          "scan-us-census-1900.pdf",
          [
            [22, 10],
            [14, 7],
          ],
        ],
        ["scan-ru-census-1918.pdf", [[20, 6]]],
      ] as const) {
        const pages = await toMarkdownPages(degrade(fixture(file), d), {
          tableStrategy: "pixels",
          ocr: fakeEngine(),
        });
        const shapes = pages.flatMap((p) => p.tables.map((t) => [t.rows, t.columns]));
        expect(shapes.map((s) => s[1])).toEqual(expected.map((e) => e[1]));
        shapes.forEach((s, i) => {
          expect(s[0]).toBeGreaterThanOrEqual(expected[i]![0]);
          expect(s[0]).toBeLessThanOrEqual(expected[i]![0] + 1);
        });
      }
    }, 60_000);
  }

  test("a scan of a table ruled on every row keeps multi-line cells in one row", async () => {
    // Image-only copies of vector fixtures: the rows must match "lines".
    for (const file of ["white-cell-backgrounds.pdf", "merged-cells-grid.pdf"]) {
      const lines = await toMarkdownPages(fixture(file), { tableStrategy: "lines" });
      const scan = await toMarkdownPages(degrade(fixture(file), { dpi: 300, q: 90 }), {
        tableStrategy: "pixels",
        ocr: fakeEngine(),
      });
      const shape = (ps: typeof lines) =>
        ps.flatMap((p) => p.tables.map((t) => [t.rows, t.columns]));
      expect(shape(scan)).toEqual(shape(lines));
    }
  }, 60_000);

  test("pixels with the PDF text layer on a page scanned askew", async () => {
    // A searchable scan: grid and text both turned by 2.5°, the table near
    // the page corner where turning moves it most.
    const doc = new mupdf.PDFDocument();
    const font = doc.addSimpleFont(new mupdf.Font("Helvetica"));
    const a = (2.5 * Math.PI) / 180;
    const cm = `${Math.cos(a)} ${Math.sin(a)} ${-Math.sin(a)} ${Math.cos(a)} 0 0 cm`;
    const cols = [60, 160, 300, 400];
    const rowsY = [800, 776, 752, 728];
    let c = `q ${cm} 0 G 1 w\n`;
    for (const y of rowsY) c += `${cols[0]} ${y} m ${cols.at(-1)} ${y} l S\n`;
    for (const x of cols) c += `${x} ${rowsY[0]} m ${x} ${rowsY.at(-1)} l S\n`;
    const words = [
      ["Name", "Region", "Count"],
      ["North", "East", "120"],
      ["South", "West", "90"],
    ];
    words.forEach((row, r) =>
      row.forEach(
        (w, k) => (c += `BT /F1 12 Tf ${cols[k]! + 6} ${rowsY[r]! - 16} Td (${w}) Tj ET\n`),
      ),
    );
    c += "Q\n";
    doc.insertPage(-1, doc.addPage([0, 0, 595, 842], 0, doc.addObject({ Font: { F1: font } }), c));
    const buf = doc.saveToBuffer("compress").asUint8Array();
    const [page] = await toMarkdownPages(buf, { tableStrategy: "pixels", textSource: "pdf" });
    expect(page!.tables[0]!.cells.map((r) => r.map((x) => x?.text))).toEqual(words);
  });

  test("group header labels become merged cells", async () => {
    const [page] = await toMarkdownPages(fixture("scan-us-census-1900.pdf"), {
      tableStrategy: "pixels",
      ocr: fakeEngine(),
    });
    const header = page!.tables[0]!.cells[0]!;
    // "AGGREGATE." / "MALES." / "FEMALES." each span three columns.
    expect(header.map((c) => (c === null ? "-" : "x")).join("")).toBe("xx--x--x--");
  });
});

testOcr(
  "RapidOCR reads the real scans",
  async () => {
    const ocr = await createRapidOcr();
    try {
      const us = rows(
        await toMarkdown(fixture("scan-us-census-1900.pdf"), { tableStrategy: "pixels", ocr }),
      );
      expect(us).toContainEqual([
        expect.stringMatching(/New York.*1900/),
        "23.7",
        "25.3",
        "20.4",
        "27.2",
        "29.5",
        "22.3",
        "20.3",
        "21.0",
        "18.6",
      ]);
      expect(us).toContainEqual([
        expect.stringMatching(/^1890/),
        "24.0",
        "28.8",
        "16.2",
        "26.3",
        "32.1",
        "17.2",
        "21.7",
        "25.6",
        "15.2",
      ]);
      expect(us).toContainEqual([
        expect.stringMatching(/Russia and Poland/),
        "9.8",
        "9.8",
        "9.6",
        "9.4",
        "11.1",
        "10.8",
      ]);
      const ru = rows(
        await toMarkdown(fixture("scan-ru-census-1918.pdf"), { tableStrategy: "pixels", ocr }),
      );
      expect(ru).toContainEqual([
        "24",
        expect.stringMatching(/Транспорт/),
        "23951",
        "5293,10",
        "479",
        "112,6",
      ]);
      expect(ru).toContainEqual([
        "",
        expect.stringMatching(/Итого/),
        "1252468",
        "1882966,64",
        "185",
        "233,2",
      ]);
    } finally {
      await ocr.dispose?.();
    }
  },
  300_000,
);

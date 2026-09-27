import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { toMarkdown, toMarkdownPages, createRapidOcr, Rect } from "../src/index";
import type { OcrEngine, OcrImage } from "../src/index";
import { PageRaster } from "../src/helpers/ocr/engine";
import { looksBroken } from "../src/helpers/ocr/cellText";
import { OcrSetupError } from "../src/helpers/ocr/rapidOcr";
import { detectRulings } from "../src/helpers/tables/pixelGrid";

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
  const img = r.crop(new Rect(10, 10, 100, 90))!;
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

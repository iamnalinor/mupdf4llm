import { test, expect, describe, spyOn } from "bun:test";
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { toMarkdown, toMarkdownPages, createRapidOcr, OcrSetupError, Rect } from "../src/index";
import type { MarkdownOptions, OcrEngine, OcrImage, OcrResult } from "../src/index";
import { PageRaster, grayImage } from "../src/helpers/ocr/engine";
import { disposable } from "../src/helpers/ocr/rapidOcr";
import { brokenFonts, fixHomoglyphs, looksBroken } from "../src/helpers/ocr/cellText";
import type { Block, Span } from "../src/helpers/types";
import type { BBox } from "../src/helpers/geometry";
import {
  columnLean,
  detectRulings,
  findPixelGrids,
  rowBreaks,
} from "../src/helpers/tables/pixelGrid";
import { inkAxis, textPlausibility, upsideDown } from "../src/helpers/layout/scanOrientation";
import { degrade, type Degradation } from "./helpers/degrade";

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/${name}`));

/** Fake engine: answers "cell<n>" and records every image it was given. */
function fakeEngine(answer?: (n: number) => string | OcrResult): OcrEngine & { calls: OcrImage[] } {
  const calls: OcrImage[] = [];
  return {
    calls,
    async recognize(img) {
      calls.push(img);
      const a = answer ? answer(calls.length) : `cell${calls.length}`;
      return typeof a === "string" ? { text: a } : a;
    },
  };
}

/** A text block of one line and one span, each character with a font id of 0. */
function textBlock(font: string, text: string): Block {
  const chars = [...text].map((c, i) => ({
    c,
    bbox: [i * 5, 0, i * 5 + 5, 10] as BBox,
    fontId: 0,
  }));
  const span = { font, text, chars } as unknown as Span;
  return {
    type: 0,
    bbox: [0, 0, text.length * 5, 10],
    lines: [{ bbox: [0, 0, 1, 1], dir: [1, 0], wmode: 0, spans: [span] }],
  };
}

const rows = (md: string) =>
  md
    .split("\n")
    .filter((l) => l.startsWith("|") && !l.startsWith("|---"))
    .map((l) => l.slice(1, -1).split("|"));

test("await using disposes an engine made disposable, as createRapidOcr returns it", async () => {
  let disposed = 0;
  {
    await using ocr = disposable({
      recognize: async (_img: OcrImage) => ({ text: "x" }),
      dispose: async () => void disposed++,
    });
    expect(await ocr.recognize(grayImage(new Uint8Array(1).fill(255), 1, 1))).toEqual({
      text: "x",
    });
    expect(disposed).toBe(0);
  }
  expect(disposed).toBe(1);
});

describe("rowBreaks", () => {
  const line = (top: number, cols: number, run: number) => ({
    top,
    bottom: top + 5,
    cols,
    first: cols > 1,
    run,
    words: [],
  });

  test("between rules, data lines cut from one run of ink are one row", () => {
    // Values centred beside a wrapped label: the waist of the digits was
    // taken for a gap, so the value line came out as two "data lines".
    const lines = [line(0, 6, 0), line(5.5, 5, 0), line(11, 1, 1)];
    expect(rowBreaks(lines, 6, true)).toEqual([]);
  });

  test("between rules, three or more data lines set solid are separate rows", () => {
    // A waist splits one line in two; three data lines from one run are lines.
    const lines = [line(0, 6, 0), line(5.5, 6, 0), line(11, 6, 0)];
    expect(rowBreaks(lines, 6, true)).toEqual([5.25, 10.75]);
  });

  test("between rules, data lines from separate runs are separate rows", () => {
    const lines = [line(0, 6, 0), line(8, 6, 1)];
    expect(rowBreaks(lines, 6, true)).toEqual([6.5]);
  });
});

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

  test("a column rule with text pressed against both sides is kept", () => {
    const { data, fill } = raster();
    fill(299, 50, 301, 350); // v rule, 2px
    // A dense small table: lines of "glyphs" 8px tall, 4px apart, ending a
    // pixel left of the rule (right-aligned numbers) and starting a pixel
    // right of it (the next column's text).
    for (let y = 52; y < 346; y += 12) {
      fill(280, y, 298, y + 8);
      fill(302, y, 330, y + 8);
    }
    const v = detectRulings(new PageRaster(data, W, H, 1.5)).filter((e) => e.kind === "v");
    expect(v.map((e) => Math.round(e.x))).toEqual([200]);
  });

  test("a faded column rule inside a table divides it; faint strokes elsewhere do not", () => {
    const { data, fill } = raster();
    fill(50, 50, 550, 52); // h rules, dark
    fill(50, 350, 550, 352);
    fill(50, 50, 52, 352); // outer v rules, dark
    fill(548, 50, 550, 352);
    fill(299, 50, 301, 350, 205); // inner v rule, faded to light grey
    fill(420, 50, 422, 350, 205); // inner v rule, faded but for a dark piece
    fill(420, 200, 422, 260);
    fill(575, 60, 577, 390, 205); // a faint stroke outside the table
    // Dark "text" lines, 8px tall and 4px apart.
    for (let y = 56; y < 340; y += 12) fill(200, y, 290, y + 8);
    const grids = findPixelGrids(new PageRaster(data, W, H, 1.5));
    expect(grids.length).toBe(1);
    const xs = [...new Set(grids[0]!.vLines.map((v) => Math.round(v.x)))].sort((a, b) => a - b);
    expect(xs).toEqual([34, 200, 281, 366]);
    // The completed rule runs the table's height, not just its dark piece.
    const done = grids[0]!.vLines.filter((v) => Math.round(v.x) === 281);
    expect(done.reduce((n, v) => n + v.y1 - v.y0, 0)).toBeGreaterThan(190);
  });

  test("columnLean: the lean column rules share, none when they fan out", () => {
    const rules = (leans: number[]) => {
      const { data, fill } = raster();
      leans.forEach((deg, k) => {
        const t = Math.tan((deg * Math.PI) / 180);
        for (let y = 20; y < 380; y++) {
          const x = Math.round(100 + k * 150 + (y - 200) * t);
          fill(x, y, x + 2, y + 1);
        }
      });
      return new PageRaster(data, W, H, 1.5);
    };
    expect(columnLean(rules([0.6, 0.6, 0.6]))).toBeCloseTo(0.6, 1);
    expect(columnLean(rules([0.5, 0, -0.5]))).toBe(0);
    expect(columnLean(rules([0, 0, 0]))).toBeCloseTo(0, 2);
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

test("looksBroken: a stray letter of another script inside a word", () => {
  // One letter of another script inside a word: a broken text layer.
  expect(looksBroken("И" + "c" + "тория искусств")).toBe(true); // Latin c in Cyrillic
  expect(looksBroken("язы" + "k")).toBe(true); // Latin k at the end
  expect(looksBroken("Hell" + "о world")).toBe(true); // Cyrillic о in Latin
  expect(looksBroken("\u03b1\u03bb\u03c6" + "a")).toBe(true); // Latin a in Greek
  // Whole pieces in different scripts are how people write.
  expect(looksBroken("ITотдел")).toBe(false);
  expect(looksBroken("PDFфайл")).toBe(false);
  expect(looksBroken("iPhoneом")).toBe(false);
  expect(looksBroken("История искусств")).toBe(false);
  expect(looksBroken("IT-отдел")).toBe(false);
  expect(looksBroken("Wi-Fi, 5 ГГц")).toBe(false);
  expect(looksBroken("XIV гр. Обработка")).toBe(false);
  expect(looksBroken("COVID-19")).toBe(false);
  // Japanese mixes kanji and kana inside words; a capital Latin letter
  // before kana is a normal loan ("T-shirt", "X-ray").
  expect(looksBroken("\u65e5\u672c\u8a9e\u3067\u3059")).toBe(false);
  expect(looksBroken("T\u30b7\u30e3\u30c4")).toBe(false);
  expect(looksBroken("X\u7dda")).toBe(false);
  // Scripts written without spaces carry Latin words inside: "支持PDF格式",
  // "日本IBM社", "中文abc中文", "한국LG전자".
  expect(looksBroken("\u652f\u6301PDF\u683c\u5f0f")).toBe(false);
  expect(looksBroken("\u65e5\u672cIBM\u793e")).toBe(false);
  expect(looksBroken("\u4e2d\u6587abc\u4e2d\u6587")).toBe(false);
  expect(looksBroken("\ud55c\uad6dLG\uc804\uc790")).toBe(false);
  // Units and symbols: Greek mu or the micro sign, lambda.
  expect(looksBroken("\u03bcmol/L")).toBe(false);
  expect(looksBroken("\u00b5mol")).toBe(false);
  expect(looksBroken("\u03bbmax")).toBe(false);
  expect(looksBroken("Gr\u00f6\u00dfe na\u00efve")).toBe(false);
});

test("fixHomoglyphs: Latin look-alikes in Cyrillic OCR text", () => {
  expect(fixHomoglyphs("Мосkвa")).toBe("Москва");
  expect(fixHomoglyphs("Moсkвa")).toBe("Москва");
  expect(fixHomoglyphs("Kлaсс обучения")).toBe("Класс обучения");
  expect(fixHomoglyphs("Анна АHHа")).toBe("Анна Анна");
  expect(fixHomoglyphs("Николаев CaBBa Дмитриевич")).toBe("Николаев Савва Дмитриевич");
  expect(fixHomoglyphs("Poмaнoвич")).toBe("Романович");
  expect(fixHomoglyphs("г. Мосkвa\nул. Tвepскaя")).toBe("г. Москва\nул. Тверская");
  // Left alone: real Latin, words mixed on purpose, letters without a twin.
  for (const t of [
    "IT-отдел",
    "iPhone",
    "PP-OCRv5",
    "Total population",
    "CaBBa",
    "Team CaBBa",
    "Dmitrievich",
    "Archiaров",
    "ЦСУ РСФСР",
    "Москва о Москве",
    "Принтер HP",
    "Модель ABC",
    "Формат TEXT",
    "Код PC",
    "группа A",
  ])
    expect(fixHomoglyphs(t)).toBe(t);
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

  test("leaning columns on level rows are set upright: no crop takes a piece of a rule", async () => {
    const ocr = fakeEngine();
    const [page] = await toMarkdownPages(fixture("sheared-scan-grid.pdf"), {
      tableStrategy: "pixels",
      ocr,
    });
    const t = page!.tables[0]!;
    expect([t.rows, t.columns]).toEqual([40, 4]);
    // A rule piece is a pixel column of the crop that is dark most of the way down.
    const rulePiece = (img: OcrImage) => {
      for (let x = 0; x < img.width; x++) {
        let dark = 0;
        for (let y = 0; y < img.height; y++) if (img.data[y * img.width + x]! < 128) dark++;
        if (dark > 0.6 * img.height) return true;
      }
      return false;
    };
    expect(ocr.calls.filter(rulePiece).length).toBe(0);
  });

  test("auto deskews a page without a text layer, as ocr does", async () => {
    const buf = degrade(fixture("scan-ru-census-1918.pdf"), { deg: 1.5 });
    const crops = async (textSource: "auto" | "ocr") => {
      const ocr = fakeEngine();
      const pages = await toMarkdownPages(buf, { tableStrategy: "pixels", textSource, ocr });
      return {
        shapes: pages.flatMap((p) => p.tables.map((t) => [t.rows, t.columns])),
        sizes: ocr.calls.map((i) => `${i.width}x${i.height}`),
      };
    };
    expect(await crops("auto")).toEqual(await crops("ocr"));
  }, 60_000);

  test("a failing engine marks cells as failed and keeps going", async () => {
    let n = 0;
    const ocr: OcrEngine = {
      async recognize() {
        n++;
        if (n % 2) throw new Error("boom");
        return { text: "" };
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

  test('"pdf" keeps the text layer', async () => {
    const [page] = await toMarkdownPages(fixture("broken-text-grid.pdf"), { textSource: "pdf" });
    const t = page!.tables[0]!;
    expect(t.cells[0]!.map((c) => c!.text)).toEqual(["No", "Region", "Count", "Share"]);
    expect(pua.test(t.cells[1]![1]!.text)).toBe(true);
    expect(t.cells.flat().every((c) => c?.source === "pdf")).toBe(true);
  });

  test("the default is auto: only the broken cells are OCRed", async () => {
    const ocr = fakeEngine();
    const [page] = await toMarkdownPages(fixture("broken-text-grid.pdf"), { ocr });
    expect(ocr.calls.length).toBe(16);
    expect(page!.tables[0]!.cells[0]!.map((c) => c!.source)).toEqual(["pdf", "pdf", "pdf", "pdf"]);
    expect(pua.test(page!.text)).toBe(false);
  });

  test("the default auto keeps the text layer when OCR cannot be set up", async () => {
    const ocr: OcrEngine = {
      async recognize() {
        throw new OcrSetupError("no models");
      },
    };
    const [page] = await toMarkdownPages(fixture("broken-text-grid.pdf"), { ocr });
    const t = page!.tables[0]!;
    expect(t.cells[0]!.map((c) => c!.text)).toEqual(["No", "Region", "Count", "Share"]);
    expect(t.cells.flat().every((c) => c?.source === "pdf")).toBe(true);
  });

  test("the default never raises for a vector table without a text layer", async () => {
    // A ruled grid whose "text" is drawn as filled shapes (outlined glyphs).
    const doc = new mupdf.PDFDocument();
    let c = "0 G 1 w\n";
    for (let r = 0; r <= 3; r++) c += `60 ${760 - r * 24} m 360 ${760 - r * 24} l S\n`;
    for (const x of [60, 160, 260, 360]) c += `${x} 760 m ${x} 688 l S\n`;
    for (let r = 0; r < 3; r++)
      for (const x of [66, 166, 266]) c += `${x} ${744 - r * 24} 40 8 re f\n`;
    doc.insertPage(-1, doc.addPage([0, 0, 595, 842], 0, doc.addObject({}), c));
    const buf = doc.saveToBuffer("compress").asUint8Array().slice();
    const ocr: OcrEngine = {
      async recognize() {
        throw new OcrSetupError("no models");
      },
    };
    const [page] = await toMarkdownPages(buf, { ocr });
    expect(page!.tables.length).toBe(1);
  });

  test("a healthy table page is not rendered for OCR", async () => {
    const render = spyOn(PageRaster, "render");
    try {
      await toMarkdown(fixture("merged-cells-grid.pdf"), { ocr: fakeEngine() });
      expect(render).not.toHaveBeenCalled();
    } finally {
      render.mockRestore();
    }
  });

  test('an explicit "auto" raises an OCR setup error', async () => {
    const ocr: OcrEngine = {
      async recognize() {
        throw new OcrSetupError("no models");
      },
    };
    expect(
      toMarkdown(fixture("broken-text-grid.pdf"), { textSource: "auto", ocr }),
    ).rejects.toThrow("no models");
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

test("OCR text of a cell gets its look-alike letters fixed", async () => {
  const [page] = await toMarkdownPages(fixture("scanned-grid.pdf"), {
    tableStrategy: "pixels",
    ocr: fakeEngine(() => "Мосkвa"),
  });
  expect(page!.tables[0]!.cells[0]![0]!.text).toBe("Москва");
});

describe("OCR confidence", () => {
  test("a cell carries the confidence its engine gave", async () => {
    const [page] = await toMarkdownPages(fixture("scanned-grid.pdf"), {
      tableStrategy: "pixels",
      ocr: fakeEngine((n) => ({ text: `cell${n}`, confidence: n / 100 })),
    });
    const cells = page!.tables[0]!.cells.flat();
    expect(cells.every((c) => c?.source === "ocr")).toBe(true);
    expect(cells.map((c) => c!.confidence)).toEqual(cells.map((_, i) => (i + 1) / 100));
  });

  test("a cell read line by line takes its least confident line", async () => {
    // Calls alternate 0.9 and 0.3: two lines read one after the other
    // always include a 0.3.
    const [page] = await toMarkdownPages(fixture("scan-ru-census-1918.pdf"), {
      tableStrategy: "pixels",
      ocr: fakeEngine((n) => ({ text: "x", confidence: n % 2 ? 0.9 : 0.3 })),
    });
    const multi = page!.tables.flatMap((t) => t.cells.flat()).filter((c) => c?.text.includes("\n"));
    expect(multi.length).toBeGreaterThan(0);
    expect(multi.every((c) => c!.confidence === 0.3)).toBe(true);
  });

  test("no confidence from the engine, none on the cell; none on text-layer cells", async () => {
    const [page] = await toMarkdownPages(fixture("broken-text-grid.pdf"), {
      textSource: "auto",
      ocr: fakeEngine(),
    });
    const cells = page!.tables[0]!.cells.flat();
    expect(cells.some((c) => c?.source === "ocr")).toBe(true);
    expect(cells.some((c) => c?.source === "pdf")).toBe(true);
    expect(cells.every((c) => c && !("confidence" in c))).toBe(true);
  });
});

describe("auto with a font whose codes are broken", () => {
  test("every cell set in that font is OCRed, even the ones that look printable", async () => {
    const ocr = fakeEngine();
    const [page] = await toMarkdownPages(fixture("type3-no-tounicode-grid.pdf"), {
      textSource: "auto",
      ocr,
    });
    const [broken, fine] = page!.tables;
    expect(broken!.cells.flat().every((c) => c?.source === "ocr")).toBe(true);
    expect(fine!.cells.flat().every((c) => c?.source === "pdf")).toBe(true);
    expect(fine!.cells[1]!.map((c) => c!.text)).toEqual([
      "1",
      "Quartz Jumping Fox",
      "Alpha",
      "12,50",
    ]);
    expect(ocr.calls.length).toBe(20);
  });

  test("a font is broken by many distinct bad codes, however much good-looking text it has", () => {
    // Glyphs numbered in order of use: the first 31 come out as control
    // characters (tab and newline among them), the rest as printable ASCII.
    const bad = Array.from({ length: 31 }, (_, i) => String.fromCharCode(i + 1)).join("");
    const text = bad + "Q#7w)K(+b:X2!zR".repeat(60);
    expect(brokenFonts([textBlock("Type3", text)])).toEqual(new Set(["Type3#0"]));
    // One unmapped footnote mark, used a lot, does not condemn its font.
    const marks = "\uE000Region North".repeat(4) + "Count Share Total".repeat(20);
    expect(brokenFonts([textBlock("Helvetica", marks)])).toEqual(new Set());
  });

  test("a long table in such a font is OCRed as a whole", async () => {
    const ocr = fakeEngine();
    const [page] = await toMarkdownPages(fixture("type3-no-tounicode-long-grid.pdf"), {
      textSource: "auto",
      ocr,
    });
    const [broken, fine] = page!.tables;
    expect(broken!.cells.flat().every((c) => c?.source === "ocr")).toBe(true);
    expect(fine!.cells.flat().every((c) => c?.source === "pdf")).toBe(true);
    // Invisible text in that font: the page shows the cell empty.
    expect(broken!.cells[3]![3]!.text).toBe("");
  });

  test("a few bad symbols in a healthy font OCR only their own cells", async () => {
    const ocr = fakeEngine();
    const [page] = await toMarkdownPages(fixture("footnote-marks-grid.pdf"), {
      textSource: "auto",
      ocr,
    });
    const cells = page!.tables[0]!.cells;
    // "North*", "East*", "West*" hold the bad mark; the other 17 cells read fine.
    expect(ocr.calls.length).toBe(3);
    expect(cells[0]!.map((c) => c!.text)).toEqual(["No", "Region", "Count", "Share"]);
    expect(cells[2]!.map((c) => c!.source)).toEqual(["pdf", "pdf", "pdf", "pdf"]);
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

describe("pixels: a label row across all columns", () => {
  const label = "Section B: placeholder heading across columns";
  const labelRow = (tables: { cells: ({ text: string } | null)[][] }[]) =>
    tables[0]!.cells.find((r) => r.some((c) => c?.text.includes("Section")))!;

  test("on a vector page it is one merged cell", async () => {
    const [page] = await toMarkdownPages(fixture("merged-row-grid.pdf"), {
      tableStrategy: "pixels",
      textSource: "pdf",
    });
    const row = labelRow(page!.tables);
    expect(row[0]!.text).toBe(label);
    expect(row.slice(1).every((c) => c === null)).toBe(true);
    expect(page!.text).toContain(`|${label}|`);
  });

  test("body rows without rules of their own stay split on a real scan", async () => {
    // Column rules are faint in places; no data row may merge across them.
    const [page] = await toMarkdownPages(fixture("scan-gb-abstract-1908-table.pdf"), {
      tableStrategy: "pixels",
      ocr: fakeEngine(),
    });
    const t = page!.tables[0]!;
    // Only the label of the second part of the table (row 26) spans columns.
    const merged = t.cells
      .map((r, i) => (i > 2 && r.filter((c) => c === null).length > 1 ? i : -1))
      .filter((i) => i >= 0);
    expect(merged).toEqual([26]);
  }, 60_000);

  test("on a scan it is one merged cell", async () => {
    const [page] = await toMarkdownPages(degrade(fixture("merged-row-grid.pdf"), {}), {
      tableStrategy: "pixels",
      ocr: fakeEngine(),
    });
    // Header, four rows, then the label.
    const row = page!.tables[0]!.cells[5]!;
    expect(row[0]).not.toBeNull();
    expect(page!.tables[0]!.columns).toBe(5);
    expect(row.slice(1).every((c) => c === null)).toBe(true);
  }, 60_000);
});

describe("scans turned a quarter without /Rotate", () => {
  const shapes = async (buf: Uint8Array, opts: MarkdownOptions = {}) => {
    const pages = await toMarkdownPages(buf, {
      tableStrategy: "pixels",
      textSource: "pdf",
      ...opts,
    });
    return pages.flatMap((p) => p.tables.map((t) => [t.rows, t.columns]));
  };
  const raster = (buf: Uint8Array) =>
    PageRaster.render(mupdf.Document.openDocument(buf, "application/pdf").loadPage(0), 100);

  test("inkAxis tells upright pages from pages turned sideways", () => {
    for (const name of [
      "scan-ru-census-1918.pdf",
      "scan-ru-prose-1918.pdf",
      "scan-us-census-1900.pdf",
    ]) {
      expect(inkAxis(raster(degrade(fixture(name), {})))).toBe("upright");
      expect(inkAxis(raster(degrade(fixture(name), { quarter: 90 })))).toBe("sideways");
      expect(inkAxis(raster(degrade(fixture(name), { quarter: 270 })))).toBe("sideways");
    }
  }, 60_000);

  test("inkAxis is never wrong on scans fed askew, at worst unsure", () => {
    const axes = (name: string) =>
      [0, 1.5, 3, -3].map((deg) => inkAxis(raster(degrade(fixture(name), { deg }))));
    for (const name of [
      "scan-ru-prose-1918.pdf",
      "scan-ru-census-1918.pdf",
      "scan-us-census-1900.pdf",
    ])
      expect(axes(name)).toEqual(["upright", "upright", "upright", "upright"]);
    // A dense table of figures: its rows are nearly as close as its columns.
    expect(axes("scan-in-abstract-1901-table.pdf")).not.toContain("sideways");
    const across = axes("scan-us-abstract-1909-sideways.pdf");
    expect(across).not.toContain("upright");
    expect(across.filter((a) => a === "sideways").length).toBeGreaterThanOrEqual(3);
  }, 60_000);

  test("an upright table page is not turned", async () => {
    const buf = fixture("scan-in-abstract-1901-table.pdf");
    const on = await toMarkdown(buf, { tableStrategy: "pixels", ocr: fakeEngine() });
    const off = await toMarkdown(buf, {
      tableStrategy: "pixels",
      ocr: fakeEngine(),
      detectOrientation: false,
    });
    expect(on).toBe(off);
  }, 60_000);

  for (const quarter of [90, 270] as const) {
    test(`census 1918 turned ${quarter}° keeps its 6 columns`, async () => {
      const [t] = await shapes(degrade(fixture("scan-ru-census-1918.pdf"), { quarter }));
      expect(t![1]).toBe(6);
      expect(t![0]).toBeGreaterThanOrEqual(20);
      expect(t![0]).toBeLessThanOrEqual(21);
    }, 60_000);
  }

  test("US census 1900 turned 90° keeps its columns", async () => {
    const found = await shapes(degrade(fixture("scan-us-census-1900.pdf"), { quarter: 90 }));
    expect(found.map((t) => t[1])).toEqual([10, 7]);
  }, 60_000);

  test("textPlausibility prefers words to scattered marks", () => {
    for (const good of ["Total population 1900", "Всего по губернии", "12,50"])
      for (const bad of ["006I uoᴉʇɐlndod", "' .: ,l ı", ""])
        expect(textPlausibility(good)).toBeGreaterThan(textPlausibility(bad));
  });

  // Lines of "glyphs" heavy at the top, like capitals and ascenders; the
  // fake engine reads a crop only when its heavy side is up.
  const glyphPage = (flip: boolean) => {
    const w = 800;
    const h = 500;
    const data = new Uint8Array(w * h).fill(255);
    for (let line = 0; line < 6; line++) {
      for (let g = 0; g < 40; g++) {
        const x0 = 40 + g * 18;
        const y0 = 40 + line * 70;
        for (let y = 0; y < 16; y++)
          for (let x = 0; x < 10; x++) if (y < 5 || x < 3) data[(y0 + y) * w + x0 + x] = 0;
      }
    }
    if (flip) data.reverse();
    return new PageRaster(data, w, h, 1);
  };
  const heavyTopReader = (): OcrEngine => ({
    async recognize(img) {
      let top = 0;
      let bottom = 0;
      for (let y = 0; y < img.height; y++)
        for (let x = 0; x < img.width; x++)
          if (img.data[y * img.width + x]! < 128) y < img.height / 2 ? top++ : bottom++;
      return { text: top > bottom ? "word word word" : "' , . ı" };
    },
  });

  test("upsideDown follows the engine", async () => {
    expect(await upsideDown(glyphPage(false), heavyTopReader())).toBe(false);
    expect(await upsideDown(glyphPage(true), heavyTopReader())).toBe(true);
  });

  test("upsideDown keeps the page when the engine reads both ways alike", async () => {
    expect(
      await upsideDown(
        glyphPage(true),
        fakeEngine(() => "same text"),
      ),
    ).toBe(false);
  });

  test("with the PDF text layer as source no OCR runs to find the turn", async () => {
    const ocr = fakeEngine();
    await toMarkdown(degrade(fixture("scan-ru-census-1918.pdf"), { quarter: 90 }), {
      tableStrategy: "pixels",
      textSource: "pdf",
      ocr,
    });
    expect(ocr.calls.length).toBe(0);
  }, 60_000);

  test("a scan shown sideways by its /Rotate is turned upright without removeRotation", async () => {
    const doc = mupdf.PDFDocument.openDocument(
      fixture("scan-ru-census-1918.pdf"),
      "application/pdf",
    ) as mupdf.PDFDocument;
    (doc.loadPage(0) as mupdf.PDFPage).getObject().put("Rotate", 90);
    const buf = doc.saveToBuffer("compress").asUint8Array().slice();
    for (const removeRotation of [true, false]) {
      const [t] = await shapes(buf, { removeRotation });
      expect(t![1]).toBe(6);
    }
  }, 60_000);

  test("upright scans are not turned", async () => {
    for (const name of [
      "scan-ru-census-1918.pdf",
      "scan-ru-prose-1918.pdf",
      "scan-us-census-1900.pdf",
    ]) {
      const on = await toMarkdown(fixture(name), { tableStrategy: "pixels", ocr: fakeEngine() });
      const off = await toMarkdown(fixture(name), {
        tableStrategy: "pixels",
        ocr: fakeEngine(),
        detectOrientation: false,
      });
      expect(on).toBe(off);
    }
  }, 120_000);

  test("pages with a text layer are never turned", async () => {
    for (const name of ["rotated-cropbox-table.pdf", "multicolumn.pdf"]) {
      const on = await toMarkdown(fixture(name), { tableStrategy: "pixels", ocr: fakeEngine() });
      const off = await toMarkdown(fixture(name), {
        tableStrategy: "pixels",
        ocr: fakeEngine(),
        detectOrientation: false,
      });
      expect(on).toBe(off);
    }
  }, 60_000);
});

testOcr(
  "RapidOCR finds which way is up on a census page turned either way",
  async () => {
    const ocr = await createRapidOcr();
    try {
      const cells = async (buf: Uint8Array) =>
        rows(await toMarkdown(buf, { tableStrategy: "pixels", ocr })).flat();
      const upright = await cells(degrade(fixture("scan-ru-census-1918.pdf"), {}));
      for (const quarter of [90, 270] as const) {
        // Read upside down, hardly a cell would match.
        const turned = await cells(degrade(fixture("scan-ru-census-1918.pdf"), { quarter }));
        const same = turned.filter((v, i) => v.trim() && v === upright[i]).length;
        expect(same).toBeGreaterThanOrEqual(0.6 * upright.filter((v) => v.trim()).length);
      }
    } finally {
      await ocr.dispose?.();
    }
  },
  600_000,
);

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
    const buf = doc.saveToBuffer("compress").asUint8Array().slice();
    const [page] = await toMarkdownPages(buf, { tableStrategy: "pixels", textSource: "pdf" });
    expect(page!.tables[0]!.cells.map((r) => r.map((x) => x?.text))).toEqual(words);
  });

  /** A one-page PDF drawn with Helvetica as F1. */
  const drawn = (content: string) => {
    const doc = new mupdf.PDFDocument();
    const font = doc.addSimpleFont(new mupdf.Font("Helvetica"));
    const res = doc.addObject({ Font: { F1: font } });
    doc.insertPage(-1, doc.addPage([0, 0, 595, 842], 0, res, content));
    return doc.saveToBuffer("compress").asUint8Array().slice();
  };
  const text = (x: number, y: number, s: string) => `BT /F1 9 Tf ${x} ${y} Td (${s}) Tj ET\n`;

  test("group labels told apart by shading, not by a rule, stay separate", async () => {
    // Two groups of three columns; the second group is shaded grey and no
    // rule separates the groups in the group-label row.
    const cols = [60, 150, 200, 250, 300, 350, 400, 450];
    let c = "0.85 g 300 700 150 40 re f 0 g\n0 G 0.8 w\n";
    for (const y of [740, 720, 700, 680, 660]) c += `${cols[0]} ${y} m 450 ${y} l S\n`;
    for (const x of [60, 150, 450]) c += `${x} 740 m ${x} 660 l S\n`;
    for (const x of [200, 250, 300, 350, 400]) c += `${x} 720 m ${x} 660 l S\n`;
    c += text(190, 727, "Group one") + text(340, 727, "Group two") + text(64, 707, "Name");
    for (let k = 1; k < 7; k++) c += text(cols[k]! + 6, 707, `c${k}`);
    for (const [y, lab] of [
      [687, "Row a"],
      [667, "Row b"],
    ] as const) {
      c += text(64, y, lab);
      for (let k = 1; k < 7; k++) c += text(cols[k]! + 6, y, String(k));
    }
    const [page] = await toMarkdownPages(degrade(drawn(c), { dpi: 300, q: 90 }), {
      tableStrategy: "pixels",
      ocr: fakeEngine(),
    });
    const header = page!.tables[0]!.cells[0]!;
    expect(header.map((x) => (x === null ? "-" : "x")).join("")).toBe("xx--x--");
  }, 60_000);

  test("the engine is called one request at a time", async () => {
    // Multi-line cells trigger the per-line fallback (one line read of two).
    let running = 0;
    let most = 0;
    const ocr: OcrEngine = {
      async recognize() {
        most = Math.max(most, ++running);
        await new Promise((r) => setTimeout(r, 1));
        running--;
        return { text: "a" };
      },
    };
    await toMarkdown(fixture("scan-ru-census-1918.pdf"), { tableStrategy: "pixels", ocr });
    expect(most).toBe(1);
  }, 60_000);

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
    // Released at the end of the test through Symbol.asyncDispose.
    await using ocr = await createRapidOcr();
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
  },
  300_000,
);

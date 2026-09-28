/**
 * Generates the synthetic table fixtures in tests/fixtures/. Each file
 * reproduces one way PDF producers encode a table grid that the "lines"
 * strategy used to miss. Content is neutral placeholder text.
 *
 *   bun scripts/make-table-fixtures.ts [generatorName ...]
 */
import { writeFileSync } from "node:fs";
import * as mupdf from "mupdf";

const OUT = "tests/fixtures";
const W = 595;
const H = 842;

type Page = { content: string };

function save(name: string, pages: Page[]) {
  const doc = new mupdf.PDFDocument();
  const font = doc.addSimpleFont(new mupdf.Font("Helvetica"));
  const resources = doc.addObject({ Font: { F1: font } });
  for (const p of pages) {
    doc.insertPage(-1, doc.addPage([0, 0, W, H], 0, resources, p.content));
  }
  writeFileSync(`${OUT}/${name}`, doc.saveToBuffer("compress").asUint8Array());
  console.log(`wrote ${OUT}/${name}`);
}

/** Text drawn in page coordinates (origin bottom-left). */
function text(x: number, y: number, s: string, size = 9): string {
  return `BT /F1 ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${s}) Tj ET\n`;
}

const f = (n: number) => n.toFixed(2);

/**
 * One table continued over two pages. On each page the complete grid is a
 * single stroked path (many m/l pairs, one S) drawn under a scaled, y-flipped
 * matrix; rules extend beyond the page and are cut by a clip.
 */
function compoundStrokeGrid() {
  const S = 0.5; // local → page scale
  const X0 = 50; // page x of local x=0
  const colX = [0, 120, 560, 860, 990]; // local units
  const ROW = 40; // local row height (20pt)
  const NROWS = 50;
  const rowsOnFirst = 38;
  const header = ["No", "Name", "Region", "Score"];
  const regions = ["North", "South", "East"];
  const cell = (r: number, c: number) =>
    r === 0 ? header[c]! : [String(r), `Person ${r}`, regions[r % 3]!, String(100 - r)][c]!;

  const pages: Page[] = [];
  for (let p = 0; p < 2; p++) {
    // page y of local y=0
    const ty = p === 0 ? 800 : 800 + S * ROW * rowsOnFirst;
    let path = "";
    for (let r = 0; r <= NROWS; r++)
      path += `-1 ${r * ROW + 0.5} m ${colX.at(-1)! + 1} ${r * ROW + 0.5} l `;
    for (const x of colX) path += `${x + 0.5} 0 m ${x + 0.5} ${NROWS * ROW} l `;
    let c = `q 40 36 515 776 re W n 0 0 0 RG 1 w q ${S} 0 0 ${-S} ${X0} ${ty} cm ${path}S Q Q\n`;
    for (let r = 0; r < NROWS; r++) {
      const top = ty - S * r * ROW;
      if (top > 810 || top - S * ROW < 40) continue;
      for (let k = 0; k < 4; k++) c += text(X0 + S * colX[k]! + 3, top - 14, cell(r, k));
    }
    if (p === 1) {
      // Below the table: decorations that must not turn into tables.
      const cx = 300,
        cy = 200,
        rr = 60,
        k = 0.5523 * rr;
      c += `q 1 w ${cx + rr} ${cy} m ${cx + rr} ${cy + k} ${cx + k} ${cy + rr} ${cx} ${cy + rr} c `;
      c += `${cx - k} ${cy + rr} ${cx - rr} ${cy + k} ${cx - rr} ${cy} c `;
      c += `${cx - rr} ${cy - k} ${cx - k} ${cy - rr} ${cx} ${cy - rr} c `;
      c += `${cx + k} ${cy - rr} ${cx + rr} ${cy - k} ${cx + rr} ${cy} c S `;
      c += `80 120 m 200 300 l S Q\n`;
      c += text(270, 196, "Seal");
    }
    pages.push({ content: c });
  }
  save("compound-stroke-grid.pdf", pages);
}

/**
 * Grid drawn as ONE filled path made of many thin rectangles (no strokes),
 * plus a filled header background and a curved filled logo.
 */
function compoundFillGrid() {
  const cols = [60, 110, 300, 420, 480, 540];
  const top = 780;
  const ROW = 18;
  const NROWS = 12;
  const T = 0.6; // rule thickness
  const x0 = cols[0]!,
    x1 = cols.at(-1)!;
  const y1 = top - NROWS * ROW;
  let c = "";
  // header shading (separate, thick filled rectangle)
  c += `0.85 g ${x0} ${top - ROW} ${x1 - x0} ${ROW} re f\n`;
  // logo: filled path with curves
  c += `0.2 g 500 800 m 520 830 540 830 560 800 c 540 790 520 790 500 800 c f\n`;
  // the grid: one fill-path, many thin rectangles
  let grid = "0 g ";
  for (let r = 0; r <= NROWS; r++) grid += `${x0} ${f(top - r * ROW - T / 2)} ${x1 - x0} ${T} re `;
  for (const x of cols) grid += `${f(x - T / 2)} ${y1} ${T} ${NROWS * ROW} re `;
  c += grid + "f\n0 g\n";
  const header = ["No", "Name", "City", "Grade", "Score"];
  for (let r = 0; r < NROWS; r++) {
    const vals =
      r === 0
        ? header
        : [String(r), `Student ${r}`, `City ${r % 4}`, String(8 + (r % 4)), String(50 + r)];
    for (let k = 0; k < 5; k++) {
      if (r === 5 && k === 2) {
        // A value wrapped after a hyphen inside its cell.
        c += text(cols[k]! + 3, top - r * ROW - 8, "North-", 7);
        c += text(cols[k]! + 3, top - r * ROW - 15, "West", 7);
      } else c += text(cols[k]! + 3, top - r * ROW - 13, vals[k]!);
    }
  }
  save("compound-fill-grid.pdf", [{ content: c }]);
}

/**
 * Two-level header with merged cells:
 *   | No | Name | Scores (spans 3) | Total |
 *   |    |      | T1 | T2 | T3     |       |
 * "No", "Name" and "Total" span both header rows.
 */
function mergedCellsGrid() {
  const cols = [60, 100, 260, 320, 380, 440, 520];
  const top = 780;
  const ROW = 18;
  const NROWS = 8; // 2 header rows + 6 data rows
  const bottom = top - NROWS * ROW;
  let c = "0 G 0.8 w\n";
  const line = (ax: number, ay: number, bx: number, by: number) =>
    `${ax} ${ay} m ${bx} ${by} l S\n`;
  for (let r = 0; r <= NROWS; r++) {
    const y = top - r * ROW;
    if (r === 1)
      c += line(cols[2]!, y, cols[5]!, y); // only under "Scores"
    else c += line(cols[0]!, y, cols[6]!, y);
  }
  for (let k = 0; k < cols.length; k++) {
    const x = cols[k]!;
    if (k === 3 || k === 4)
      c += line(x, top - ROW, x, bottom); // T1|T2|T3 split below row 0
    else c += line(x, top, x, bottom);
  }
  // Labels of merged cells sit where a real layout centres them: across the
  // hidden row/column boundary.
  c += text(cols[0]! + 3, top - ROW - 4, "No");
  c += text(cols[1]! + 3, top - ROW - 4, "Name");
  c += text(cols[2]! + 50, top - 13, "Results per task");
  c += text(cols[5]! + 3, top - ROW - 4, "Total");
  c += text(cols[2]! + 3, top - ROW - 13, "T1");
  c += text(cols[3]! + 3, top - ROW - 13, "T2");
  c += text(cols[4]! + 3, top - ROW - 13, "T3");
  for (let r = 2; r < NROWS; r++) {
    const i = r - 1;
    const y = top - r * ROW - 13;
    const vals = [
      String(i),
      `Member ${i}`,
      String(i % 8),
      String((i + 3) % 8),
      String((i + 5) % 8),
    ];
    const total = String((i % 8) + ((i + 3) % 8) + ((i + 5) % 8));
    for (let k = 0; k < 5; k++) c += text(cols[k]! + 3, y, vals[k]!);
    c += text(cols[5]! + 3, y, total);
  }
  save("merged-cells-grid.pdf", [{ content: c }]);
}

/**
 * Rows shorter than the font's line box: every glyph bbox is taller than its
 * cell, so no glyph has >50% of its area inside any single cell.
 */
function tallGlyphCells() {
  const cols = [60, 110, 330, 420];
  const top = 780;
  const ROW = 6;
  const NROWS = 8;
  const bottom = top - NROWS * ROW;
  let c = "0 G 0.5 w\n";
  for (let r = 0; r <= NROWS; r++)
    c += `${cols[0]} ${top - r * ROW} m ${cols.at(-1)} ${top - r * ROW} l S\n`;
  for (const x of cols) c += `${x} ${top} m ${x} ${bottom} l S\n`;
  const header = ["No", "Name", "Score"];
  for (let r = 0; r < NROWS; r++) {
    const vals = r === 0 ? header : [String(r), `Pupil ${r}`, String(30 + r)];
    for (let k = 0; k < 3; k++) c += text(cols[k]! + 3, top - r * ROW - 5, vals[k]!, 12);
  }
  save("tall-glyph-cells.pdf", [{ content: c }]);
}

/**
 * Word-style table: every cell and every text line inside it has its own white
 * background rectangle, and the rules are separate thin black rectangles.
 */
function whiteCellBackgrounds() {
  const cols = [60, 110, 300, 400];
  const top = 780;
  const ROW = 30;
  const NROWS = 6;
  let c = "";
  const header = ["No", "Name", "Score"];
  for (let r = 0; r < NROWS; r++) {
    const y = top - (r + 1) * ROW;
    for (let k = 0; k < 3; k++) {
      const x = cols[k]!;
      const w = cols[k + 1]! - x;
      // cell background, then one background per text line spanning the cell
      c += `1 g ${x + 0.25} ${y + 0.25} ${w - 0.5} ${ROW - 0.5} re f\n`;
      c += `1 g ${x + 0.25} ${y + 15} ${w - 0.5} 14.75 re f ${x + 0.25} ${y + 0.25} ${w - 0.5} 14.75 re f\n`;
      const v = r === 0 ? header[k]! : [`${r}`, `Entrant ${r}`, `${20 + r}`][k]!;
      c += "0 g " + text(x + 5, y + 19, v);
      if (r > 0 && k === 1) c += text(x + 5, y + 4, `Surname ${r}`);
    }
  }
  for (let r = 0; r <= NROWS; r++) {
    c += `0 g ${cols[0]} ${top - r * ROW - 0.25} ${cols.at(-1)! - cols[0]!} 0.5 re f\n`;
  }
  for (const x of cols) c += `0 g ${x - 0.25} ${top - NROWS * ROW} 0.5 ${NROWS * ROW} re f\n`;
  save("white-cell-backgrounds.pdf", [{ content: c }]);
}

/**
 * Landscape table on a portrait page with /Rotate 90 and an explicit CropBox:
 * the right part of the table lies beyond x=595 once the page is derotated.
 */
function rotatedCropBox() {
  const doc = new mupdf.PDFDocument();
  const font = doc.addSimpleFont(new mupdf.Font("Helvetica"));
  const resources = doc.addObject({ Font: { F1: font } });
  // Draw in the displayed (landscape) frame, then map to the unrotated page:
  // displayed (X, Y) -> page (Y, X) for /Rotate 90 in PDF user space.
  const cols = [40, 160, 320, 480, 640, 800];
  const rowsY = [540, 520, 500, 480];
  let c = "q 0 1 1 0 0 0 cm 0 G 0.5 w\n"; // swap axes: landscape drawing
  for (const y of rowsY) c += `${cols[0]} ${y} m ${cols.at(-1)} ${y} l S\n`;
  for (const x of cols) c += `${x} ${rowsY[0]} m ${x} ${rowsY.at(-1)} l S\n`;
  c += "Q\n";
  const labels = [
    ["Key", "Alpha", "Beta", "Gamma", "Delta"],
    ["k1", "a1", "b1", "g1", "d1"],
    ["k2", "a2", "b2", "g2", "d2"],
  ];
  // text in the landscape frame: rotate so it reads left-to-right when displayed
  for (let r = 0; r < 3; r++) {
    for (let k = 0; k < 5; k++) {
      const X = cols[k]! + 5;
      const Y = rowsY[3 - r]! + 6; // first label row is displayed on top
      c += `BT /F1 9 Tf 0 1 -1 0 ${Y} ${X} Tm (${labels[r]![k]}) Tj ET\n`;
    }
  }
  const page = doc.addPage([0, 0, W, H], 90, resources, c);
  page.put("CropBox", [0, 0, W, H]);
  doc.insertPage(-1, page);
  writeFileSync(`${OUT}/rotated-cropbox-table.pdf`, doc.saveToBuffer("compress").asUint8Array());
  console.log(`wrote ${OUT}/rotated-cropbox-table.pdf`);
}

/**
 * Three variants that must keep working: white rules over a shaded block,
 * interior column rules only in the header row, and a rounded-corner border.
 * One table per page.
 */
function ruleVariants() {
  const cols = [60, 160, 300, 400];
  const top = 780;
  const ROW = 20;
  const NROWS = 4;
  const bottom = top - NROWS * ROW;
  const cells = (c: string, first: string) => {
    let t = c;
    for (let r = 0; r < NROWS; r++) {
      const vals = r === 0 ? [first, "Label", "Value"] : [`${r}`, `Item ${r}`, `${r * 10}`];
      for (let k = 0; k < 3; k++) t += text(cols[k]! + 4, top - r * ROW - 14, vals[k]!);
    }
    return t;
  };
  const hRule = (y: number) => `${cols[0]} ${y} m ${cols.at(-1)} ${y} l S\n`;
  const vRule = (x: number, y0: number, y1: number) => `${x} ${y0} m ${x} ${y1} l S\n`;

  // 1. shaded block, white 1pt grid
  let a = `0.6 g ${cols[0]} ${bottom} ${cols.at(-1)! - cols[0]!} ${NROWS * ROW} re f 1 G 1 w\n`;
  for (let r = 0; r <= NROWS; r++) a += hRule(top - r * ROW);
  for (const x of cols) a += vRule(x, top, bottom);
  a = cells(a + "0 g\n", "Shaded");

  // 2. interior column rules only in the header row
  let b = "0 G 0.5 w\n";
  for (let r = 0; r <= NROWS; r++) b += hRule(top - r * ROW);
  for (const x of cols) {
    const inner = x !== cols[0] && x !== cols.at(-1);
    b += vRule(x, top, inner ? top - ROW : bottom);
  }
  b = cells(b, "Header");

  // 3. rounded-corner outer border (one subpath with curves) + inner rules
  const [x0, x1, y0, y1, k] = [cols[0]!, cols.at(-1)!, bottom, top, 6];
  let c = "0 G 0.8 w\n";
  c += `${x0 + k} ${y1} m ${x1 - k} ${y1} l ${x1} ${y1} ${x1} ${y1} ${x1} ${y1 - k} c `;
  c += `${x1} ${y0 + k} l ${x1} ${y0} ${x1} ${y0} ${x1 - k} ${y0} c ${x0 + k} ${y0} l `;
  c += `${x0} ${y0} ${x0} ${y0} ${x0} ${y0 + k} c ${x0} ${y1 - k} l ${x0} ${y1} ${x0} ${y1} ${x0 + k} ${y1} c S\n`;
  for (let r = 1; r < NROWS; r++) c += hRule(top - r * ROW);
  for (const x of cols.slice(1, -1)) c += vRule(x, top, bottom);
  c = cells(c, "Rounded");

  save("rule-variants.pdf", [{ content: a }, { content: b }, { content: c }]);
}

/** Helvetica advance widths (1/1000 em) of digits, separators and space. */
const NUM_WIDTH: Record<string, number> = { ",": 278, ".": 278, " ": 278 };
const numWidth = (s: string, size: number) =>
  [...s].reduce((w, ch) => w + (NUM_WIDTH[ch] ?? 556), 0) * (size / 1000);

/**
 * A ruleless table whose text layer splits every visual row into several
 * parallel lines: each row is drawn as one BT..ET with every cell placed by
 * its own text matrix, so MuPDF reports one line per cell (not one line with
 * one span per cell). The header cells wrap over up to three lines and are
 * bottom-aligned, numbers are right-aligned, "grade team" is one text run
 * crossing a column boundary, and a title sits above the table.
 */
function splitLineRows() {
  const SIZE = 7;
  const top = 780;
  const cols = [52, 179, 228, 300, 350, 400, 450];
  const header = [
    ["Name"],
    ["Grade"],
    ["Team name"],
    ["Round one,", "points in", "Physics"],
    ["Round one,", "points in", "Biology"],
    ["Team", "round,", "points"],
    ["Total"],
  ];
  const data: [string, string, string, string, string, string][] = [
    ["Alice Brown", "11 North | Blue", "22,5", "24,0", "88,5", "62,40"],
    ["Bob Green", "11 North | Blue", "26,5", "10,0", "88,5", "60,40"],
    ["Carol White", "10 Tasters", "19,5", "14,0", "86,5", "58,60"],
    ["David Black", "9 Tasters", "8,0", "21,5", "86,5", "55,15"],
    ["Eve Grey", "11 Blenders", "17,0", "6,5", "71,0", "49,90"],
  ];
  const tm = (x: number, y: number) => `1 0 0 1 ${f(x)} ${f(y)} Tm`;
  let c = text(52, top, "Final results of the spring round", 9);
  // Header: one BT per column, lines bottom-aligned on the same baseline.
  const hBase = top - 40;
  header.forEach((lines, k) => {
    c += `BT /F1 ${SIZE} Tf `;
    lines.forEach(
      (s, i) => (c += `${tm(cols[k]!, hBase + (lines.length - 1 - i) * 7)} (${s}) Tj `),
    );
    c += "ET\n";
  });
  // Body: one BT per row, one Tm per cell. Numbers end 2pt before the next column.
  const ends = [...cols.slice(4), 500];
  data.forEach((row, r) => {
    const y = hBase - 12 - r * 12;
    // "grade team" is one run; the team name starts at its column.
    const grade = row[1].split(" ")[0]! + " ";
    const gx = cols[2]! - numWidth(grade, SIZE);
    c += `BT /F1 ${SIZE} Tf ${tm(cols[0]!, y)} (${row[0]}) Tj ${tm(gx, y)} (${row[1]}) Tj `;
    row.slice(2).forEach((v, i) => (c += `${tm(ends[i]! - 2 - numWidth(v, SIZE), y)} (${v}) Tj `));
    c += "ET\n";
  });
  save("split-line-rows.pdf", [{ content: c }]);
}

/** A 4x5 ruled table: header + four data rows, text in Helvetica. */
function plainGridContent(): string {
  const cols = [60, 160, 300, 400, 520];
  const top = 760;
  const ROW = 24;
  const rows = [
    ["No", "Region", "Count", "Share"],
    ["1", "North", "120", "40"],
    ["2", "South", "90", "30"],
    ["3", "East", "60", "20"],
    ["4", "West", "30", "10"],
  ];
  let c = "0 G 1 w\n";
  for (let r = 0; r <= rows.length; r++)
    c += `${cols[0]} ${top - r * ROW} m ${cols.at(-1)} ${top - r * ROW} l S\n`;
  for (const x of cols) c += `${x} ${top} m ${x} ${top - rows.length * ROW} l S\n`;
  rows.forEach((row, r) =>
    row.forEach((v, k) => (c += text(cols[k]! + 6, top - r * ROW - 16, v, 12))),
  );
  return c;
}

/**
 * A scanned page: the table exists only as pixels of one full-page image,
 * with no text layer and no vector graphics.
 */
function scannedGrid() {
  const src = new mupdf.PDFDocument();
  const font = src.addSimpleFont(new mupdf.Font("Helvetica"));
  const res = src.addObject({ Font: { F1: font } });
  src.insertPage(-1, src.addPage([0, 0, W, H], 0, res, plainGridContent()));
  const DPI = 150;
  const pix = src
    .loadPage(0)
    .toPixmap(mupdf.Matrix.scale(DPI / 72, DPI / 72), mupdf.ColorSpace.DeviceGray, false);

  const doc = new mupdf.PDFDocument();
  const img = doc.addImage(new mupdf.Image(pix));
  const resources = doc.addObject({ XObject: { Im0: img } });
  doc.insertPage(-1, doc.addPage([0, 0, W, H], 0, resources, `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q\n`));
  writeFileSync(`${OUT}/scanned-grid.pdf`, doc.saveToBuffer("compress").asUint8Array());
  console.log(`wrote ${OUT}/scanned-grid.pdf`);
}

/**
 * A scan whose rows run level but whose columns lean 0.5°: the sheet was
 * sheared, not turned, as a flatbed or a printer feeding it askew leaves
 * it. A tall table of numbers set flush right against the column rules,
 * so a crop that follows an upright rule takes a piece of the leaning one
 * or cuts off a digit.
 */
function shearedScanGrid() {
  const cols = [60, 110, 200, 260, 320];
  const top = 790;
  const ROW = 18;
  const size = 10;
  let c = "0 G 1 w\n";
  const n = 40;
  for (let r = 0; r <= n; r++)
    c += `${cols[0]} ${top - r * ROW} m ${cols.at(-1)} ${top - r * ROW} l S\n`;
  for (const x of cols) c += `${x} ${top} m ${x} ${top - n * ROW} l S\n`;
  for (let r = 0; r < n; r++) {
    const vals = [
      String(r + 1),
      String((r * 13) % 97),
      String((r * 7) % 100),
      String((r * 31) % 89),
    ];
    vals.forEach((v, k) => {
      // Helvetica digits are 0.556 em wide; set flush right, 1.5 pt off the rule.
      const x = cols[k + 1]! - 1.5 - v.length * 0.556 * size;
      c += text(x, top - r * ROW - 13, v, size);
    });
  }
  const src = new mupdf.PDFDocument();
  const font = src.addSimpleFont(new mupdf.Font("Helvetica"));
  const res = src.addObject({ Font: { F1: font } });
  src.insertPage(-1, src.addPage([0, 0, W, H], 0, res, c));
  const DPI = 200;
  const pix = src
    .loadPage(0)
    .toPixmap(mupdf.Matrix.scale(DPI / 72, DPI / 72), mupdf.ColorSpace.DeviceGray, false);

  const doc = new mupdf.PDFDocument();
  const img = doc.addImage(new mupdf.Image(pix));
  const resources = doc.addObject({ XObject: { Im0: img } });
  // x grows with the image's v (up the page): columns lean, rows stay level.
  const lean = (H * Math.tan((0.5 * Math.PI) / 180)).toFixed(3);
  const shift = (-Number(lean) / 2).toFixed(3);
  doc.insertPage(
    -1,
    doc.addPage([0, 0, W, H], 0, resources, `q ${W} 0 ${lean} ${H} ${shift} 0 cm /Im0 Do Q\n`),
  );
  writeFileSync(`${OUT}/sheared-scan-grid.pdf`, doc.saveToBuffer("compress").asUint8Array());
  console.log(`wrote ${OUT}/sheared-scan-grid.pdf`);
}

/**
 * Correct vector grid, broken text layer: the body rows use a font whose
 * ToUnicode map sends every printable code to the Private Use Area, as in
 * PDFs with a mangled font encoding. The header row is intact.
 */
function brokenTextGrid() {
  const doc = new mupdf.PDFDocument();
  const good = doc.addSimpleFont(new mupdf.Font("Helvetica"));
  const cmap =
    "/CIDInit /ProcSet findresource begin 12 dict begin begincmap " +
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def " +
    "/CMapName /Broken def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange " +
    "1 beginbfrange <21> <7E> <E021> endbfrange endcmap " +
    "CMapName currentdict /CMap defineresource pop end end";
  // A separate font dict: addSimpleFont would hand back the shared one.
  const bad = doc.addObject({
    Type: "Font",
    Subtype: "Type1",
    BaseFont: "Helvetica",
    Encoding: "WinAnsiEncoding",
    ToUnicode: doc.addStream(cmap, {}),
  });
  const resources = doc.addObject({ Font: { F1: good, F2: bad } });
  // Header lines stay on F1; the body switches to F2.
  const content = plainGridContent().replace(
    /BT \/F1 (\d+) Tf ([\d.]+) ([\d.]+) Td/g,
    (m, size, x, y) => (Number(y) < 740 ? `BT /F2 ${size} Tf ${x} ${y} Td` : m),
  );
  doc.insertPage(-1, doc.addPage([0, 0, W, H], 0, resources, content));
  writeFileSync(`${OUT}/broken-text-grid.pdf`, doc.saveToBuffer("compress").asUint8Array());
  console.log(`wrote ${OUT}/broken-text-grid.pdf`);
}

/**
 * Two tables on one page. The first is set in a Type3 font without a
 * ToUnicode map whose glyphs are numbered in order of first use (1, 2, 3,
 * ...), as some PDF printers embed fonts: the text layer holds the glyph
 * numbers. The heading above the table uses up the first 31 glyphs, which
 * come out as control characters; every cell of the table is printable
 * ASCII gibberish. The second table is in Helvetica and reads fine.
 */
function type3NoUnicodeGrid() {
  const rows = [
    ["Code", "Placeholder name", "Group", "Points"],
    ["1", "Quartz Jumping Fox", "Alpha", "12,50"],
    ["2", "Brisk Violet Wyvern", "Delta", "87,25"],
    ["3", "Hazy Mellow Kite", "Sigma", "40,75"],
    ["4", "Oblique Pixel Dune", "Omega", "63,00"],
  ];
  type3Grid("type3-no-tounicode-grid.pdf", rows, rows, 24, 11, 560);
}

/**
 * The same font on a long table: the glyphs that come out as control
 * characters are under 5% of its text, the rest is printable gibberish.
 * The last cell of row 3 is invisible text (render mode 3): the page shows
 * it empty.
 */
function type3NoUnicodeLongGrid() {
  const names = [
    "Quartz Jumping Fox",
    "Brisk Violet Wyvern",
    "Hazy Mellow Kite",
    "Oblique Pixel Dune",
  ];
  const groups = ["Alpha", "Delta", "Sigma", "Omega"];
  const rows = [["Code", "Placeholder name", "Group", "Points"]];
  for (let i = 1; i <= 36; i++)
    rows.push([
      String(i),
      names[i % 4]!,
      groups[(i >> 2) % 4]!,
      `${(i * 37) % 100},${(i * 13) % 100}`,
    ]);
  type3Grid("type3-no-tounicode-long-grid.pdf", rows, rows.slice(0, 5), 14, 9, 200, [3, 3]);
}

/**
 * Two tables on one page: `rows` in the Type3 font, `plain` in Helvetica
 * at `second` (its top), and a heading in the Type3 font that uses up the first glyphs.
 */
function type3Grid(
  file: string,
  rows: string[][],
  plain: string[][],
  ROW: number,
  size: number,
  second: number,
  hidden?: [number, number],
) {
  const doc = new mupdf.PDFDocument();
  const good = doc.addSimpleFont(new mupdf.Font("Helvetica"));
  const heading = "#$%&*+-/:;<=>?@[]^_{|}~!EILNRTUXYZ";
  // Glyph numbers by first use; each glyph is drawn as a plain bar.
  const codes = new Map<string, number>();
  for (const ch of heading + rows.flat().join(""))
    if (!codes.has(ch)) codes.set(ch, codes.size + 1);
  const procs = doc.newDictionary();
  const diffs = doc.newArray();
  diffs.push(doc.newInteger(1));
  for (const [ch, n] of codes) {
    const h = ch === " " ? 0 : /[a-z]/.test(ch) ? 500 : 700;
    const draw = h ? `60 0 440 ${h} re f` : "";
    procs.put(String(n), doc.addStream(`600 0 0 0 600 ${h || 1} d1 ${draw}`, {}));
    diffs.push(doc.newName(String(n)));
  }
  const n = codes.size;
  const encoding = doc.newDictionary();
  encoding.put("Type", doc.newName("Encoding"));
  encoding.put("Differences", diffs);
  const t3 = doc.addObject({
    Type: doc.newName("Font"),
    Subtype: doc.newName("Type3"),
    FontBBox: [0, 0, 600, 700],
    FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
    CharProcs: procs,
    Encoding: encoding,
    FirstChar: 1,
    LastChar: n,
    Widths: Array.from({ length: n }, () => 600),
    Resources: doc.newDictionary(),
  });
  const hex = (s: string) =>
    [...s].map((ch) => codes.get(ch)!.toString(16).padStart(2, "0")).join("");
  const cols = [60, 110, 300, 400, 520];
  const table = (top: number, font: string, body: string[][]) => {
    let c = "0 G 1 w\n";
    for (let r = 0; r <= body.length; r++)
      c += `${cols[0]} ${top - r * ROW} m ${cols.at(-1)} ${top - r * ROW} l S\n`;
    for (const x of cols) c += `${x} ${top} m ${x} ${top - body.length * ROW} l S\n`;
    body.forEach((row, r) =>
      row.forEach((v, k) => {
        const s = font === "F2" ? `<${hex(v)}>` : `(${v})`;
        const mode = font === "F2" && hidden?.[0] === r && hidden[1] === k ? "3 Tr " : "";
        c += `BT ${mode}/${font} ${size} Tf ${cols[k]! + 6} ${top - r * ROW - (ROW * 2) / 3} Td ${s} Tj ET\n`;
      }),
    );
    return c;
  };
  const resources = doc.addObject({ Font: { F1: good, F2: t3 } });
  const content =
    `BT /F2 11 Tf 60 790 Td <${hex(heading)}> Tj ET\n` +
    table(760, "F2", rows) +
    table(second, "F1", plain);
  doc.insertPage(-1, doc.addPage([0, 0, W, H], 0, resources, content));
  writeFileSync(`${OUT}/${file}`, doc.saveToBuffer("compress").asUint8Array());
  console.log(`wrote ${OUT}/${file}`);
}

/**
 * A healthy font with one bad entry: its ToUnicode map sends only the
 * footnote mark "*" to the Private Use Area, as fonts often do for a symbol
 * or two. The rest of its text, in the table and in the footnote, is fine.
 */
function footnoteMarksGrid() {
  const doc = new mupdf.PDFDocument();
  const cmap =
    "/CIDInit /ProcSet findresource begin 12 dict begin begincmap " +
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def " +
    "/CMapName /Marks def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange " +
    "3 beginbfrange <20> <29> <0020> <2A> <2A> <E000> <2B> <7E> <002B> endbfrange endcmap " +
    "CMapName currentdict /CMap defineresource pop end end";
  const font = doc.addObject({
    Type: "Font",
    Subtype: "Type1",
    BaseFont: "Helvetica",
    Encoding: "WinAnsiEncoding",
    ToUnicode: doc.addStream(cmap, {}),
  });
  const resources = doc.addObject({ Font: { F1: font } });
  const content =
    plainGridContent()
      .replace("(North)", "(North*)")
      .replace("(East)", "(East*)")
      .replace("(West)", "(West*)") +
    text(60, 620, "* Placeholder footnote: the marked regions were counted twice.", 10);
  doc.insertPage(-1, doc.addPage([0, 0, W, H], 0, resources, content));
  writeFileSync(`${OUT}/footnote-marks-grid.pdf`, doc.saveToBuffer("compress").asUint8Array());
  console.log(`wrote ${OUT}/footnote-marks-grid.pdf`);
}

/**
 * A table whose rows are all ruled, with a section label on a row of its
 * own that spans the whole width: the column rules stop above and below it.
 * The label row is barely taller than the text, so the rules on either side
 * nearly meet across it.
 */
function mergedRowGrid() {
  const cols = [50, 90, 200, 330, 450, 545];
  const header = ["No", "Name", "Region", "Group", "Points"];
  const body = (n: number) => [
    String(n),
    `Person ${n}`,
    ["North", "South"][n % 2]!,
    "A",
    String(90 - n),
  ];
  type Row = { h: number; cells?: string[]; label?: string };
  const rows: Row[] = [{ h: 18, cells: header }];
  for (let n = 1; n <= 4; n++) rows.push({ h: 18, cells: body(n) });
  rows.push({ h: 12, label: "Section B: placeholder heading across columns" });
  for (let n = 5; n <= 8; n++) rows.push({ h: 18, cells: body(n) });

  let c = "0 G 0.8 w\n";
  let y = 780;
  const x0 = cols[0]!;
  const x1 = cols.at(-1)!;
  c += `${x0} ${y} m ${x1} ${y} l S\n`;
  for (const row of rows) {
    const y1 = y - row.h;
    c += `${x0} ${y1} m ${x1} ${y1} l S\n`;
    c += `${x0} ${y} m ${x0} ${y1} l S ${x1} ${y} m ${x1} ${y1} l S\n`;
    if (row.cells) {
      for (const x of cols.slice(1, -1)) c += `${x} ${y} m ${x} ${y1} l S\n`;
      row.cells.forEach((v, k) => (c += text(cols[k]! + 4, y1 + 5, v)));
    } else c += text(210, y1 + 3, row.label!, 8);
    y = y1;
  }
  save("merged-row-grid.pdf", [{ content: c }]);
}

const all: Record<string, () => void> = {
  compoundStrokeGrid,
  compoundFillGrid,
  mergedCellsGrid,
  tallGlyphCells,
  whiteCellBackgrounds,
  rotatedCropBox,
  ruleVariants,
  splitLineRows,
  scannedGrid,
  shearedScanGrid,
  brokenTextGrid,
  type3NoUnicodeGrid,
  type3NoUnicodeLongGrid,
  footnoteMarksGrid,
  mergedRowGrid,
};
const only = process.argv.slice(2);
for (const [name, make] of Object.entries(all)) if (!only.length || only.includes(name)) make();

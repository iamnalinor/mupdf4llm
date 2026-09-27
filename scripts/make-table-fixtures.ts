/**
 * Generates the synthetic table fixtures in tests/fixtures/. Each file
 * reproduces one way PDF producers encode a table grid that the "lines"
 * strategy used to miss. Content is neutral placeholder text.
 *
 *   bun scripts/make-table-fixtures.ts
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

compoundStrokeGrid();
compoundFillGrid();
mergedCellsGrid();
tallGlyphCells();
whiteCellBackgrounds();
rotatedCropBox();
ruleVariants();

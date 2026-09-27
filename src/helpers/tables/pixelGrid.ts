import type { PageRaster } from "../ocr/engine";
import type { BBox } from "../geometry";
import type { RuledGrid } from "./tableFinder";
import type { DrawingEdge } from "../types";

/** A run of ink pixels along one pixel row (or column). */
type Run = { a: number; b: number; n: number };

/** A ruling line assembled from runs on adjacent pixel rows (or columns). */
type Rule = { a: number; b: number; ink: number; weighted: number; last: number };

/**
 * Ruling lines of a rendered page, for the `pixels` table strategy.
 *
 * Every pixel row is scanned for runs of ink at least `minLen` long; small
 * gaps (scan dropouts) are bridged. Runs on adjacent rows that overlap form
 * one rule, which lets a thick or slightly skewed line be recognised as a
 * single edge. A run must be at least 90% ink, which rejects rows through
 * text. Rules much thicker than a line (filled bars, photos) are dropped.
 * Columns are handled the same way for vertical rules.
 */
export function detectRulings(raster: PageRaster): DrawingEdge[] {
  const { width: w, height: h, scale } = raster;
  const ink = raster.ink;
  const gap = Math.max(2, Math.round(scale));
  const minLen = Math.max(12, Math.round(scale * 24));
  const maxThick = Math.max(2, scale * 4);

  const inkH = (row: number, i: number) => row >= 0 && row < h && ink[row * w + i] === 1;
  const inkV = (col: number, i: number) => col >= 0 && col < w && ink[i * w + col] === 1;
  // A rule has blank paper on at least one side. A run through a line of
  // dense text (small caps, a low-resolution scan) has ink on both.
  const clear =
    (isInk: typeof inkH) => (r: { a: number; b: number; pos: number; thick: number }) => {
      const off = Math.round(r.thick / 2 + scale * 1.5);
      const side = (line: number) => {
        let n = 0;
        for (let i = r.a; i <= r.b; i++) if (isInk(line, i)) n++;
        return n / (r.b - r.a + 1);
      };
      const p = Math.round(r.pos);
      return side(p - off) < 0.4 || side(p + off) < 0.4;
    };
  const horiz = scan(h, w, inkH, gap, minLen, maxThick).filter(clear(inkH));
  const vert = scan(w, h, inkV, gap, minLen, maxThick).filter(clear(inkV));

  const edges: DrawingEdge[] = [];
  for (const r of horiz) {
    edges.push({
      kind: "h",
      x0: raster.pageX(r.a),
      x1: raster.pageX(r.b),
      y: raster.pageY(r.pos),
      width: r.thick / scale,
    });
  }
  for (const r of vert) {
    edges.push({
      kind: "v",
      x: raster.pageX(r.pos),
      y0: raster.pageY(r.a),
      y1: raster.pageY(r.b),
      width: r.thick / scale,
    });
  }
  return edges;
}

function scan(
  nLines: number,
  lineLen: number,
  isInk: (line: number, i: number) => boolean,
  gap: number,
  minLen: number,
  maxThick: number,
): { a: number; b: number; pos: number; thick: number }[] {
  // A rule is solid ink; a row through bold text has too many gaps.
  const solid = (a: number, b: number, n: number) =>
    a >= 0 && b - a + 1 >= minLen && n >= 0.9 * (b - a + 1);
  const done: Rule[] = [];
  let active: Rule[] = [];
  for (let line = 0; line <= nLines; line++) {
    const runs: Run[] = [];
    if (line < nLines) {
      let start = -1;
      let end = -1;
      let n = 0;
      for (let i = 0; i < lineLen; i++) {
        if (!isInk(line, i)) continue;
        if (start >= 0 && i - end - 1 <= gap) {
          end = i;
          n++;
          continue;
        }
        if (solid(start, end, n)) runs.push({ a: start, b: end, n });
        start = end = i;
        n = 1;
      }
      if (solid(start, end, n)) runs.push({ a: start, b: end, n });
    }
    const next: Rule[] = [];
    for (const run of runs) {
      const hit = active.find(
        (r) => r.last === line - 1 && run.a <= r.b + gap && run.b >= r.a - gap,
      );
      if (hit) {
        hit.a = Math.min(hit.a, run.a);
        hit.b = Math.max(hit.b, run.b);
        hit.ink += run.n;
        hit.weighted += run.n * line;
        hit.last = line;
        if (!next.includes(hit)) next.push(hit);
      } else {
        next.push({ a: run.a, b: run.b, ink: run.n, weighted: run.n * line, last: line });
      }
    }
    for (const r of active) if (!next.includes(r)) done.push(r);
    active = next;
  }

  const out: { a: number; b: number; pos: number; thick: number }[] = [];
  for (const r of done) {
    const len = r.b - r.a + 1;
    // Mean ink per position along the rule: its stroke width, independent of skew.
    const thick = r.ink / len;
    if (thick > maxThick) continue;
    out.push({ a: r.a, b: r.b, pos: r.weighted / r.ink, thick });
  }
  return out;
}

/** A merged ruling line: position across, extent along. */
type Seg = { pos: number; a: number; b: number };

/** Rules this close (pt) are one line: double rules, thick rules split in two. */
const DOUBLE = 4;
/** Column rules closer than this (pt) are one column boundary. */
const MIN_COL = 8;
/** Rule pieces this close across (pt) are treated as collinear. */
const ALIGN = 5;
/** Collinear pieces of one rule interrupted by a crossing rule or a scan dropout. */
const JOIN_GAP = 12;
/** A column rule must be at least this long (pt). */
const MIN_RULE = 24;
/** Scan borders and binding shadows: rules this close to the page edge are ignored. */
const EDGE_MARGIN = 0.02;

/**
 * Tables on a rendered page (scans), as explicit grids.
 *
 * Printed tables rarely rule every row: typically column rules, a rule
 * above and below the header, and nothing between body rows. So:
 * - columns come from groups of vertical rules that overlap vertically;
 * - the table spans the horizontal rules next to that group (or, without
 *   any, the ink left and right of the outer rules);
 * - horizontal rules across most of the width are row boundaries; the part
 *   above the first one is a single header row;
 * - other rows are text lines found in the pixels. A line with ink in only
 *   one column (a wrapped label) joins the nearer neighbouring line that
 *   fills several columns.
 */
export function findPixelGrids(raster: PageRaster): RuledGrid[] {
  const page = raster.bounds;
  const mx = page.width * EDGE_MARGIN;
  const my = page.height * EDGE_MARGIN;
  const edges = detectRulings(raster);
  const vs = joinCollinear(
    edges.flatMap((e) =>
      e.kind === "v" && e.x > page.x0 + mx && e.x < page.x1 - mx
        ? [{ pos: e.x, a: e.y0, b: e.y1 }]
        : [],
    ),
  ).filter((v) => v.b - v.a >= MIN_RULE);
  const hs = rowLines(
    joinCollinear(
      edges.flatMap((e) =>
        e.kind === "h" && e.y > page.y0 + my && e.y < page.y1 - my
          ? [{ pos: e.y, a: e.x0, b: e.x1 }]
          : [],
      ),
    ),
  );

  const grids: RuledGrid[] = [];
  for (const group of groupColumns(vs)) {
    const grid = gridFor(raster, group, hs);
    if (grid) grids.push(grid);
  }
  return grids;
}

/** Merge collinear pieces (same position, small gap along). */
function joinCollinear(segs: Seg[]): Seg[] {
  const sorted = segs.slice().sort((p, q) => p.pos - q.pos || p.a - q.a);
  const lines: Seg[][] = [];
  for (const s of sorted) {
    // Pieces of one printed rule can be offset by a few points (a column
    // rule in the header and in the body).
    const line = lines.find((l) => Math.abs(l[0]!.pos - s.pos) <= ALIGN);
    if (line) line.push(s);
    else lines.push([s]);
  }
  const out: Seg[] = [];
  for (const line of lines) {
    line.sort((p, q) => p.a - q.a);
    let cur = { ...line[0]! };
    for (const s of line.slice(1)) {
      if (s.a - cur.b <= JOIN_GAP) cur.b = Math.max(cur.b, s.b);
      else {
        out.push(cur);
        cur = { ...s };
      }
    }
    out.push(cur);
  }
  return out;
}

/** A horizontal rule: its pieces at one height (a faint rule breaks up). */
type HLine = { pos: number; pieces: [number, number][] };

/** Pieces of horizontal rules at the same height (within 2pt) form one line. */
function rowLines(segs: Seg[]): HLine[] {
  const out: HLine[] = [];
  for (const s of segs.slice().sort((p, q) => p.pos - q.pos)) {
    const line = out.find((l) => Math.abs(l.pos - s.pos) <= 2);
    if (line) line.pieces.push([s.a, s.b]);
    else out.push({ pos: s.pos, pieces: [[s.a, s.b]] });
  }
  for (const l of out) l.pieces.sort((p, q) => p[0] - q[0]);
  return out;
}

/** Longest gap (pt) between pieces of one broken rule. */
const PIECE_GAP = 60;

/**
 * The part of `h` that belongs with the range lo..hi: its pieces that
 * overlap the range, extended by neighbouring pieces less than PIECE_GAP
 * away. `cover` is the inked length inside lo..hi.
 */
function span(h: HLine, lo: number, hi: number): { a: number; b: number; cover: number } | null {
  const ps = h.pieces;
  const hit = ps.map((p) => p[1] >= lo && p[0] <= hi);
  const first = hit.indexOf(true);
  if (first < 0) return null;
  let i0 = first;
  let i1 = hit.lastIndexOf(true);
  while (i0 > 0 && ps[i0]![0] - ps[i0 - 1]![1] <= PIECE_GAP) i0--;
  while (i1 < ps.length - 1 && ps[i1 + 1]![0] - ps[i1]![1] <= PIECE_GAP) i1++;
  let cover = 0;
  for (const [a, b] of ps.slice(i0, i1 + 1))
    cover += Math.max(0, Math.min(b, hi) - Math.max(a, lo));
  return { a: ps[i0]![0], b: ps[i1]![1], cover };
}

/** Positions of `segs`, with rules closer than `tol` (double rules) counted once. */
function positions(segs: Seg[], tol = DOUBLE): number[] {
  const out: number[] = [];
  for (const p of segs.map((s) => s.pos).sort((a, b) => a - b)) {
    if (!out.length || p - out[out.length - 1]! > tol) out.push(p);
  }
  return out;
}

/** Vertical rules that overlap vertically for at least half the shorter one. */
function groupColumns(vs: Seg[]): Seg[][] {
  const parent = vs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < vs.length; i++) {
    for (let j = i + 1; j < vs.length; j++) {
      const p = vs[i]!;
      const q = vs[j]!;
      const overlap = Math.min(p.b, q.b) - Math.max(p.a, q.a);
      if (overlap >= 0.5 * Math.min(p.b - p.a, q.b - q.a)) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, Seg[]>();
  vs.forEach((v, i) => {
    const g = find(i);
    groups.set(g, [...(groups.get(g) ?? []), v]);
  });
  // A lone rule separates text columns; a table needs two.
  return [...groups.values()].filter((g) => positions(g, MIN_COL).length >= 2);
}

function gridFor(raster: PageRaster, group: Seg[], hs: HLine[]): RuledGrid | null {
  const cols = positions(group, MIN_COL);
  const cx0 = cols[0]!;
  const cx1 = cols[cols.length - 1]!;
  const cy0 = Math.min(...group.map((v) => v.a));
  const cy1 = Math.max(...group.map((v) => v.b));
  // Horizontal rules around the group: the table's top, header and bottom rules.
  const near: (Seg & { line: HLine })[] = [];
  for (const line of hs) {
    if (line.pos < cy0 - JOIN_GAP || line.pos > cy1 + JOIN_GAP) continue;
    const sp = span(line, cx0, cx1);
    if (sp && sp.cover >= 0.5 * (cx1 - cx0)) near.push({ pos: line.pos, a: sp.a, b: sp.b, line });
  }
  let x0 = Math.min(cx0, ...near.map((h) => h.a));
  let x1 = Math.max(cx1, ...near.map((h) => h.b));
  let y0 = Math.min(cy0, ...near.map((h) => h.pos));
  let y1 = Math.max(cy1, ...near.map((h) => h.pos));
  // Where column rules reach beyond every horizontal rule, the table goes on
  // only while at least half of them do: a single rule further on is
  // something else, such as the separator of two text columns below.
  const support = (y: number) =>
    positions(
      group.filter((v) => v.a <= y && v.b >= y),
      MIN_COL,
    ).length;
  const enough = cols.length / 2;
  const lastRule = Math.max(...near.map((h) => h.pos), -Infinity);
  const firstRule = Math.min(...near.map((h) => h.pos), Infinity);
  if (cy1 > lastRule + JOIN_GAP) {
    let y = cy1;
    while (y > cy0 && support(y) < enough) y -= 1;
    y1 = Math.max(y, lastRule);
  }
  if (cy0 < firstRule - JOIN_GAP) {
    let y = cy0;
    while (y < cy1 && support(y) < enough) y += 1;
    y0 = Math.min(y, firstRule);
  }

  // Without a rule beyond the outer column rules, the first / last column
  // reaches as far as its text.
  // Less than that is the outer rule's own ink, not a column.
  if (x0 > cx0 - DOUBLE) {
    const edge = inkEdge(raster, cx0, y0, y1, -1);
    if (cx0 - edge >= 2 * MIN_COL) x0 = edge;
  }
  if (x1 < cx1 + DOUBLE) {
    const edge = inkEdge(raster, cx1, y0, y1, 1);
    if (edge - cx1 >= 2 * MIN_COL) x1 = edge;
  }

  const vLines = [x0, ...cols.filter((x) => x - x0 > MIN_COL && x1 - x > MIN_COL), x1];
  if (vLines.length < 3) return null;

  const hardSegs = near.filter(
    // Near the top or bottom edge: the other line of a double border.
    (h) =>
      h.pos > y0 + MIN_COL &&
      h.pos < y1 - MIN_COL &&
      (span(h.line, x0, x1)?.cover ?? 0) >= 0.6 * (x1 - x0),
  );
  const hard = positions(hardSegs);
  // Inside the header, shorter rules (under a group label) separate rows too.
  const headerEnd = hard[0] ?? y1;
  const headerSegs: Seg[] = [];
  for (const line of hs) {
    if (line.pos <= y0 + MIN_COL || line.pos >= headerEnd - DOUBLE) continue;
    const sp = span(line, x0, x1);
    if (sp && sp.cover >= 2 * MIN_COL) headerSegs.push({ pos: line.pos, a: sp.a, b: sp.b });
  }
  // The part of the width a rule really covers (a header rule may leave out
  // the first column, whose label spans both header rows).
  const ruled = [...hardSegs, ...headerSegs];
  const extent = (y: number) => {
    const segs = ruled.filter((h) => Math.abs(h.pos - y) <= DOUBLE);
    if (!segs.length) return { x0, x1 };
    const a = Math.min(...segs.map((h) => h.a));
    const b = Math.max(...segs.map((h) => h.b));
    // Close to the table edge counts as reaching it.
    return { x0: a - x0 < MIN_COL ? x0 : a, x1: x1 - b < MIN_COL ? x1 : b };
  };
  const bands = [y0, ...hard, y1];
  const rows = [y0];
  for (let i = 0; i + 1 < bands.length; i++) {
    const top = bands[i]!;
    const bottom = bands[i + 1]!;
    if (bottom - top < DOUBLE) continue;
    const isHeader = i === 0 && bands.length > 2 && bottom - top < 0.5 * (y1 - y0);
    if (isHeader) rows.push(...positions(headerSegs));
    else rows.push(...rowBreaks(textLines(raster, vLines, top, bottom), vLines.length - 1));
    rows.push(bottom);
  }
  // Words over the whole table: a label may straddle a rule between rows.
  const words = textLines(raster, vLines, y0, y1).flatMap((l) => l.words);
  if (rows.length < 2) return null;
  // Real rule pieces, so that a label across a column without a rule in its
  // row (a group header) becomes one merged cell.
  const snap = (x: number) => vLines.reduce((p, q) => (Math.abs(q - x) < Math.abs(p - x) ? q : p));
  // A rule ending just short of a row boundary (below a double border) ends there.
  const toRow = (y: number) => {
    const r = rows.reduce((p, q) => (Math.abs(q - y) < Math.abs(p - y) ? q : p));
    return Math.abs(r - y) < MIN_COL ? r : y;
  };
  const inner = group
    .filter((v) => v.b > y0 && v.a < y1)
    .map((v) => ({ x: snap(v.pos), y0: toRow(Math.max(v.a, y0)), y1: toRow(Math.min(v.b, y1)) }))
    .filter((v) => v.x !== x0 && v.x !== x1);
  // In the header, a border with no rule at all in its row is inside a group
  // label ("MALES." over Total / Cities / Rural), even when the label is too
  // short to reach across it: mark it crossed so the cells merge.
  if (hard.length) {
    const headerRows = rows.filter((y) => y < headerEnd - DOUBLE);
    for (let i = 0; i < headerRows.length; i++) {
      const ra = headerRows[i]!;
      const rb = rows[rows.indexOf(ra) + 1]!;
      for (const x of vLines.slice(1, -1)) {
        const ruled = inner.some((v) => v.x === x && v.y0 < rb - DOUBLE && v.y1 > ra + DOUBLE);
        const mid = (ra + rb) / 2;
        if (!ruled) words.push([x - 2, mid - 0.5, x + 2, mid + 0.5]);
      }
    }
  }
  return {
    hLines: rows.map((y) => ({ y, ...extent(y) })),
    vLines: [{ x: x0, y0, y1 }, ...inner, { x: x1, y0, y1 }],
    words,
  };
}

/**
 * Walk from x away from the table (dir -1 left, +1 right) over the rows
 * y0..y1 and return the outermost inked column before a blank gap of
 * JOIN_GAP points.
 */
function inkEdge(raster: PageRaster, x: number, y0: number, y1: number, dir: -1 | 1): number {
  const { width: w, scale } = raster;
  const inkMap = raster.ink;
  const py0 = raster.pixelY(y0);
  const py1 = raster.pixelY(y1);
  const start = raster.pixelX(x) + dir * Math.ceil(scale * 2);
  const maxBlank = Math.round(JOIN_GAP * scale);
  // Text puts ink in a fair share of the rows; scattered specks do not.
  const need = Math.max(3, Math.round(0.01 * (py1 - py0 + 1)));
  let last = raster.pixelX(x);
  let blank = 0;
  for (let px = start; px >= 0 && px < w && blank < maxBlank; px += dir) {
    let ink = 0;
    for (let py = py0; py <= py1 && ink < need; py++) if (inkMap[py * w + px]) ink++;
    if (ink >= need) {
      last = px;
      blank = 0;
    } else blank++;
  }
  return raster.pageX(last) + dir / scale;
}

type TextLine = {
  top: number;
  bottom: number;
  /** Number of columns with ink. */
  cols: number;
  /** Ink in the first column. */
  first: boolean;
  words: BBox[];
};

/** Row boundaries (page y) inside one band of a table, from its text lines. */
function rowBreaks(lines: TextLine[], ncol: number): number[] {
  if (lines.length < 2) return [];
  const heights = lines.map((l) => l.bottom - l.top).sort((a, b) => a - b);
  const lineH = heights[heights.length >> 1]!;

  const limit = 1.2 * lineH;
  const gap = (a: TextLine[], b: TextLine[]) => b[0]!.top - a[a.length - 1]!.bottom;
  // A data line fills at least half the columns; a wrapped label may touch
  // a second column with its hyphen or leader dots.
  const need = Math.max(2, Math.ceil(ncol / 2));
  const isAnchor = (l: TextLine) => l.cols >= need;
  // Without any multi-column line, every text line is a row.
  if (!lines.some(isAnchor)) return breaksBetween(lines.map((l) => [l]));

  // Items: single anchor lines (ink in several columns) and runs of
  // one-column lines that sit close together.
  const items: { lines: TextLine[]; anchor: boolean }[] = [];
  for (const l of lines) {
    const prev = items[items.length - 1];
    if (!isAnchor(l) && prev && !prev.anchor && gap(prev.lines, [l]) <= limit) prev.lines.push(l);
    else items.push({ lines: [l], anchor: isAnchor(l) });
  }
  // A run joins the nearer neighbouring anchor, if it is close enough.
  const rows: TextLine[][] = [];
  const joined = new Map<number, TextLine[]>();
  items.forEach((it, k) => {
    if (it.anchor) {
      const row = [...it.lines];
      joined.set(k, row);
      rows.push(row);
    }
  });
  items.forEach((it, k) => {
    if (it.anchor) return;
    const prev = items[k - 1]?.anchor ? joined.get(k - 1) : undefined;
    const next = items[k + 1]?.anchor ? joined.get(k + 1) : undefined;
    const up = prev ? gap(prev, it.lines) : Infinity;
    const down = next ? gap(it.lines, next) : Infinity;
    // A run that opens with the first column (a row number) while the data
    // line below leaves it empty starts that row: values set on the last
    // line of an entry.
    if (next && it.lines[0]!.first && !next[0]!.first && down <= 2 * limit) {
      next.unshift(...it.lines);
      return;
    }
    if (Math.min(up, down) > limit) {
      // A lone mark far from any row (a speck, a pencil tick) is not a row.
      const h = it.lines[it.lines.length - 1]!.bottom - it.lines[0]!.top;
      if (h >= 0.6 * lineH) rows.push([...it.lines]);
    } else if (up <= down) prev!.push(...it.lines);
    else next!.unshift(...it.lines);
  });
  rows.sort((a, b) => a[0]!.top - b[0]!.top);
  return breaksBetween(rows);
}

/** Row boundaries halfway between consecutive rows of text lines. */
function breaksBetween(rows: TextLine[][]): number[] {
  const breaks: number[] = [];
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = rows[i]![rows[i]!.length - 1]!.bottom;
    const b = rows[i + 1]![0]!.top;
    breaks.push((a + b) / 2);
  }
  return breaks;
}

/**
 * Text lines between `top` and `bottom`: runs of pixel rows with ink, ignoring
 * the column rules. `cols` counts the columns a line has ink in.
 */
function textLines(raster: PageRaster, vLines: number[], top: number, bottom: number): TextLine[] {
  const { width: w, scale } = raster;
  const inkMap = raster.ink;
  const pad = Math.ceil(scale * 1.5);
  const colPx = vLines.map((x) => raster.pixelX(x));
  // Skip the rows next to the band's own rules.
  const py0 = raster.pixelY(top) + pad;
  const py1 = raster.pixelY(bottom) - pad;
  const px0 = colPx[0]!;
  const px1 = colPx[colPx.length - 1]!;
  if (py1 <= py0) return [];
  // Column rules are vertical ink runs taller than any glyph; they are left
  // out wherever they are (thick, skewed or offset from the column line).
  const bw = px1 - px0 + 1;
  const bh = py1 - py0 + 1;
  const rule = new Uint8Array(bw * bh);
  const tall = Math.round(scale * 12);
  const edge = Math.max(1, Math.round(scale));
  for (let x = 0; x < bw; x++) {
    let start = -1;
    for (let y = 0; y <= bh; y++) {
      const ink = y < bh && inkMap[(py0 + y) * w + px0 + x] === 1;
      if (ink && start < 0) start = y;
      if (!ink && start >= 0) {
        // Also the anti-aliased pixels next to the rule, whose own runs break up.
        if (y - start >= tall) {
          for (let k = start; k < y; k++) {
            for (let d = -edge; d <= edge; d++) {
              if (x + d >= 0 && x + d < bw) rule[k * bw + x + d] = 1;
            }
          }
        }
        start = -1;
      }
    }
  }
  // Same for horizontal rules that do not span the table (header rules).
  for (let y = 0; y < bh; y++) {
    let start = -1;
    for (let x = 0; x <= bw; x++) {
      const ink = x < bw && inkMap[(py0 + y) * w + px0 + x] === 1;
      if (ink && start < 0) start = x;
      if (!ink && start >= 0) {
        if (x - start >= tall) {
          for (let k = start; k < x; k++) {
            for (let d = -edge; d <= edge; d++) {
              if (y + d >= 0 && y + d < bh) rule[(y + d) * bw + k] = 1;
            }
          }
        }
        start = -1;
      }
    }
  }
  const ncol = colPx.length - 1;
  const inkPerRow: number[][] = [];
  // The middle of the first column, where a row number sits; its edges can
  // hold what is left of a thick border.
  const fw = colPx[1]! - colPx[0]!;
  const fa = colPx[0]! + Math.round(0.2 * fw);
  const fb = colPx[1]! - Math.round(0.2 * fw);
  const firstPerRow: number[] = [];
  for (let py = py0; py <= py1; py++) {
    let f = 0;
    for (let px = fa; px < fb; px++) {
      if (inkMap[py * w + px] && !rule[(py - py0) * bw + px - px0]) f++;
    }
    firstPerRow.push(f);
    const row = new Array<number>(ncol).fill(0);
    for (let c = 0; c < ncol; c++) {
      for (let px = colPx[c]! + 1; px < colPx[c + 1]!; px++) {
        if (inkMap[py * w + px] && !rule[(py - py0) * bw + px - px0]) row[c]!++;
      }
    }
    inkPerRow.push(row);
  }
  // Shorter than any text line: specks, stray marks.
  const minLine = Math.max(2, scale * 3.5);
  // Lines set close together are only a pixel or two apart: no bridging.
  const bridge = 0;
  const minInk = Math.max(6, scale * scale * 2);
  const rowInk = inkPerRow.map((row) => row.reduce((a, b) => a + b, 0));
  // Runs of inked pixel rows. A few specks do not make a text row.
  let spans: [number, number][] = [];
  let start = -1;
  let last = -1;
  rowInk.forEach((n, r) => {
    if (n < Math.max(3, scale)) return;
    if (start >= 0 && r - last - 1 <= bridge) {
      last = r;
      return;
    }
    if (start >= 0) spans.push([start, last]);
    start = last = r;
  });
  if (start >= 0) spans.push([start, last]);
  spans = spans.filter(([a, b]) => b - a + 1 >= minLine);
  // Lines set solid (no blank row between them) come out as one run. Cut it
  // at a clear valley of the ink profile — between the descenders of one
  // line and the ascenders of the next — when both parts are line-high.
  const split: [number, number][] = [];
  const cut = (a: number, b: number) => {
    let best = -1;
    const m = Math.ceil(minLine);
    for (let r = a + m; r <= b - m; r++) {
      if (best < 0 || rowInk[r]! < rowInk[best]!) best = r;
    }
    if (best < 0) return void split.push([a, b]);
    const above = Math.max(...rowInk.slice(a, best));
    const below = Math.max(...rowInk.slice(best + 1, b + 1));
    if (rowInk[best]! > 0.35 * Math.min(above, below)) return void split.push([a, b]);
    cut(a, best - 1);
    cut(best + 1, b);
  };
  for (const [a, b] of spans) cut(a, b);

  // Letter-spaced labels ("A G G R E G A T E") stay one word.
  const gapPx = Math.round(scale * 3.5);
  const out: TextLine[] = [];
  for (const [a, b] of split) {
    const sums = new Array<number>(ncol).fill(0);
    for (let r = a; r <= b; r++) inkPerRow[r]!.forEach((v, c) => (sums[c]! += v));
    // Show-through from the back of the page leaves a little ink in empty
    // columns; a column counts with a fair share of the line's ink.
    const most = Math.max(...sums);
    const cols = sums.filter((v) => v >= Math.max(minInk, 0.05 * most)).length;
    if (!cols) continue;
    let firstInk = 0;
    for (let r = a; r <= b; r++) firstInk += firstPerRow[r]!;
    const first = firstInk >= minInk;
    // Words: runs of inked pixel columns, split at gaps wider than gapPx.
    const words: BBox[] = [];
    let wa = -1;
    let wb = -1;
    const top = raster.pageY(py0 + a);
    const bot = raster.pageY(py0 + b);
    const flushWord = () => {
      if (wa >= 0) words.push([raster.pageX(px0 + wa), top, raster.pageX(px0 + wb), bot]);
    };
    for (let x = 0; x < bw; x++) {
      let any = false;
      let onRule = false;
      for (let r = a; r <= b; r++) {
        const i = (py0 + r) * w + px0 + x;
        if (rule[r * bw + x]) onRule = true;
        else if (inkMap[i] === 1) any = true;
      }
      // A column rule ends a word, however close the text comes to it.
      if (onRule) {
        flushWord();
        wa = -1;
        continue;
      }
      if (!any) continue;
      if (wa >= 0 && x - wb - 1 <= gapPx) wb = x;
      else {
        flushWord();
        wa = wb = x;
      }
    }
    flushWord();
    out.push({ top, bottom: bot, cols, first, words });
  }
  return out;
}

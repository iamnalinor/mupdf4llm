import { Rect, type BBox } from "../geometry";
import type { Block, TableData, DrawingEdge, DrawingPath, Span, CellStyle } from "../types";
import { areDisjoint } from "../utils";
import { FLAG_BOLD, FLAG_ITALIC, FLAG_MONOSPACED, CHAR_BOLD } from "../constants";

export type TableStrategy = "lines_strict" | "lines" | "text" | "explicit";

const TOL = 3; // snapping tolerance for line coordinates

const DEFAULT_CELL_STYLE: CellStyle = {
  bold: true,
  italic: true,
  inlineCode: true,
  lineBreak: true,
};

function uniqueSorted(vals: number[]): number[] {
  const sorted = vals.slice().sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (!out.length || v - out[out.length - 1]! > TOL) out.push(v);
  }
  return out;
}

/** Treat any path of width<=edgeMin or height<=edgeMin (or filled thin rect) as an edge. */
function pathToEdges(
  p: DrawingPath,
  edgeMin = 3,
): { kind: "h" | "v"; x0: number; y0: number; x1: number; y1: number }[] {
  const r = p.rect;
  const edges: { kind: "h" | "v"; x0: number; y0: number; x1: number; y1: number }[] = [];
  if (r.width >= edgeMin && r.height <= edgeMin) {
    const y = (r.y0 + r.y1) / 2;
    edges.push({ kind: "h", x0: r.x0, x1: r.x1, y0: y, y1: y });
  } else if (r.height >= edgeMin && r.width <= edgeMin) {
    const x = (r.x0 + r.x1) / 2;
    edges.push({ kind: "v", x0: x, x1: x, y0: r.y0, y1: r.y1 });
  } else if (p.type === "f" && r.width >= edgeMin && r.height >= edgeMin) {
    edges.push({ kind: "h", x0: r.x0, x1: r.x1, y0: r.y0, y1: r.y0 });
    edges.push({ kind: "h", x0: r.x0, x1: r.x1, y0: r.y1, y1: r.y1 });
    edges.push({ kind: "v", x0: r.x0, x1: r.x0, y0: r.y0, y1: r.y1 });
    edges.push({ kind: "v", x0: r.x1, x1: r.x1, y0: r.y0, y1: r.y1 });
  }
  return edges;
}

/** Merge collinear horizontal segments into spans. */
function mergeH(edges: { kind: "h" | "v"; x0: number; y0: number; x1: number; y1: number }[]) {
  const h = edges
    .filter((e) => e.kind === "h")
    .map((e) => ({ y: e.y0, x0: Math.min(e.x0, e.x1), x1: Math.max(e.x0, e.x1) }));
  h.sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const merged: { y: number; x0: number; x1: number }[] = [];
  for (const s of h) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.y - s.y) <= TOL && s.x0 <= last.x1 + TOL) {
      last.x1 = Math.max(last.x1, s.x1);
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
}

function mergeV(edges: { kind: "h" | "v"; x0: number; y0: number; x1: number; y1: number }[]) {
  const v = edges
    .filter((e) => e.kind === "v")
    .map((e) => ({ x: e.x0, y0: Math.min(e.y0, e.y1), y1: Math.max(e.y0, e.y1) }));
  v.sort((a, b) => a.x - b.x || a.y0 - b.y0);
  const merged: { x: number; y0: number; y1: number }[] = [];
  for (const s of v) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.x - s.x) <= TOL && s.y0 <= last.y1 + TOL) {
      last.y1 = Math.max(last.y1, s.y1);
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
}

interface ClusterCandidate {
  bbox: Rect;
  hLines: { y: number; x0: number; x1: number }[];
  vLines: { x: number; y0: number; y1: number }[];
}

/** Group horizontal+vertical lines into table-candidate clusters by bounding-box overlap. */
function clusterLines(
  hLines: { y: number; x0: number; x1: number }[],
  vLines: { x: number; y0: number; y1: number }[],
): ClusterCandidate[] {
  type Seg = { rect: Rect; isH: boolean; idx: number };
  const segs: Seg[] = [];
  hLines.forEach((h, i) =>
    segs.push({ rect: new Rect(h.x0, h.y - 1, h.x1, h.y + 1), isH: true, idx: i }),
  );
  vLines.forEach((v, i) =>
    segs.push({ rect: new Rect(v.x - 1, v.y0, v.x + 1, v.y1), isH: false, idx: i }),
  );
  if (!segs.length) return [];

  const parent = segs.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
  const union = (a: number, b: number) => {
    const ra = find(a),
      rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (segs[i]!.rect.intersects(segs[j]!.rect)) union(i, j);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < segs.length; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(i);
  }
  const out: ClusterCandidate[] = [];
  for (const ids of groups.values()) {
    if (ids.length < 4) continue; // need at least 2 horiz + 2 vert
    const h: typeof hLines = [];
    const v: typeof vLines = [];
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const i of ids) {
      const s = segs[i]!;
      if (s.isH) h.push(hLines[s.idx]!);
      else v.push(vLines[s.idx]!);
      x0 = Math.min(x0, s.rect.x0);
      y0 = Math.min(y0, s.rect.y0);
      x1 = Math.max(x1, s.rect.x1);
      y1 = Math.max(y1, s.rect.y1);
    }
    if (h.length < 2 || v.length < 2) continue;
    out.push({ bbox: new Rect(x0, y0, x1, y1), hLines: h, vLines: v });
  }
  return out;
}

function spanStyling(spans: Span[]): {
  bold: boolean;
  italic: boolean;
  mono: boolean;
} {
  if (!spans.length) return { bold: false, italic: false, mono: false };
  const bold = spans.every((s) => s.flags & FLAG_BOLD || s.char_flags & CHAR_BOLD);
  const italic = spans.every((s) => s.flags & FLAG_ITALIC);
  const mono = spans.every((s) => s.flags & FLAG_MONOSPACED);
  return { bold, italic, mono };
}

const WHITESPACE_RE = /\s/;

/**
 * Per-character cell membership: a char belongs to the cell that contains the
 * center of its bbox (half-open on the right/bottom edge, so a char is never
 * claimed by two neighbouring cells). For boxes this includes every char with
 * >50% of its area inside the cell — the upstream pymupdf/table.py rule — and
 * additionally keeps glyphs whose line box is taller than the row, which the
 * area rule dropped from every cell. Whitespace chars outside the cell degrade
 * to a single space.
 */
function charsInCell(span: Span, cell: Rect): string {
  let out = "";
  for (const ch of span.chars) {
    const cb = ch.bbox;
    const cx = (cb[0] + cb[2]) / 2;
    const cy = (cb[1] + cb[3]) / 2;
    if (cx >= cell.x0 && cx < cell.x1 && cy >= cell.y0 && cy < cell.y1) {
      out += ch.c;
    } else if (WHITESPACE_RE.test(ch.c)) {
      out += " ";
    }
  }
  return out;
}

/** Extract markdown-styled text from a rect. */
function extractCellText(
  blocks: Block[],
  cell: Rect,
  markdown: boolean,
  style: CellStyle = DEFAULT_CELL_STYLE,
): string {
  let text = "";
  for (const b of blocks) {
    if (b.type !== 0) continue;
    if (areDisjoint(b.bbox, cell)) continue;
    for (const line of b.lines) {
      if (areDisjoint(line.bbox, cell)) continue;
      if (text) text += markdown && style.lineBreak ? "<br>" : "\n";
      for (const span of line.spans) {
        if (areDisjoint(span.bbox, cell)) continue;
        let st = charsInCell(span, cell);
        if (!st) continue;
        if (st.length > 2) st = st.replace(/\s+$/, "");
        if (!markdown) {
          text += st;
          continue;
        }
        const { bold, italic, mono } = spanStyling([span]);
        let prefix = "",
          suffix = "";
        if (bold && style.bold) {
          prefix = "**" + prefix;
          suffix = "**" + suffix;
        }
        if (italic && style.italic) {
          prefix = "_" + prefix;
          suffix = "_" + suffix;
        }
        if (mono && style.inlineCode) {
          prefix = "`" + prefix;
          suffix = "`" + suffix;
        }
        if (!st.trim()) {
          text += " ";
        } else if (suffix && text.endsWith(suffix)) {
          text = text.slice(0, -suffix.length) + st + suffix;
        } else {
          text += prefix + st + suffix;
        }
      }
    }
  }
  return text.trim();
}

/** Does some line in `lines` at `pos` cover the whole span [a, b]? */
function covered(
  lines: { pos: number; lo: number; hi: number }[],
  pos: number,
  a: number,
  b: number,
) {
  return lines.some((l) => Math.abs(l.pos - pos) <= TOL && l.lo <= a + TOL && l.hi >= b - TOL);
}

/**
 * Bounding boxes of the words inside `area`. Words break at whitespace and at
 * horizontal gaps wider than a third of the font size, so text from two
 * neighbouring cells never forms one word even without a space between them.
 */
function wordBoxes(blocks: Block[], area: Rect): BBox[] {
  const out: BBox[] = [];
  for (const b of blocks) {
    if (b.type !== 0 || areDisjoint(b.bbox, area)) continue;
    for (const line of b.lines) {
      if (areDisjoint(line.bbox, area)) continue;
      for (const span of line.spans) {
        let cur: BBox | null = null;
        for (const ch of span.chars) {
          const cb = ch.bbox;
          const gap = cur ? cb[0] - cur[2] : 0;
          if (WHITESPACE_RE.test(ch.c) || (cur && gap > span.size / 3)) {
            if (cur) out.push(cur);
            cur = null;
            if (WHITESPACE_RE.test(ch.c)) continue;
          }
          cur = cur
            ? [
                Math.min(cur[0], cb[0]),
                Math.min(cur[1], cb[1]),
                Math.max(cur[2], cb[2]),
                Math.max(cur[3], cb[3]),
              ]
            : [cb[0], cb[1], cb[2], cb[3]];
        }
        if (cur) out.push(cur);
      }
    }
  }
  return out;
}

/** Minimal overhang (pt) on both sides for a word to count as crossing a boundary. */
const CROSS_MIN = 1;

/**
 * Cell grid for a table. Two neighbouring grid cells form one merged cell when
 * no ruling line separates them *and* some word crosses their common border —
 * i.e. the grid coordinate would cut through text (a header centred over
 * several columns, a label spanning two header rows). Borders without a line
 * but without crossing text (tables with column rules only in the header)
 * stay separate. A merged cell's bbox is stored at the group's top-left
 * position and the other positions are `null` (as in PyMuPDF). Groups that
 * are not rectangular fall back to plain cells.
 */
function buildCells(
  cols: number[],
  rows: number[],
  hLines: { y: number; x0: number; x1: number }[],
  vLines: { x: number; y0: number; y1: number }[],
  blocks: Block[],
): (BBox | null)[][] {
  const nr = rows.length - 1;
  const nc = cols.length - 1;
  if (nr <= 0 || nc <= 0) return [];
  const hs = hLines.map((h) => ({ pos: h.y, lo: h.x0, hi: h.x1 }));
  const vs = vLines.map((v) => ({ pos: v.x, lo: v.y0, hi: v.y1 }));
  const words = wordBoxes(blocks, new Rect(cols[0]!, rows[0]!, cols[nc]!, rows[nr]!));
  // Does a word cross the vertical border x within the band [y0, y1)?
  const crossesV = (x: number, y0: number, y1: number) =>
    words.some((w) => {
      const cy = (w[1] + w[3]) / 2;
      return cy >= y0 && cy < y1 && w[0] < x - CROSS_MIN && w[2] > x + CROSS_MIN;
    });
  // Does a word cross the horizontal border y within the band [x0, x1)?
  const crossesH = (y: number, x0: number, x1: number) =>
    words.some((w) => {
      const cx = (w[0] + w[2]) / 2;
      return cx >= x0 && cx < x1 && w[1] < y - CROSS_MIN && w[3] > y + CROSS_MIN;
    });

  const parent = Array.from({ length: nr * nc }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
  const union = (a: number, b: number) => {
    const ra = find(a),
      rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  // Walk each row (column) as runs of consecutive borders without a ruling
  // line. Such a run is one visual cell; it is merged when text crosses any
  // of its borders.
  const mergeRuns = (
    n: number,
    open: (i: number) => boolean,
    crossed: (i: number) => boolean,
    join: (i: number) => void,
  ) => {
    for (let i = 0; i < n; ) {
      if (!open(i)) {
        i++;
        continue;
      }
      let j = i;
      while (j < n && open(j)) j++;
      let hit = false;
      for (let k = i; k < j && !hit; k++) hit = crossed(k);
      if (hit) for (let k = i; k < j; k++) join(k);
      i = j;
    }
  };
  for (let r = 0; r < nr; r++) {
    // border k lies between columns k and k+1
    mergeRuns(
      nc - 1,
      (k) => !covered(vs, cols[k + 1]!, rows[r]!, rows[r + 1]!),
      (k) => crossesV(cols[k + 1]!, rows[r]!, rows[r + 1]!),
      (k) => union(r * nc + k, r * nc + k + 1),
    );
  }
  for (let c = 0; c < nc; c++) {
    // border k lies between rows k and k+1
    mergeRuns(
      nr - 1,
      (k) => !covered(hs, rows[k + 1]!, cols[c]!, cols[c + 1]!),
      (k) => crossesH(rows[k + 1]!, cols[c]!, cols[c + 1]!),
      (k) => union(k * nc + c, (k + 1) * nc + c),
    );
  }

  const groups = new Map<number, { r0: number; c0: number; r1: number; c1: number; n: number }>();
  for (let r = 0; r < nr; r++) {
    for (let c = 0; c < nc; c++) {
      const g = find(r * nc + c);
      const e = groups.get(g);
      if (!e) groups.set(g, { r0: r, c0: c, r1: r, c1: c, n: 1 });
      else {
        e.r0 = Math.min(e.r0, r);
        e.c0 = Math.min(e.c0, c);
        e.r1 = Math.max(e.r1, r);
        e.c1 = Math.max(e.c1, c);
        e.n++;
      }
    }
  }

  const cells: (BBox | null)[][] = [];
  for (let r = 0; r < nr; r++) {
    const row: (BBox | null)[] = [];
    for (let c = 0; c < nc; c++) {
      const g = groups.get(find(r * nc + c))!;
      const rectangular = g.n === (g.r1 - g.r0 + 1) * (g.c1 - g.c0 + 1);
      if (!rectangular) row.push([cols[c]!, rows[r]!, cols[c + 1]!, rows[r + 1]!]);
      else if (r === g.r0 && c === g.c0)
        row.push([cols[g.c0]!, rows[g.r0]!, cols[g.c1 + 1]!, rows[g.r1 + 1]!]);
      else row.push(null);
    }
    cells.push(row);
  }
  return cells;
}

/**
 * Join the lines of a cell into one line. A word wrapped after a hyphen
 * ("Saint-" / "Petersburg") is rejoined without the extra space.
 */
function joinCellLines(txt: string): string {
  return txt.replace(/(\p{L})-\n(?=\p{L})/gu, "$1-").replace(/\n/g, " ");
}

/** A literal `|` in cell text would split the markdown cell in two. */
function escapeMarkdownCell(txt: string): string {
  return txt.replace(/(?<!\\)\|/g, "\\|");
}

class Table implements TableData {
  bbox: BBox;
  header: { bbox: BBox; cells: (BBox | null)[]; external: boolean };
  cells: (BBox | null)[][];
  row_count: number;
  col_count: number;
  private blocks: Block[];

  constructor(blocks: Block[], cluster: ClusterCandidate) {
    const cols = uniqueSorted(cluster.vLines.map((v) => v.x));
    const rows = uniqueSorted(cluster.hLines.map((h) => h.y));
    this.col_count = Math.max(0, cols.length - 1);
    this.row_count = Math.max(0, rows.length - 1);
    this.blocks = blocks;
    this.bbox = [cluster.bbox.x0, cluster.bbox.y0, cluster.bbox.x1, cluster.bbox.y1];

    this.cells = buildCells(cols, rows, cluster.hLines, cluster.vLines, blocks);
    const headerRow = this.cells[0] ?? [];
    // First grid row; with merged cells its first/last entries may be null.
    const hasGrid = this.row_count > 0 && this.col_count > 0;
    this.header = {
      bbox: hasGrid
        ? [cols[0]!, rows[0]!, cols[cols.length - 1]!, rows[1]!]
        : [this.bbox[0], this.bbox[1], this.bbox[2], this.bbox[1]],
      cells: headerRow,
      external: false,
    };
  }

  to_markdown(_clean = true, style: CellStyle = DEFAULT_CELL_STYLE): string {
    const grid: string[][] = [];
    for (let r = 0; r < this.row_count; r++) {
      const row: string[] = [];
      // Header row (row 0) is rendered plain — matches upstream Python where
      // header.names comes from Table.extract() (plain text), only body rows
      // go through extract_cells(..., markdown=True). Newlines inside a header
      // cell are still rewritten to <br> for the markdown table layout.
      const markdown = r !== 0;
      for (let c = 0; c < this.col_count; c++) {
        const cell = this.cells[r]![c];
        const txt = cell ? extractCellText(this.blocks, Rect.from(cell), markdown, style) : "";
        // A raw newline would terminate the markdown table row, so body cells
        // get the same treatment as the header when `<br>` is disabled.
        const headerTxt = style.lineBreak ? txt.replace(/\n/g, "<br>") : joinCellLines(txt);
        row.push(escapeMarkdownCell(markdown && style.lineBreak ? txt : headerTxt));
      }
      grid.push(row);
    }
    if (!grid.length) return "";
    let out = "|" + grid[0]!.join("|") + "|\n";
    out += "|" + Array.from({ length: this.col_count }, () => "---").join("|") + "|\n";
    for (let r = 1; r < grid.length; r++) {
      out += "|" + grid[r]!.join("|") + "|\n";
    }
    return out + "\n";
  }
}

interface FindTablesOpts {
  strategy?: TableStrategy;
  /** Ruling lines recovered by `extractDrawings`, used alongside `paths`. */
  edges?: DrawingEdge[];
  explicitGrid?: { hLines: number[]; vLines: number[] }[];
}

export function findTables(
  blocks: Block[],
  paths: DrawingPath[],
  clip: Rect,
  opts: FindTablesOpts = {},
): TableData[] {
  const strategy: TableStrategy = opts.strategy ?? "lines_strict";

  if (strategy === "explicit") {
    return findTablesExplicit(blocks, opts.explicitGrid ?? []);
  }
  if (strategy === "text") {
    return findTablesByText(blocks, clip);
  }

  // "lines" / "lines_strict" — same algorithm, "lines" is more tolerant of
  // partial/short edges.
  const drawnEdges = opts.edges ?? [];
  if (!paths.length && !drawnEdges.length) return [];
  const allEdges: { kind: "h" | "v"; x0: number; y0: number; x1: number; y1: number }[] = [];
  const edgeMin = strategy === "lines" ? 2 : 3;
  for (const p of paths) {
    if (!clip.contains(p.rect) && !p.rect.intersects(clip)) continue;
    allEdges.push(...pathToEdges(p, edgeMin));
  }
  for (const e of drawnEdges) {
    if (e.kind === "h") {
      if (e.x1 - e.x0 < edgeMin || e.y < clip.y0 || e.y > clip.y1) continue;
      if (e.x1 < clip.x0 || e.x0 > clip.x1) continue;
      allEdges.push({ kind: "h", x0: e.x0, x1: e.x1, y0: e.y, y1: e.y });
    } else {
      if (e.y1 - e.y0 < edgeMin || e.x < clip.x0 || e.x > clip.x1) continue;
      if (e.y1 < clip.y0 || e.y0 > clip.y1) continue;
      allEdges.push({ kind: "v", x0: e.x, x1: e.x, y0: e.y0, y1: e.y1 });
    }
  }
  const hLines = mergeH(allEdges);
  const vLines = mergeV(allEdges);
  const clusters = clusterLines(hLines, vLines);
  const out: TableData[] = [];
  const minRows = strategy === "lines" ? 1 : 2;
  for (const cl of clusters) {
    const t = new Table(blocks, cl);
    if (t.row_count >= minRows && t.col_count >= 2) out.push(t);
  }
  out.sort((a, b) => a.bbox[0] - b.bbox[0] || a.bbox[1] - b.bbox[1]);
  if (typeof process !== "undefined" && process.env?.DEBUG_MUPDF4LLM) {
    const tabs = out.map(
      (t) => `${t.row_count}x${t.col_count}@[${t.bbox.map((v) => v.toFixed(0))}]`,
    );
    console.error(
      `[mupdf4llm] tables: paths=${paths.length} edges=${drawnEdges.length} ` +
        `hLines=${hLines.length} vLines=${vLines.length} clusters=${clusters.length} ` +
        `tables=${out.length} ${tabs.join(" ")}`,
    );
  }
  return out;
}

/** Build TableData directly from caller-supplied row/col coordinate arrays. */
function findTablesExplicit(
  blocks: Block[],
  grids: { hLines: number[]; vLines: number[] }[],
): TableData[] {
  const out: TableData[] = [];
  for (const g of grids) {
    const rows = uniqueSorted(g.hLines);
    const cols = uniqueSorted(g.vLines);
    if (rows.length < 2 || cols.length < 2) continue;
    const bbox = new Rect(cols[0]!, rows[0]!, cols[cols.length - 1]!, rows[rows.length - 1]!);
    const hLineRecs = rows.map((y) => ({
      y,
      x0: cols[0]!,
      x1: cols[cols.length - 1]!,
    }));
    const vLineRecs = cols.map((x) => ({
      x,
      y0: rows[0]!,
      y1: rows[rows.length - 1]!,
    }));
    out.push(new Table(blocks, { bbox, hLines: hLineRecs, vLines: vLineRecs }));
  }
  return out;
}

type TextRow = {
  rect: Rect;
  /** Column starts: x0 of every non-empty span, or of every run of lines. */
  xs: number[];
  /** Number of MuPDF lines the row was assembled from. */
  nLines: number;
  /** The row's text pieces: its spans, or its lines when it has several. */
  boxes: Rect[];
};

/**
 * Group the text lines inside `clip` into visual rows. Lines that share most
 * of their height and do not overlap horizontally belong to the same row, no
 * matter how MuPDF split them into blocks and lines — some producers emit one
 * line per table cell rather than one line with a span per cell.
 *
 * A row made of one line keeps a column start per span. In a row made of
 * several lines, lines closer than twice the line height form one run with a
 * single column start: MuPDF also splits running text into lines (after a
 * sentence, between two text columns), and those gaps are narrow.
 */
function textRows(blocks: Block[], clip: Rect): { rows: TextRow[]; lines: Rect[] } {
  const lines: { rect: Rect; xs: number[]; spans: Rect[] }[] = [];
  for (const b of blocks) {
    if (b.type !== 0 || areDisjoint(b.bbox, clip)) continue;
    for (const l of b.lines) {
      if (areDisjoint(l.bbox, clip)) continue;
      const spans = l.spans.filter((s) => s.text.trim()).map((s) => Rect.from(s.bbox));
      if (spans.length) lines.push({ rect: Rect.from(l.bbox), xs: spans.map((s) => s.x0), spans });
    }
  }
  lines.sort((a, b) => a.rect.y0 - b.rect.y0 || a.rect.x0 - b.rect.x0);

  const groups: { rect: Rect; members: (typeof lines)[number][] }[] = [];
  for (const l of lines) {
    const r = l.rect;
    const group = groups.find((g) => {
      const overlap = Math.min(g.rect.y1, r.y1) - Math.max(g.rect.y0, r.y0);
      if (overlap < Math.min(g.rect.height, r.height) / 2) return false;
      return g.members.every((m) => m.rect.x1 <= r.x0 + TOL || r.x1 <= m.rect.x0 + TOL);
    });
    if (group) {
      group.rect = group.rect.union(r);
      group.members.push(l);
    } else {
      groups.push({ rect: r, members: [l] });
    }
  }

  const rows: TextRow[] = groups.map((g) => {
    if (g.members.length === 1) {
      const m = g.members[0]!;
      return { rect: g.rect, xs: m.xs, nLines: 1, boxes: m.spans };
    }
    const members = g.members.sort((a, b) => a.rect.x0 - b.rect.x0);
    const xs: number[] = [];
    let prevX1 = -Infinity;
    for (const m of members) {
      if (m.rect.x0 - prevX1 >= Math.max(m.rect.height, g.rect.height) * 2) xs.push(m.rect.x0);
      prevX1 = Math.max(prevX1, m.rect.x1);
    }
    return { rect: g.rect, xs, nLines: members.length, boxes: members.map((m) => m.rect) };
  });
  rows.sort((a, b) => a.rect.y0 - b.rect.y0 || a.rect.x0 - b.rect.x0);
  return { rows, lines: lines.map((l) => l.rect) };
}

/**
 * The header directly above a table body, as one x-interval per header
 * column. Header lines are collected upwards from the body while the
 * vertical gap stays within the body's own row spacing; a label that wraps
 * over several lines joins the column it overlaps. The walk stops at a line
 * spanning two columns (a caption or a group label).
 */
function headerAbove(lines: Rect[], group: TextRow[]): { cols: Rect[]; lines: Rect[] } {
  const x0 = Math.min(...group.map((r) => r.rect.x0));
  const x1 = Math.max(...group.map((r) => r.rect.x1));
  const median = (v: number[]) => v.sort((a, b) => a - b)[v.length >> 1] ?? 0;
  const rowH = median(group.map((r) => r.rect.height));
  const gap = median(group.slice(1).map((r, i) => r.rect.y0 - group[i]!.rect.y1));
  const maxGap = Math.max(gap, 0) + rowH;
  const top = group[0]!.rect.y0;
  const candidates = lines
    .filter(
      (l) =>
        l.y1 <= top + TOL &&
        l.y0 >= top - rowH * 6 &&
        l.x0 >= x0 - rowH * 4 &&
        l.x1 <= x1 + rowH * 4,
    )
    .sort((a, b) => b.y1 - a.y1);
  const cols: Rect[] = [];
  const used: Rect[] = [];
  let edge = top;
  for (const l of candidates) {
    if (l.y1 < edge - maxGap) break;
    const hit = cols.filter((c) => c.x0 < l.x1 - TOL && l.x0 < c.x1 - TOL);
    if (hit.length > 1) break;
    if (hit.length === 1) cols[cols.indexOf(hit[0]!)] = hit[0]!.union(l);
    else cols.push(l);
    used.push(l);
    edge = Math.min(edge, l.y0);
  }
  cols.sort((a, b) => a.x0 - b.x0);
  return { cols, lines: used };
}

/**
 * Column boundaries from a header: between two neighbouring labels, the
 * boundary goes to the rightmost point of the gap that no body word crosses.
 * This keeps both left-aligned bodies (the boundary sits just before the
 * next column's text) and centred ones (cells wider than their label) intact.
 */
function headerBoundaries(cols: Rect[], words: BBox[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < cols.length; i++) {
    const lo = cols[i - 1]!.x1;
    const hi = cols[i]!.x0;
    let x = hi;
    if (lo < hi) {
      // Move left while a word straddles x.
      for (;;) {
        const w = words.find((w) => w[0] < x && w[2] > x);
        if (!w || w[0] <= lo) break;
        x = w[0];
      }
      if (words.some((w) => w[0] < x && w[2] > x)) x = hi;
    }
    out.push(x);
  }
  return out;
}

/**
 * Detect tables purely from text alignment — no ruling lines required.
 *
 * Approach: group the page's text into visual rows, cluster adjacent rows
 * that share column-start x-coordinates (within a small tolerance) into
 * table bodies, then look for a header directly above each body. When most
 * header columns receive body text, the header defines the columns (body
 * cells are often right-aligned or centred under their label, so their
 * starts do not line up); otherwise the body's column starts are used. Row
 * boundaries lie halfway between neighbouring rows.
 *
 * This is a deliberately lightweight port — `pymupdf4llm.helpers.utils`
 * does a deeper analysis. For tables with no rules it produces a usable
 * markdown grid, but column boundaries may not match PyMuPDF byte-for-byte.
 */
function findTablesByText(blocks: Block[], clip: Rect): TableData[] {
  const { rows: allRows, lines } = textRows(blocks, clip);
  // A row assembled from several lines needs a third column so that two
  // columns of prose side by side are not mistaken for a table.
  const rows = allRows.filter((r) => r.xs.length >= (r.nLines > 1 ? 3 : 2));
  if (rows.length < 2) return [];

  // Cluster adjacent rows that share at least 2 column-start x-coordinates.
  const clusters: TextRow[][] = [];
  let current: TextRow[] = [rows[0]!];
  for (let i = 1; i < rows.length; i++) {
    const prev = current[current.length - 1]!;
    const cur = rows[i]!;
    if (cur.rect.y0 - prev.rect.y1 > prev.rect.height * 2) {
      if (current.length >= 2) clusters.push(current);
      current = [cur];
      continue;
    }
    const shared = cur.xs.filter((x) => prev.xs.some((px) => Math.abs(px - x) <= TOL * 2));
    if (shared.length >= 2) {
      current.push(cur);
    } else {
      if (current.length >= 2) clusters.push(current);
      current = [cur];
    }
  }
  if (current.length >= 2) clusters.push(current);

  const out: TableData[] = [];
  for (const group of clusters) {
    // Rows assembled from separate lines are a weaker signal than spans of
    // one line: ask for a third row before calling it a table.
    if (group.length < 3 && group.some((r) => r.nLines > 1)) continue;
    const bodyCols = uniqueSorted(group.flatMap((r) => r.xs));
    if (bodyCols.length < 2) continue;
    let left = Math.min(...group.map((r) => r.rect.x0));
    let right = Math.max(...group.map((r) => r.rect.x1));
    let top = group[0]!.rect.y0;
    const rowYs: number[] = [];
    let cols = bodyCols;

    const header = headerAbove(lines, group);
    const bodyArea = new Rect(left, top, right, group[group.length - 1]!.rect.y1);
    const bounds =
      header.cols.length >= 2 ? headerBoundaries(header.cols, wordBoxes(blocks, bodyArea)) : [];
    // Accept the header when most of its columns receive body text.
    const filled = header.cols.filter((_, i) => {
      const lo = i ? bounds[i - 1]! : -Infinity;
      const hi = bounds[i] ?? Infinity;
      return group.some((r) =>
        r.boxes.some((b) => (b.x0 + b.x1) / 2 >= lo && (b.x0 + b.x1) / 2 < hi),
      );
    }).length;
    if (header.cols.length >= 2 && filled >= 2 && filled * 2 >= header.cols.length) {
      left = Math.min(left, header.cols[0]!.x0);
      right = Math.max(right, ...header.cols.map((c) => c.x1));
      cols = [left, ...bounds];
      top = Math.min(...header.lines.map((l) => l.y0));
      rowYs.push(top, (Math.max(...header.lines.map((l) => l.y1)) + group[0]!.rect.y0) / 2);
    } else {
      rowYs.push(top);
    }
    // Row boundaries halfway between neighbouring rows: no empty gap rows.
    for (let i = 1; i < group.length; i++) {
      rowYs.push((group[i - 1]!.rect.y1 + group[i]!.rect.y0) / 2);
    }
    const bottom = group[group.length - 1]!.rect.y1 + 1;
    rowYs.push(bottom);

    const allCols = [...cols, right + 1];
    const bbox = new Rect(allCols[0]!, top, right + 1, bottom);
    const hRecs = rowYs.map((y) => ({ y, x0: bbox.x0, x1: bbox.x1 }));
    const vRecs = allCols.map((x) => ({ x, y0: bbox.y0, y1: bbox.y1 }));
    const t = new Table(blocks, { bbox, hLines: hRecs, vLines: vRecs });
    if (t.row_count >= 2 && t.col_count >= 2) out.push(t);
  }
  // Rows of a wrapped header can form a small table of their own; drop any
  // table that lies inside another one.
  const inside = (a: TableData, b: TableData) =>
    a !== b && Rect.from(b.bbox).contains(Rect.from(a.bbox));
  const kept = out.filter((t) => !out.some((o) => inside(t, o)));
  kept.sort((a, b) => a.bbox[0] - b.bbox[0] || a.bbox[1] - b.bbox[1]);
  return kept;
}

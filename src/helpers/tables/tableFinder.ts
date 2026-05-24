import { Rect, type BBox } from "../geometry";
import type { Block, TableData, DrawingPath, Span, CellStyle } from "../types";

const DEFAULT_CELL_STYLE: CellStyle = {
  bold: true,
  italic: true,
  inlineCode: true,
  lineBreak: true,
};
import { areDisjoint } from "../utils";
import { FLAG_BOLD, FLAG_ITALIC, FLAG_MONOSPACED, CHAR_BOLD } from "../constants";

export type TableStrategy = "lines_strict" | "lines" | "text" | "explicit";

const TOL = 3; // snapping tolerance for line coordinates

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
  } else if (p.type === "s" && (r.width >= edgeMin || r.height >= edgeMin)) {
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
 * Per-character cell membership: a char belongs to the cell when its bbox area
 * overlaps the cell by >50% of the char's own area. Whitespace chars whose bbox
 * is mostly outside degrade to a single space. Mirrors upstream
 * pymupdf/table.py:extract_cells (1.27.2.3) — without this gate, wrapped text
 * whose span bbox grazes a row boundary gets pulled into both adjacent cells.
 */
function charsInCell(span: Span, cell: Rect): string {
  let out = "";
  for (const ch of span.chars) {
    const cb = ch.bbox;
    const ix0 = Math.max(cb[0], cell.x0);
    const iy0 = Math.max(cb[1], cell.y0);
    const ix1 = Math.min(cb[2], cell.x1);
    const iy1 = Math.min(cb[3], cell.y1);
    const interArea = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
    const charArea = Math.max(0, cb[2] - cb[0]) * Math.max(0, cb[3] - cb[1]);
    if (interArea > 0.5 * charArea) {
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

    const cells: (BBox | null)[][] = [];
    for (let r = 0; r < this.row_count; r++) {
      const row: (BBox | null)[] = [];
      for (let c = 0; c < this.col_count; c++) {
        row.push([cols[c]!, rows[r]!, cols[c + 1]!, rows[r + 1]!]);
      }
      cells.push(row);
    }
    this.cells = cells;
    const headerRow = cells[0] ?? [];
    const headerX0 = headerRow.length ? headerRow[0]![0] : this.bbox[0];
    const headerX1 = headerRow.length ? headerRow[headerRow.length - 1]![2] : this.bbox[2];
    const headerY0 = headerRow.length ? headerRow[0]![1] : this.bbox[1];
    const headerY1 = headerRow.length ? headerRow[0]![3] : this.bbox[1];
    this.header = {
      bbox: [headerX0, headerY0, headerX1, headerY1],
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
        const headerTxt = style.lineBreak ? txt.replace(/\n/g, "<br>") : txt.replace(/\n/g, " ");
        row.push(markdown ? txt : headerTxt);
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
  if (!paths.length) return [];
  const allEdges: { kind: "h" | "v"; x0: number; y0: number; x1: number; y1: number }[] = [];
  const edgeMin = strategy === "lines" ? 2 : 3;
  for (const p of paths) {
    if (!clip.contains(p.rect) && !p.rect.intersects(clip)) continue;
    allEdges.push(...pathToEdges(p, edgeMin));
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

/**
 * Detect tables purely from text alignment — no ruling lines required.
 *
 * Approach: walk the page's text lines, cluster them into rectangular
 * regions where each row has the same set of column-start x-coordinates
 * (within a small tolerance). A region of ≥2 such rows with ≥2 columns
 * becomes a table.
 *
 * This is a deliberately lightweight port — `pymupdf4llm.helpers.utils`
 * does a deeper analysis. For tables with no rules it produces a usable
 * markdown grid, but column boundaries may not match PyMuPDF byte-for-byte.
 */
function findTablesByText(blocks: Block[], clip: Rect): TableData[] {
  type LineRec = { rect: Rect; spans: Span[]; xs: number[] };
  const lines: LineRec[] = [];
  for (const b of blocks) {
    if (b.type !== 0) continue;
    if (areDisjoint(b.bbox, clip)) continue;
    for (const l of b.lines) {
      if (areDisjoint(l.bbox, clip)) continue;
      const spans = l.spans.filter((s) => s.text.trim());
      if (spans.length < 2) continue;
      const xs = spans.map((s) => s.bbox.x0);
      lines.push({ rect: Rect.from(l.bbox), spans, xs });
    }
  }
  if (lines.length < 2) return [];
  lines.sort((a, b) => a.rect.y0 - b.rect.y0 || a.rect.x0 - b.rect.x0);

  // Cluster adjacent lines that share at least 2 column-start x-coordinates.
  const clusters: LineRec[][] = [];
  let current: LineRec[] = [lines[0]!];
  for (let i = 1; i < lines.length; i++) {
    const prev = current[current.length - 1]!;
    const cur = lines[i]!;
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
    const colXs = uniqueSorted(group.flatMap((l) => l.xs));
    if (colXs.length < 2) continue;
    const rowYs: number[] = [];
    for (const l of group) rowYs.push(l.rect.y0, l.rect.y1);
    const rows = uniqueSorted(rowYs);
    if (rows.length < 3) continue;
    const padRight = Math.max(...group.map((l) => l.rect.x1));
    const padBottom = Math.max(...group.map((l) => l.rect.y1));
    const allCols = [...colXs, padRight + 1];
    const allRows = rows[rows.length - 1]! >= padBottom ? rows : [...rows, padBottom + 1];
    const bbox = new Rect(
      allCols[0]!,
      allRows[0]!,
      allCols[allCols.length - 1]!,
      allRows[allRows.length - 1]!,
    );
    const hRecs = allRows.map((y) => ({ y, x0: bbox.x0, x1: bbox.x1 }));
    const vRecs = allCols.map((x) => ({ x, y0: bbox.y0, y1: bbox.y1 }));
    const t = new Table(blocks, { bbox, hLines: hRecs, vLines: vRecs });
    if (t.row_count >= 2 && t.col_count >= 2) out.push(t);
  }
  out.sort((a, b) => a.bbox[0] - b.bbox[0] || a.bbox[1] - b.bbox[1]);
  return out;
}

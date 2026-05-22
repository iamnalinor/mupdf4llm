import { Rect, type BBox } from "./geometry";
import type { Block, TableData, DrawingPath, Span } from "./types";
import { areDisjoint, isWhite } from "./utils";
import { FLAG_BOLD, FLAG_ITALIC, FLAG_MONOSPACED, CHAR_BOLD, CHAR_STRIKEOUT } from "./constants";

const TOL = 3; // snapping tolerance for line coordinates

function uniqueSorted(vals: number[]): number[] {
  const sorted = vals.slice().sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (!out.length || v - out[out.length - 1]! > TOL) out.push(v);
  }
  return out;
}

/** Treat any path of width<=3 or height<=3 (or filled thin rect) as an edge. */
function pathToEdges(p: DrawingPath): { kind: "h" | "v"; x0: number; y0: number; x1: number; y1: number }[] {
  const r = p.rect;
  const edges: { kind: "h" | "v"; x0: number; y0: number; x1: number; y1: number }[] = [];
  if (r.width >= 3 && r.height <= 3) {
    const y = (r.y0 + r.y1) / 2;
    edges.push({ kind: "h", x0: r.x0, x1: r.x1, y0: y, y1: y });
  } else if (r.height >= 3 && r.width <= 3) {
    const x = (r.x0 + r.x1) / 2;
    edges.push({ kind: "v", x0: x, x1: x, y0: r.y0, y1: r.y1 });
  } else if (p.type === "f" && r.width >= 3 && r.height >= 3) {
    // a filled rect → four edges
    edges.push({ kind: "h", x0: r.x0, x1: r.x1, y0: r.y0, y1: r.y0 });
    edges.push({ kind: "h", x0: r.x0, x1: r.x1, y0: r.y1, y1: r.y1 });
    edges.push({ kind: "v", x0: r.x0, x1: r.x0, y0: r.y0, y1: r.y1 });
    edges.push({ kind: "v", x0: r.x1, x1: r.x1, y0: r.y0, y1: r.y1 });
  } else if (p.type === "s" && (r.width >= 3 || r.height >= 3)) {
    // approximate stroked rect by its 4 edges
    edges.push({ kind: "h", x0: r.x0, x1: r.x1, y0: r.y0, y1: r.y0 });
    edges.push({ kind: "h", x0: r.x0, x1: r.x1, y0: r.y1, y1: r.y1 });
    edges.push({ kind: "v", x0: r.x0, x1: r.x0, y0: r.y0, y1: r.y1 });
    edges.push({ kind: "v", x0: r.x1, x1: r.x1, y0: r.y0, y1: r.y1 });
  }
  return edges;
}

/** Merge collinear horizontal segments into spans. */
function mergeH(edges: { kind: "h" | "v"; x0: number; y0: number; x1: number; y1: number }[]) {
  const h = edges.filter((e) => e.kind === "h").map((e) => ({ y: e.y0, x0: Math.min(e.x0, e.x1), x1: Math.max(e.x0, e.x1) }));
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
  const v = edges.filter((e) => e.kind === "v").map((e) => ({ x: e.x0, y0: Math.min(e.y0, e.y1), y1: Math.max(e.y0, e.y1) }));
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
  hLines.forEach((h, i) => segs.push({ rect: new Rect(h.x0, h.y - 1, h.x1, h.y + 1), isH: true, idx: i }));
  vLines.forEach((v, i) => segs.push({ rect: new Rect(v.x - 1, v.y0, v.x + 1, v.y1), isH: false, idx: i }));
  if (!segs.length) return [];

  const parent = segs.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
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
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
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

function spanStyling(spans: Span[]): { bold: boolean; italic: boolean; mono: boolean; strike: boolean } {
  if (!spans.length) return { bold: false, italic: false, mono: false, strike: false };
  const bold = spans.every((s) => (s.flags & FLAG_BOLD) || (s.char_flags & CHAR_BOLD));
  const italic = spans.every((s) => s.flags & FLAG_ITALIC);
  const mono = spans.every((s) => s.flags & FLAG_MONOSPACED);
  const strike = spans.every((s) => s.char_flags & CHAR_STRIKEOUT);
  return { bold, italic, mono, strike };
}

/** Extract markdown-styled text from a rect. */
function extractCellText(blocks: Block[], cell: Rect, markdown: boolean): string {
  let text = "";
  for (const b of blocks) {
    if (b.type !== 0) continue;
    if (areDisjoint(b.bbox, cell)) continue;
    for (const line of b.lines) {
      if (areDisjoint(line.bbox, cell)) continue;
      if (text) text += markdown ? "<br>" : "\n";
      for (const span of line.spans) {
        if (areDisjoint(span.bbox, cell)) continue;
        let st = span.text;
        if (!st) continue;
        if (!markdown) {
          text += st;
          continue;
        }
        st = st.length > 2 ? st.replace(/\s+$/, "") : st;
        const { bold, italic, mono, strike } = spanStyling([span]);
        let prefix = "", suffix = "";
        if (strike) { prefix = "~~" + prefix; suffix = "~~" + suffix; }
        if (bold) { prefix = "**" + prefix; suffix = "**" + suffix; }
        if (italic) { prefix = "_" + prefix; suffix = "_" + suffix; }
        if (mono) { prefix = "`" + prefix; suffix = "`" + suffix; }
        if (!st.trim()) {
          text += " ";
        } else {
          text += prefix + st.trim() + suffix;
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

  to_markdown(_clean = true): string {
    const grid: string[][] = [];
    for (let r = 0; r < this.row_count; r++) {
      const row: string[] = [];
      for (let c = 0; c < this.col_count; c++) {
        const cell = this.cells[r]![c];
        row.push(cell ? extractCellText(this.blocks, Rect.from(cell), true) : "");
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

export function findTables(blocks: Block[], paths: DrawingPath[], clip: Rect): TableData[] {
  if (!paths.length) return [];
  const allEdges: { kind: "h" | "v"; x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const p of paths) {
    if (!clip.contains(p.rect) && !p.rect.intersects(clip)) continue;
    allEdges.push(...pathToEdges(p));
  }
  const hLines = mergeH(allEdges);
  const vLines = mergeV(allEdges);
  const clusters = clusterLines(hLines, vLines);
  const out: TableData[] = [];
  for (const cl of clusters) {
    const t = new Table(blocks, cl);
    if (t.row_count >= 2 && t.col_count >= 2) out.push(t);
  }
  out.sort((a, b) => a.bbox[0] - b.bbox[0] || a.bbox[1] - b.bbox[1]);
  return out;
}

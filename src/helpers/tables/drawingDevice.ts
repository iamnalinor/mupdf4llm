import * as mupdf from "mupdf";
import { Rect } from "../geometry";
import type { DrawingEdge, DrawingPath, ImageInfo } from "../types";

function colorToRGB(color: number[] | null | undefined): [number, number, number] | null {
  if (!color) return null;
  if (color.length === 1) return [color[0]!, color[0]!, color[0]!];
  if (color.length >= 3) return [color[0]!, color[1]!, color[2]!];
  return null;
}

function transformBounds(ctm: mupdf.Matrix, bounds: number[]): Rect {
  // Apply ctm to the 4 corners of the bounds and take the axis-aligned envelope.
  // bounds = [x0,y0,x1,y1]
  const [a, b, c, d, e, f] = ctm;
  const corners: [number, number][] = [
    [bounds[0]!, bounds[1]!],
    [bounds[2]!, bounds[1]!],
    [bounds[0]!, bounds[3]!],
    [bounds[2]!, bounds[3]!],
  ];
  const xs = corners.map(([x, y]) => a * x + c * y + e);
  const ys = corners.map(([x, y]) => b * x + d * y + f);
  return new Rect(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
}

type Point = [number, number];

/** Max deviation (pt) from the axis for a segment to count as a rule. */
const AXIS_TOL = 0.5;
/** Max slope for long segments: ~0.5°. */
const AXIS_SLOPE = Math.tan((0.5 * Math.PI) / 180);
/** Segments shorter than this (pt) are not rules. */
const MIN_EDGE_LEN = 1;
/** Filled rectangles thinner than this (pt) are rules, thicker ones are areas. */
const MAX_RULE_WIDTH = 3;
/** Coordinate tolerance (pt) when recognising rectangles. */
const RECT_TOL = 0.5;

function transformPoint(x: number, y: number, [a, b, c, d, e, f]: mupdf.Matrix): Point {
  return [a * x + c * y + e, b * x + d * y + f];
}

interface Subpath {
  points: Point[];
  /** viaCurve[i]: the piece ending at points[i] is a Bézier curve, not a line. */
  viaCurve: boolean[];
  closed: boolean;
  curved: boolean;
}

/** Split a path into its subpaths, with every point already mapped through `ctm`. */
function walkSubpaths(path: mupdf.Path, ctm: mupdf.Matrix): Subpath[] {
  const out: Subpath[] = [];
  let cur: Subpath | null = null;
  // Where the next segment starts when it isn't preceded by a moveTo
  // (after closePath the current point returns to the subpath start).
  let pen: Point | null = null;
  const begin = (p: Point) => {
    cur = { points: [p], viaCurve: [false], closed: false, curved: false };
    out.push(cur);
  };
  const extend = (p: Point, curved: boolean) => {
    if (!cur) begin(pen ?? p);
    cur!.points.push(p);
    cur!.viaCurve.push(curved);
    if (curved) cur!.curved = true;
    pen = p;
  };
  path.walk({
    moveTo(x, y) {
      pen = transformPoint(x, y, ctm);
      begin(pen);
    },
    lineTo(x, y) {
      extend(transformPoint(x, y, ctm), false);
    },
    curveTo(_x1, _y1, _x2, _y2, x3, y3) {
      extend(transformPoint(x3, y3, ctm), true);
    },
    closePath() {
      if (!cur) return;
      cur.closed = true;
      pen = cur.points[0]!;
      cur = null;
    },
  });
  return out.filter((sp) => sp.points.length > 1);
}

const near = (a: number, b: number, tol = RECT_TOL) => Math.abs(a - b) <= tol;
const samePoint = (p: Point, q: Point) => near(p[0], q[0]) && near(p[1], q[1]);

/** Straight segments of a subpath (curves skipped), including the implicit closing one. */
function subpathSegments(sp: Subpath, close: boolean): [Point, Point][] {
  const pts = sp.points;
  const segs: [Point, Point][] = [];
  for (let i = 1; i < pts.length; i++) if (!sp.viaCurve[i]) segs.push([pts[i - 1]!, pts[i]!]);
  if (close && !samePoint(pts[0]!, pts[pts.length - 1]!))
    segs.push([pts[pts.length - 1]!, pts[0]!]);
  return segs;
}

/**
 * Centerline edge for a near-horizontal or near-vertical segment, clipped to
 * `bounds`. A rule counts as visible while any part of its line width is
 * inside the clip (borders are often drawn exactly on the clip rectangle).
 */
function segmentToEdge(a: Point, b: Point, width: number, bounds: Rect): DrawingEdge | null {
  const dx = Math.abs(b[0] - a[0]);
  const dy = Math.abs(b[1] - a[1]);
  const tol = Math.max(width / 2, AXIS_TOL);
  if (dx >= MIN_EDGE_LEN && dy <= Math.max(AXIS_TOL, dx * AXIS_SLOPE)) {
    const y = (a[1] + b[1]) / 2;
    const x0 = Math.max(Math.min(a[0], b[0]), bounds.x0 - tol);
    const x1 = Math.min(Math.max(a[0], b[0]), bounds.x1 + tol);
    if (y < bounds.y0 - tol || y > bounds.y1 + tol || x1 - x0 < MIN_EDGE_LEN) return null;
    return { kind: "h", x0, x1, y, width };
  }
  if (dy >= MIN_EDGE_LEN && dx <= Math.max(AXIS_TOL, dy * AXIS_SLOPE)) {
    const x = (a[0] + b[0]) / 2;
    const y0 = Math.max(Math.min(a[1], b[1]), bounds.y0 - tol);
    const y1 = Math.min(Math.max(a[1], b[1]), bounds.y1 + tol);
    if (x < bounds.x0 - tol || x > bounds.x1 + tol || y1 - y0 < MIN_EDGE_LEN) return null;
    return { kind: "v", x, y0, y1, width };
  }
  return null;
}

/** The axis-aligned rectangle a (filled) subpath describes, or null for any other shape. */
function subpathToRect(sp: Subpath): Rect | null {
  if (sp.curved) return null;
  const pts: Point[] = [];
  for (const p of sp.points) if (!pts.length || !samePoint(pts[pts.length - 1]!, p)) pts.push(p);
  if (pts.length > 1 && samePoint(pts[0]!, pts[pts.length - 1]!)) pts.pop();
  if (pts.length !== 4) return null;
  for (let i = 0; i < 4; i++) {
    const p = pts[i]!,
      q = pts[(i + 1) % 4]!;
    if (!near(p[0], q[0]) && !near(p[1], q[1])) return null; // diagonal side
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs),
    x1 = Math.max(...xs),
    y0 = Math.min(...ys),
    y1 = Math.max(...ys);
  if (!xs.every((x) => near(x, x0) || near(x, x1))) return null;
  if (!ys.every((y) => near(y, y0) || near(y, y1))) return null;
  return new Rect(x0, y0, x1, y1);
}

/** True for white (or near-white) paint. */
function isWhite(cs: mupdf.ColorSpace, color: ArrayLike<number>): boolean {
  const c = Array.from(color);
  if (cs.isCMYK()) return c.every((v) => v <= 0.05);
  if (cs.isGray() || cs.isRGB()) return c.length > 0 && c.every((v) => v >= 0.95);
  return false;
}

export interface PageDrawings {
  /** Filled areas and whole-path bounds of shapes that are not simple rules. */
  paths: DrawingPath[];
  /** Ruling lines recovered from stroked segments and thin filled rectangles. */
  edges: DrawingEdge[];
  images: ImageInfo[];
}

/**
 * Run a custom Device against a page to recover drawings and image-info.
 * With `vectors: false` only images are collected (paths are not analysed).
 */
export function extractDrawings(page: mupdf.Page, opts: { vectors?: boolean } = {}): PageDrawings {
  const vectors = opts.vectors ?? true;
  const paths: DrawingPath[] = [];
  const edges: DrawingEdge[] = [];
  const images: ImageInfo[] = [];
  // Visible area: the page, narrowed by the clip stack (as bounding boxes).
  // Grids drawn under a clip commonly extend past it, e.g. a table continued
  // over several pages where every page repeats the full grid.
  const clips: Rect[] = [Rect.from(page.getBounds())];
  const visible = () => clips[clips.length - 1]!;
  const pushClip = (b?: number[] | Rect) => {
    clips.push(b ? visible().intersect(b) : visible());
  };
  // Inside beginMask..endMask the device receives the mask's own drawing,
  // which is never shown on the page.
  let maskDepth = 0;
  let imageCounter = 0;

  const dev = new mupdf.Device({
    fillPath(path, _evenOdd, ctm, cs, color, alpha) {
      if (!vectors || maskDepth > 0 || alpha <= 0.01) return;
      // White areas are cell/paragraph backgrounds: invisible on the page, and
      // their borders would otherwise become phantom table rules. Thin white
      // rectangles are still rules (e.g. white grid over a shaded table).
      const white = isWhite(cs, color);
      const fill = colorToRGB(color as unknown as number[]);
      const subpaths = walkSubpaths(path, ctm);
      const rects = subpaths.map(subpathToRect);
      if (subpaths.length && rects.every((r) => r !== null)) {
        // A path made only of rectangles (typically many thin ones forming a
        // grid): thin ones become rules, the rest keep the area behaviour.
        for (const r of rects as Rect[]) {
          const thin = Math.min(r.width, r.height);
          if (thin <= MAX_RULE_WIDTH) {
            const mid: [Point, Point] =
              r.width >= r.height
                ? [
                    [r.x0, (r.y0 + r.y1) / 2],
                    [r.x1, (r.y0 + r.y1) / 2],
                  ]
                : [
                    [(r.x0 + r.x1) / 2, r.y0],
                    [(r.x0 + r.x1) / 2, r.y1],
                  ];
            const e = segmentToEdge(mid[0], mid[1], thin, visible());
            if (e) edges.push(e);
          } else if (!white) {
            paths.push({
              type: "f",
              rect: r,
              fill,
              color: null,
              width: null,
              stroked: false,
              filled: true,
            });
          }
        }
        return;
      }
      // Anything else (curves, glyph-like outlines): whole-path bounds as before.
      if (white) return;
      const b = path.getBounds(null as unknown as mupdf.StrokeState, ctm);
      const rect = new Rect(b[0], b[1], b[2], b[3]);
      if (!rect.isValid) return;
      paths.push({ type: "f", rect, fill, color: null, width: null, stroked: false, filled: true });
    },
    strokePath(path, stroke, ctm, _cs, _color, alpha) {
      if (!vectors || maskDepth > 0 || alpha <= 0.01) return;
      // Line width is in user space; scale it into page space.
      const scale = Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]));
      const width = stroke.getLineWidth() * scale;
      // A single path may hold a whole grid (m/l/m/l/.../S): emit each straight
      // axis-aligned segment. Curves and diagonals are not rules, but the
      // straight sides of e.g. a rounded-corner border are.
      for (const sp of walkSubpaths(path, ctm)) {
        for (const [a, b] of subpathSegments(sp, sp.closed)) {
          const e = segmentToEdge(a, b, width, visible());
          if (e) edges.push(e);
        }
      }
    },
    clipPath(path, _evenOdd, ctm) {
      pushClip(path.getBounds(null as unknown as mupdf.StrokeState, ctm));
    },
    clipStrokePath(path, stroke, ctm) {
      pushClip(path.getBounds(stroke, ctm));
    },
    clipText() {
      pushClip();
    },
    clipStrokeText() {
      pushClip();
    },
    clipImageMask(_image, ctm) {
      pushClip(transformBounds(ctm, [0, 0, 1, 1]));
    },
    beginMask() {
      // A soft mask is closed by popClip like the other clips.
      pushClip();
      maskDepth++;
    },
    endMask() {
      if (maskDepth > 0) maskDepth--;
    },
    popClip() {
      if (clips.length > 1) clips.pop();
    },
    fillImage(image, ctm, _alpha) {
      if (maskDepth > 0) return;
      const rect = transformBounds(ctm, [0, 0, 1, 1]);
      images.push({
        bbox: rect,
        width: image.getWidth(),
        height: image.getHeight(),
        number: imageCounter++,
      });
    },
    fillImageMask(image, ctm) {
      if (maskDepth > 0) return;
      const rect = transformBounds(ctm, [0, 0, 1, 1]);
      images.push({
        bbox: rect,
        width: image.getWidth(),
        height: image.getHeight(),
        number: imageCounter++,
      });
    },
  });

  try {
    page.run(dev, mupdf.Matrix.identity);
  } finally {
    dev.close();
    dev.destroy();
  }
  return { paths, edges, images };
}

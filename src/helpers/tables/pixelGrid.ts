import { INK, type PageRaster } from "../ocr/engine";
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
  const { width: w, height: h, data, scale } = raster;
  const gap = Math.max(2, Math.round(scale));
  const minLen = Math.max(12, Math.round(scale * 24));
  const maxThick = Math.max(2, scale * 4);

  const horiz = scan(h, w, (row, i) => data[row * w + i]! < INK, gap, minLen, maxThick);
  const vert = scan(w, h, (col, i) => data[i * w + col]! < INK, gap, minLen, maxThick);

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

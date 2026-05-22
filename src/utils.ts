import { WHITE_CHARS, BULLETS } from "./constants";
import { Rect, type BBox } from "./geometry";

export function isWhite(text: string): boolean {
  for (const c of text) {
    if (!WHITE_CHARS.has(c)) return false;
  }
  return true;
}

export function startswithBullet(text: string): boolean {
  if (!text) return false;
  const c = text[0];
  if (!c || !BULLETS.has(c)) return false;
  if (text.length === 1) return true;
  if (text[1] === " ") return true;
  return false;
}

export function bboxIsEmpty(b: readonly number[] | Rect): boolean {
  if (b instanceof Rect) return b.isEmpty;
  return (b[0] as number) >= (b[2] as number) || (b[1] as number) >= (b[3] as number);
}

export function intersectRects(r1: readonly number[] | Rect, r2: readonly number[] | Rect): Rect {
  const a = r1 instanceof Rect ? [r1.x0, r1.y0, r1.x1, r1.y1] : r1;
  const b = r2 instanceof Rect ? [r2.x0, r2.y0, r2.x1, r2.y1] : r2;
  return new Rect(
    Math.max(a[0] as number, b[0] as number),
    Math.max(a[1] as number, b[1] as number),
    Math.min(a[2] as number, b[2] as number),
    Math.min(a[3] as number, b[3] as number),
  );
}

export function joinRects(rects: (readonly number[] | Rect)[]): Rect {
  if (!rects.length) return Rect.empty();
  const first = rects[0]!;
  const a = first instanceof Rect ? [first.x0, first.y0, first.x1, first.y1] : first;
  let x0 = a[0] as number, y0 = a[1] as number, x1 = a[2] as number, y1 = a[3] as number;
  for (let i = 1; i < rects.length; i++) {
    const r = rects[i]!;
    const b = r instanceof Rect ? [r.x0, r.y0, r.x1, r.y1] : r;
    x0 = Math.min(x0, b[0] as number);
    y0 = Math.min(y0, b[1] as number);
    x1 = Math.max(x1, b[2] as number);
    y1 = Math.max(y1, b[3] as number);
  }
  return new Rect(x0, y0, x1, y1);
}

export function almostInBbox(bbox: readonly number[] | Rect, clip: readonly number[] | Rect, portion = 0.8): boolean {
  const b = bbox instanceof Rect ? [bbox.x0, bbox.y0, bbox.x1, bbox.y1] : bbox;
  const c = clip instanceof Rect ? [clip.x0, clip.y0, clip.x1, clip.y1] : clip;
  const ix0 = Math.max(b[0] as number, c[0] as number);
  const iy0 = Math.max(b[1] as number, c[1] as number);
  const ix1 = Math.min(b[2] as number, c[2] as number);
  const iy1 = Math.min(b[3] as number, c[3] as number);
  const interArea = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
  const boxArea = ((b[2] as number) - (b[0] as number)) * ((b[3] as number) - (b[1] as number));
  return interArea > boxArea * portion;
}

export function areDisjoint(
  a: readonly number[] | Rect,
  b: readonly number[] | Rect,
  strict = false,
): boolean {
  const r1 = a instanceof Rect ? [a.x0, a.y0, a.x1, a.y1] : a;
  const r2 = b instanceof Rect ? [b.x0, b.y0, b.x1, b.y1] : b;
  if (!strict) {
    return (
      (r1[0] as number) >= (r2[2] as number) ||
      (r1[2] as number) <= (r2[0] as number) ||
      (r1[1] as number) >= (r2[3] as number) ||
      (r1[3] as number) <= (r2[1] as number)
    );
  }
  return (
    (r1[0] as number) > (r2[2] as number) ||
    (r1[2] as number) < (r2[0] as number) ||
    (r1[1] as number) > (r2[3] as number) ||
    (r1[3] as number) < (r2[1] as number)
  );
}

export function bboxInBbox(
  inner: readonly number[] | Rect,
  outer: readonly number[] | Rect,
): boolean {
  const i = inner instanceof Rect ? [inner.x0, inner.y0, inner.x1, inner.y1] : inner;
  const o = outer instanceof Rect ? [outer.x0, outer.y0, outer.x1, outer.y1] : outer;
  return (
    (o[0] as number) <= (i[0] as number) &&
    (o[1] as number) <= (i[1] as number) &&
    (o[2] as number) >= (i[2] as number) &&
    (o[3] as number) >= (i[3] as number)
  );
}

export type BBoxT = BBox;

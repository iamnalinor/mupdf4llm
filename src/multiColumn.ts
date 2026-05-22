import { Rect } from "./geometry.ts";
import { isWhite, areDisjoint, bboxIsEmpty, intersectRects } from "./utils.ts";
import type { Block } from "./types.ts";

export interface ColumnBoxesOpts {
  clip: Rect;
  footerMargin?: number;
  headerMargin?: number;
  noImageText?: boolean;
  paths?: Rect[];
  avoid?: Rect[];
  ignoreImages?: boolean;
}

function inBbox(bb: Rect, bboxes: Rect[]): number {
  for (let i = 0; i < bboxes.length; i++) {
    if (bboxes[i]!.contains(bb)) return i + 1;
  }
  return 0;
}

function inBboxCache(bb: Rect, bboxes: Rect[], cache: Map<string, number>): number {
  // Simple cache keyed by identity. Since we can't get Python's id() in TS,
  // use coordinate strings.
  const key = `${bb.x0},${bb.y0},${bb.x1},${bb.y1}|${bboxes.length}`;
  const c = cache.get(key);
  if (c !== undefined) return c;
  const v = inBbox(bb, bboxes);
  cache.set(key, v);
  return v;
}

function intersectsBboxes(bb: Rect, bboxes: Rect[]): boolean {
  for (const b of bboxes) if (!areDisjoint(bb, b, true)) return true;
  return false;
}

function canExtend(temp: Rect, bb: Rect, bboxlist: (Rect | null)[], vertBboxes: Rect[]): boolean {
  for (const b of bboxlist) {
    const noVertHit = !intersectsBboxes(temp, vertBboxes);
    if (
      noVertHit &&
      (b === null || b === bb || bboxIsEmpty(intersectRects(temp, b)))
    ) continue;
    return false;
  }
  return true;
}

function cleanNblocks(nblocks: Rect[]): Rect[] {
  const blen = nblocks.length;
  if (blen < 2) return nblocks;
  for (let i = blen - 1; i > 0; i--) {
    if (nblocks[i]!.equals(nblocks[i - 1]!)) nblocks.splice(i, 1);
  }
  if (!nblocks.length) return nblocks;
  let y1 = nblocks[0]!.y1;
  let i0 = 0;
  let i1 = -1;
  for (let i = 1; i < nblocks.length; i++) {
    const b1 = nblocks[i]!;
    if (Math.abs(b1.y1 - y1) > 3) {
      if (i1 > i0) {
        const segment = nblocks.slice(i0, i1 + 1).sort((a, b) => a.x0 - b.x0);
        for (let k = 0; k < segment.length; k++) nblocks[i0 + k] = segment[k]!;
      }
      y1 = b1.y1;
      i0 = i;
    }
    i1 = i;
  }
  if (i1 > i0) {
    const segment = nblocks.slice(i0, i1 + 1).sort((a, b) => a.x0 - b.x0);
    for (let k = 0; k < segment.length; k++) nblocks[i0 + k] = segment[k]!;
  }
  return nblocks;
}

function joinRectsPhase2(bboxes: Rect[]): Rect[] {
  const prects = bboxes.map((b) => b.clone());
  for (let i = 0; i < prects.length; i++) {
    const b = prects[i]!;
    let x0 = b.x0;
    let x1 = b.x1;
    for (const bb of prects) {
      if (Math.abs(bb.x0 - b.x0) <= 3) x0 = Math.min(x0, bb.x0);
      if (Math.abs(bb.x1 - b.x1) <= 3) x1 = Math.max(x1, bb.x1);
    }
    b.x0 = x0;
    b.x1 = x1;
  }
  prects.sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0);
  if (!prects.length) return prects;
  const newRects: Rect[] = [prects[0]!];
  for (let i = 1; i < prects.length; i++) {
    const r = prects[i]!;
    const r0 = newRects[newRects.length - 1]!;
    if (Math.abs(r.x0 - r0.x0) <= 3 && Math.abs(r.x1 - r0.x1) <= 3 && Math.abs(r0.y1 - r.y0) <= 10) {
      r0.unionInPlace(r);
      continue;
    }
    newRects.push(r);
  }
  return newRects;
}

function joinRectsPhase3(bboxes: Rect[], pathRects: Rect[], cache: Map<string, number>): Rect[] {
  const prects: (Rect | null)[] = bboxes.map((b) => b.clone());
  const newRects: Rect[] = [];

  while (prects.length) {
    let prect0 = prects[0]!;
    let repeat = true;
    while (repeat) {
      repeat = false;
      for (let i = prects.length - 1; i > 0; i--) {
        const prect1 = prects[i]!;
        if (prect1.x0 > prect0.x1 || prect1.x1 < prect0.x0) continue;
        if (inBboxCache(prect0, pathRects, cache) !== inBboxCache(prect1, pathRects, cache)) continue;
        const temp = prect0.union(prect1);
        const all = [...prects.filter((b): b is Rect => !!b), ...newRects];
        const hits = all.filter((b) => b.intersects(temp));
        const onlyTwo = hits.length === 2 &&
          hits.some((b) => b.equals(prect0)) &&
          hits.some((b) => b.equals(prect1));
        if (onlyTwo) {
          prect0 = prect0.union(prect1);
          prects[0] = prect0;
          prects.splice(i, 1);
          repeat = true;
        }
      }
    }
    newRects.push(prect0);
    prects.shift();
  }

  const sortKeys: { rect: Rect; key: [number, number] }[] = [];
  for (const box of newRects) {
    const leftRects = newRects
      .filter(
        (r) =>
          r.x1 < box.x0 &&
          ((box.y0 <= r.y0 && r.y0 <= box.y1) || (box.y0 <= r.y1 && r.y1 <= box.y1)),
      )
      .sort((a, b) => a.x1 - b.x1);
    const key: [number, number] = leftRects.length
      ? [leftRects[leftRects.length - 1]!.y0, box.x0]
      : [box.y0, box.x0];
    sortKeys.push({ rect: box, key });
  }
  sortKeys.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1]);
  return sortKeys.map((s) => s.rect);
}

export function columnBoxes(blocks: Block[], opts: ColumnBoxesOpts): Rect[] {
  const clip = opts.clip.clone();
  clip.y0 += opts.headerMargin ?? 0;
  clip.y1 -= opts.footerMargin ?? 0;
  if (clip.isEmpty) return [];

  const paths: Rect[] = opts.paths ?? [];
  const imgBboxes: Rect[] = opts.avoid ? [...opts.avoid] : [];
  const vertBboxes: Rect[] = [];
  const pathRects: Rect[] = paths.slice().sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);

  let bboxes: Rect[] = [];

  for (const b of blocks) {
    if (b.type !== 0) continue;
    const bbox = Rect.from(b.bbox);
    if ((opts.noImageText ?? true) && inBbox(bbox, imgBboxes)) continue;
    const line0 = b.lines[0];
    if (!line0) continue;
    if (Math.abs(1 - line0.dir[0]) > 1e-3) {
      vertBboxes.push(bbox);
      continue;
    }
    let srect = Rect.empty();
    for (const line of b.lines) {
      const lbbox = Rect.from(line.bbox);
      const text = line.spans.map((s) => s.text).join("");
      if (!isWhite(text)) {
        if (srect.isEmpty) srect = lbbox.clone();
        else srect.unionInPlace(lbbox);
      }
    }
    if (!srect.isEmpty) bboxes.push(srect);
  }

  bboxes.sort((a, b) => {
    const aIn = inBbox(a, pathRects);
    const bIn = inBbox(b, pathRects);
    if (aIn !== bIn) return aIn - bIn;
    if (a.y0 !== b.y0) return a.y0 - b.y0;
    return a.x0 - b.x0;
  });
  if (!bboxes.length) return [];

  let nblocks: (Rect | null)[] = [bboxes[0]!];
  const remaining: (Rect | null)[] = bboxes.slice(1);
  const cache = new Map<string, number>();

  for (let i = 0; i < remaining.length; i++) {
    const bb = remaining[i];
    if (!bb) continue;
    let check = false;
    let j = 0;
    let temp: Rect = bb;
    for (j = 0; j < nblocks.length; j++) {
      const nbb = nblocks[j];
      if (!nbb || nbb.x1 < bb.x0 || bb.x1 < nbb.x0) continue;
      if (inBboxCache(nbb, pathRects, cache) !== inBboxCache(bb, pathRects, cache)) continue;
      temp = bb.union(nbb);
      check = canExtend(temp, nbb, nblocks, vertBboxes);
      if (check) break;
    }
    if (!check) {
      nblocks.push(bb);
      j = nblocks.length - 1;
      temp = nblocks[j]!;
    }
    check = canExtend(temp, bb, remaining, vertBboxes);
    if (!check) {
      nblocks.push(bb);
    } else {
      nblocks[j] = temp;
    }
    remaining[i] = null;
  }

  let result = nblocks.filter((b): b is Rect => !!b);
  result = cleanNblocks(result);
  if (!result.length) return result;
  result = joinRectsPhase2(result);
  result = joinRectsPhase3(result, pathRects, cache);
  return result;
}

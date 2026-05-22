import { Rect } from "./geometry";
import { TYPE3_FONT_NAME } from "./constants";
import { isWhite, almostInBbox, areDisjoint, bboxIsEmpty } from "./utils";
import type { Block, Span, TextDict } from "./types";

export interface RawLine {
  rect: Rect;
  spans: Span[];
}

function sanitizeSpans(line: Span[]): Span[] {
  line.sort((a, b) => a.bbox.x0 - b.bbox.x0);
  for (let i = line.length - 1; i > 0; i--) {
    const s0 = line[i - 1]!;
    const s1 = line[i]!;
    const delta = s1.size * 0.1;
    if (
      s0.bbox.x1 + delta < s1.bbox.x0 ||
      s0.flags !== s1.flags ||
      (s0.char_flags & ~2) !== (s1.char_flags & ~2)
    ) {
      continue;
    }
    if (s0.text !== s1.text || !s0.bbox.equals(s1.bbox)) {
      s0.text += s1.text;
    }
    s0.bbox.unionInPlace(s1.bbox);
    line.splice(i, 1);
    line[i - 1] = s0;
  }
  return line;
}

export interface GetRawLinesOpts {
  blocks?: Block[];
  clip?: Rect;
  tolerance?: number;
  ignoreInvisible?: boolean;
  onlyHorizontal?: boolean;
}

export function getRawLines(td: TextDict | undefined, opts: GetRawLinesOpts = {}): RawLine[] {
  const blocks = opts.blocks ?? td?.blocks ?? [];
  const tolerance = opts.tolerance ?? 3;
  const onlyHorizontal = opts.onlyHorizontal !== false;
  const ignoreInvisible = opts.ignoreInvisible !== false;
  const clip = opts.clip;

  const spans: Span[] = [];
  for (let bno = 0; bno < blocks.length; bno++) {
    const b = blocks[bno]!;
    if (b.type !== 0) continue;
    if (bboxIsEmpty(b.bbox)) continue;
    if (clip && areDisjoint(b.bbox, clip)) continue;
    for (let lno = 0; lno < b.lines.length; lno++) {
      const line = b.lines[lno]!;
      if (clip && areDisjoint(line.bbox, clip)) continue;
      const dir = line.dir;
      if (onlyHorizontal && Math.abs(1 - dir[0]) > 1e-3) continue;
      for (let sno = 0; sno < line.spans.length; sno++) {
        const s = line.spans[sno]!;
        if (isWhite(s.text)) continue;
        if (!s.font.startsWith(TYPE3_FONT_NAME) && s.alpha === 0 && ignoreInvisible) {
          continue;
        }
        if (clip && !almostInBbox(s.bbox, clip)) continue;
        const sbbox = s.bbox.clone();
        if (s.flags & 1) {
          const i = sno === 0 ? 1 : sno - 1;
          if (line.spans.length > i) {
            const neighbor = line.spans[i]!;
            sbbox.y1 = neighbor.bbox.y1;
          }
          s.text = `[${s.text}]`;
        }
        s.bbox = sbbox;
        s.line = lno;
        s.block = bno;
        s.dir = dir;
        spans.push(s);
      }
    }
  }

  if (!spans.length) return [];

  spans.sort((a, b) => {
    const aDir = a.dir![0];
    const bDir = b.dir![0];
    if (aDir !== bDir) return bDir - aDir;
    return a.bbox.y1 - b.bbox.y1;
  });

  const nlines: RawLine[] = [];
  let lineSpans: Span[] = [spans[0]!];
  let lrect = spans[0]!.bbox.clone();

  for (let i = 1; i < spans.length; i++) {
    const s = spans[i]!;
    const sb = s.bbox;
    const prev = lineSpans[lineSpans.length - 1]!.bbox;
    if (Math.abs(sb.y1 - prev.y1) <= tolerance || Math.abs(sb.y0 - prev.y0) <= tolerance) {
      lineSpans.push(s);
      lrect.unionInPlace(sb);
      continue;
    }
    lineSpans = sanitizeSpans(lineSpans);
    nlines.push({ rect: lrect, spans: lineSpans });
    lineSpans = [s];
    lrect = sb.clone();
  }
  lineSpans = sanitizeSpans(lineSpans);
  nlines.push({ rect: lrect, spans: lineSpans });
  return nlines;
}

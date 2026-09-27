import * as mupdf from "mupdf";

export interface Degradation {
  /** Rotation in degrees (a page fed askew). */
  deg?: number;
  /** Standard deviation of added grey noise. */
  sigma?: number;
  /** Share of pixels turned into black specks. */
  speck?: number;
  /** Resolution of the re-scan. Default 200. */
  dpi?: number;
  /** JPEG quality of the re-scan. Default 70. */
  q?: number;
}

/**
 * Re-scan the first page of `buf` as a worse scan: rendered to grey at `dpi`,
 * rotated, with noise and specks, stored as one JPEG. Deterministic.
 */
export function degrade(buf: Uint8Array, o: Degradation): Uint8Array {
  const page = mupdf.PDFDocument.openDocument(buf, "application/pdf").loadPage(0);
  const [bx0, by0, bx1, by1] = page.getBounds();
  const dpi = o.dpi ?? 200;
  const pm = page.toPixmap(
    mupdf.Matrix.scale(dpi / 72, dpi / 72),
    mupdf.ColorSpace.DeviceGray,
    false,
  );
  const w = pm.getWidth();
  const h = pm.getHeight();
  const stride = pm.getStride();
  const src = pm.getPixels();
  const out = new mupdf.Pixmap(mupdf.ColorSpace.DeviceGray, [0, 0, w, h], false);
  const dst = out.getPixels();
  const a = ((o.deg ?? 0) * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  let seed = 7;
  const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - w / 2;
      const dy = y - h / 2;
      const sx = Math.round(c * dx + s * dy + w / 2);
      const sy = Math.round(-s * dx + c * dy + h / 2);
      let v = sx >= 0 && sy >= 0 && sx < w && sy < h ? src[sy * stride + sx]! : 235;
      // Sum of three uniforms: roughly normal with the given deviation.
      v += (rnd() + rnd() + rnd() - 1.5) * 2 * (o.sigma ?? 0);
      if (rnd() < (o.speck ?? 0)) v = 40;
      dst[y * out.getStride() + x] = Math.max(0, Math.min(255, v));
    }
  }
  const doc = new mupdf.PDFDocument();
  const img = doc.addImage(new mupdf.Image(out.asJPEG(o.q ?? 70)));
  const W = bx1 - bx0;
  const H = by1 - by0;
  const res = doc.addObject({ XObject: { Im0: img } });
  doc.insertPage(-1, doc.addPage([0, 0, W, H], 0, res, `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q\n`));
  return doc.saveToBuffer("compress").asUint8Array();
}

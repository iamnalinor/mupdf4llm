import { grayImage, type OcrEngine, type OcrImage } from "./engine";

/** Model file locations (paths, URLs or buffers), as accepted by `ppu-paddle-ocr`. */
export interface RapidOcrModel {
  detection: string | ArrayBuffer;
  recognition: string | ArrayBuffer;
  charactersDictionary: string | ArrayBuffer;
}

export interface RapidOcrOptions {
  /**
   * Recognition model. A `ppu-paddle-ocr` preset name (`"v5-cyrillic-mobile"`,
   * `"v5-en-mobile"`, `"v5-latin-mobile"`, `"v6-small"`, …) or explicit model
   * files. Default `"v5-cyrillic-mobile"`: PP-OCRv5 for Cyrillic and Latin
   * text; on the test scans it read Russian and English better than the
   * `eslav` and `latin` models.
   */
  model?: string | RapidOcrModel;
}

/**
 * OCR cannot run at all (package missing, bad model, a service that rejects
 * the credentials). It aborts the conversion instead of marking every cell
 * as failed; custom engines throw it for such fatal problems.
 */
export class OcrSetupError extends Error {}

export const OCR_INSTALL_HINT = "npm install ppu-paddle-ocr onnxruntime-node";

// Kept out of static analysis so bundlers leave the optional peer alone.
const PACKAGE = "ppu-paddle-ocr";

/**
 * Default OCR engine: the RapidOCR stack (PaddleOCR PP-OCR models on ONNX
 * Runtime) through the optional peer dependencies `ppu-paddle-ocr` and
 * `onnxruntime-node`. Models are downloaded and cached on first use.
 *
 * Create one engine and pass it as `ocr` to reuse the loaded models across
 * documents; release them with `dispose()`, or let `await using` do it:
 *
 * ```ts
 * await using ocr = await createRapidOcr();
 * for (const buf of pdfs) await toMarkdown(buf, { tableStrategy: "pixels", ocr });
 * ```
 */
export async function createRapidOcr(
  opts: RapidOcrOptions = {},
): Promise<OcrEngine & AsyncDisposable> {
  let lib: any;
  try {
    lib = await import(PACKAGE);
  } catch (e) {
    throw new OcrSetupError(
      `OCR needs the optional packages ppu-paddle-ocr and onnxruntime-node: ${OCR_INSTALL_HINT}. ` +
        `Or pass your own engine as the \`ocr\` option.`,
      { cause: e },
    );
  }
  const name = opts.model ?? "v5-cyrillic-mobile";
  const model = typeof name === "string" ? lib.MODEL_PRESETS?.[name] : name;
  if (!model) throw new OcrSetupError(`Unknown ppu-paddle-ocr model preset: ${String(name)}`);
  const service = new lib.PaddleOcrService({ model });
  try {
    await service.initialize();
  } catch (e) {
    throw new OcrSetupError(`Failed to load the OCR models: ${String(e)}`, { cause: e });
  }
  return disposable({
    async recognize(image) {
      // The detector misses lone narrow glyphs ("1", "|") in a small crop;
      // on an empty result, retry at double size.
      for (const img of [image, upscale(image)]) {
        const png = img.png();
        const buf = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength);
        // The package's result cache keys images by a sparse pixel sample,
        // which similar cell crops can share.
        const res = await service.recognize(buf, { noCache: true });
        const text = String(res.text ?? "").trim();
        if (!text) continue;
        const confidence = leastSure(res);
        return confidence === undefined ? { text } : { text, confidence };
      }
      return { text: "" };
    },
    async dispose() {
      await service.destroy();
    },
  });
}

/**
 * Add `Symbol.asyncDispose` to an engine, so that
 * `await using ocr = await createRapidOcr()` releases the models when the
 * block ends. Needs a runtime that defines the symbol (Node ≥ 20.4, Bun).
 */
export function disposable<E extends OcrEngine>(engine: E): E & AsyncDisposable {
  const key = (Symbol as { asyncDispose?: symbol }).asyncDispose;
  if (key) {
    Object.defineProperty(engine, key, {
      value: async () => {
        await engine.dispose?.();
      },
    });
  }
  return engine as E & AsyncDisposable;
}

/**
 * An engine that creates the real one on the first `recognize` call, so
 * documents whose tables need no OCR never load the models. `dispose` is a
 * no-op until then.
 */
export function lazyEngine(create: () => Promise<OcrEngine>): OcrEngine {
  let engine: Promise<OcrEngine> | null = null;
  return {
    async recognize(image) {
      engine ??= create();
      return (await engine).recognize(image);
    },
    async dispose() {
      const e = await engine?.catch(() => null);
      await e?.dispose?.();
    },
  };
}

/**
 * The confidence of the least sure piece of text in a `ppu-paddle-ocr`
 * result (`lines` of `{ text, confidence }`): one bad line makes the cell
 * doubtful. Falls back to the result's overall confidence.
 */
function leastSure(res: {
  lines?: { text?: unknown; confidence?: unknown }[][];
  confidence?: unknown;
}): number | undefined {
  const known = (res.lines ?? [])
    .flat()
    .filter((item) => String(item.text ?? "").trim())
    .flatMap((item) => (typeof item.confidence === "number" ? [item.confidence] : []));
  if (known.length) return Math.min(...known);
  return typeof res.confidence === "number" ? res.confidence : undefined;
}

/** Nearest-neighbour 2x enlargement. */
function upscale(img: OcrImage): OcrImage {
  const w = img.width * 2;
  const h = img.height * 2;
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const src = (y >> 1) * img.width;
    for (let x = 0; x < w; x++) data[y * w + x] = img.data[src + (x >> 1)]!;
  }
  return grayImage(data, w, h);
}

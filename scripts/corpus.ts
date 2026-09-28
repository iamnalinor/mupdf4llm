/**
 * Run the table extraction over an evaluation corpus and compare two runs.
 *
 *   bun scripts/corpus.ts run <outDir> [--src <path/to/src/index.ts>] [--ocr] [--only <substr>]
 *   bun scripts/corpus.ts compare <beforeDir> <afterDir>
 *
 * The corpus is scripts/corpus.json (downloaded to .corpus/cache and checked
 * against its sha256) plus every PDF in tests/fixtures. Each entry runs in
 * the configurations it lists:
 *   default — the default options (lines_strict, textSource "auto");
 *   pixels  — tableStrategy "pixels";
 *   scan    — the pages rendered to a 200 dpi grey JPEG scan, then "pixels".
 * Every configuration uses textSource "auto", so that versions with other
 * defaults compare alike. Cells that need OCR get a fixed answer, so runs
 * compare the structure and the text layer; --ocr uses the real RapidOCR
 * engine instead.
 *
 * To see what a change does, run the corpus on the base commit and on the
 * working tree, then compare:
 *
 *   git worktree add .corpus/base <base-ref>
 *   bun scripts/corpus.ts run .corpus/before --src .corpus/base/src/index.ts
 *   bun scripts/corpus.ts run .corpus/after
 *   bun scripts/corpus.ts compare .corpus/before .corpus/after
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as mupdf from "mupdf";
import type { OcrEngine, PageChunk } from "../src/index";
import { degrade } from "../tests/helpers/degrade";

type Config = "default" | "pixels" | "scan";
interface Entry {
  name: string;
  url?: string;
  path?: string;
  kind: "pdf" | "image";
  sha256?: string;
  /** 0-based pages of a PDF to keep. */
  pages?: number[];
  configs: Config[];
}
interface Table {
  rows: number;
  columns: number;
  cells: (string | null)[][];
}
type Result = { pages: { tables: Table[] }[]; error?: string };

const CACHE = ".corpus/cache";

function entries(): Entry[] {
  const manifest = JSON.parse(readFileSync("scripts/corpus.json", "utf8")) as { entries: Entry[] };
  const repo: Entry[] = readdirSync("tests/fixtures")
    .filter((f) => f.endsWith(".pdf"))
    .map((f) => ({
      name: `fixtures/${f}`,
      path: `tests/fixtures/${f}`,
      kind: "pdf",
      configs: f.startsWith("scan") ? ["pixels"] : ["default", "pixels"],
    }));
  return [...repo, ...manifest.entries];
}

async function load(e: Entry): Promise<Uint8Array> {
  if (e.path) return new Uint8Array(readFileSync(e.path));
  mkdirSync(CACHE, { recursive: true });
  const file = `${CACHE}/${e.name.replace(/[^\w.-]+/g, "_")}`;
  if (!existsSync(file)) {
    const res = await fetch(e.url!);
    if (!res.ok) throw new Error(`${e.url}: HTTP ${res.status}`);
    writeFileSync(file, new Uint8Array(await res.arrayBuffer()));
  }
  const buf = new Uint8Array(readFileSync(file));
  const sha = createHash("sha256").update(buf).digest("hex");
  // A changed file would silently change the baseline.
  if (e.sha256 && sha !== e.sha256) throw new Error("checksum differs from the manifest");
  return e.kind === "image" ? imagePdf(buf) : e.pages ? onlyPages(buf, e.pages) : buf;
}

/** A page image as a one-page PDF, sized as a 300 dpi scan. */
function imagePdf(jpg: Uint8Array): Uint8Array {
  const doc = new mupdf.PDFDocument();
  const img = new mupdf.Image(jpg);
  const W = (img.getWidth() * 72) / 300;
  const H = (img.getHeight() * 72) / 300;
  const res = doc.addObject({ XObject: { Im0: doc.addImage(img) } });
  doc.insertPage(-1, doc.addPage([0, 0, W, H], 0, res, `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q\n`));
  return doc.saveToBuffer("compress").asUint8Array().slice();
}

function onlyPages(buf: Uint8Array, pages: number[]): Uint8Array {
  const src = mupdf.PDFDocument.openDocument(buf, "application/pdf") as mupdf.PDFDocument;
  const doc = new mupdf.PDFDocument();
  for (const p of pages) doc.graftPage(-1, src, p);
  return doc.saveToBuffer("compress").asUint8Array().slice();
}

/** Every page of `buf` re-scanned (see tests/helpers/degrade). */
function scanOf(buf: Uint8Array): Uint8Array {
  const src = mupdf.PDFDocument.openDocument(buf, "application/pdf") as mupdf.PDFDocument;
  const out = new mupdf.PDFDocument();
  for (let i = 0; i < src.countPages(); i++) {
    const one = new mupdf.PDFDocument();
    one.graftPage(-1, src, i);
    const scanned = mupdf.PDFDocument.openDocument(
      degrade(one.saveToBuffer("compress").asUint8Array().slice(), {}),
      "application/pdf",
    ) as mupdf.PDFDocument;
    out.graftPage(-1, scanned, 0);
  }
  return out.saveToBuffer("compress").asUint8Array().slice();
}

async function run(outDir: string, args: string[]) {
  const at = (flag: string) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const src = resolve(at("--src") ?? "src/index.ts");
  const only = at("--only");
  const lib = (await import(src)) as typeof import("../src/index");
  const ocr: OcrEngine = args.includes("--ocr")
    ? await lib.createRapidOcr()
    : { recognize: async () => "ocr" };
  mkdirSync(outDir, { recursive: true });
  for (const e of entries()) {
    if (only && !e.name.includes(only)) continue;
    let buf: Uint8Array;
    try {
      buf = await load(e);
    } catch (err) {
      console.warn(`! ${e.name}: ${String(err)}`);
      continue;
    }
    for (const config of e.configs) {
      const t = performance.now();
      const result: Result = { pages: [] };
      try {
        const input = config === "scan" ? scanOf(buf) : buf;
        const pages: PageChunk[] = await lib.toMarkdownPages(input, {
          ...(config === "default" ? {} : { tableStrategy: "pixels" as const }),
          textSource: "auto",
          ocr,
        });
        result.pages = pages.map((p) => ({
          tables: p.tables.map((tab) => ({
            rows: tab.rows,
            columns: tab.columns,
            cells: tab.cells.map((r) => r.map((c) => (c ? c.text : null))),
          })),
        }));
      } catch (err) {
        result.error = String(err);
      }
      const file = `${outDir}/${e.name.replace(/[^\w.-]+/g, "_")}__${config}.json`;
      writeFileSync(file, JSON.stringify(result));
      const shapes = result.pages.map(
        (p) => p.tables.map((x) => `${x.rows}x${x.columns}`).join("+") || "-",
      );
      console.log(
        `${e.name} [${config}] ${Math.round(performance.now() - t)}ms ${result.error ?? shapes.join(" ")}`,
      );
    }
  }
  await ocr.dispose?.();
}

function compare(a: string, b: string) {
  const files = [...new Set([...readdirSync(a), ...readdirSync(b)])]
    .filter((f) => f.endsWith(".json"))
    .sort();
  let same = 0;
  let changed = 0;
  for (const f of files) {
    const read = (d: string): Result | null =>
      existsSync(`${d}/${f}`) ? (JSON.parse(readFileSync(`${d}/${f}`, "utf8")) as Result) : null;
    const x = read(a);
    const y = read(b);
    if (!x || !y) {
      console.log(`${f}: only in ${x ? "before" : "after"}`);
      continue;
    }
    const notes: string[] = [];
    if (x.error !== y.error) notes.push(`error: ${x.error ?? "none"} -> ${y.error ?? "none"}`);
    const n = Math.max(x.pages.length, y.pages.length);
    for (let p = 0; p < n; p++) {
      const tx = x.pages[p]?.tables ?? [];
      const ty = y.pages[p]?.tables ?? [];
      const shape = (t: Table[]) => t.map((q) => `${q.rows}x${q.columns}`).join("+") || "-";
      if (shape(tx) !== shape(ty)) {
        notes.push(`p${p + 1} tables ${shape(tx)} -> ${shape(ty)}`);
        continue;
      }
      let diff = 0;
      let total = 0;
      tx.forEach((t, i) =>
        t.cells.forEach((r, ri) =>
          r.forEach((c, ci) => {
            total++;
            if (c !== ty[i]!.cells[ri]![ci]) diff++;
          }),
        ),
      );
      if (diff) notes.push(`p${p + 1} ${diff}/${total} cells differ`);
    }
    if (notes.length) {
      changed++;
      console.log(`${f}: ${notes.join("; ")}`);
    } else same++;
  }
  console.log(`\n${same} unchanged, ${changed} changed`);
}

const [cmd, x, ...rest] = process.argv.slice(2);
if (cmd === "run" && x) await run(x, rest);
else if (cmd === "compare" && x && rest[0]) compare(x, rest[0]);
else
  console.log(
    "usage: bun scripts/corpus.ts run <outDir> [--src <index.ts>] [--ocr] [--only <substr>]\n       bun scripts/corpus.ts compare <before> <after>",
  );

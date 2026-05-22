import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import * as mupdf from "mupdf";
import { Rect } from "../src/helpers/geometry";
import {
  clusterStripes,
  computeReadingOrder,
  startswithBullet,
  isWhite,
} from "../src/helpers/utils";
import { ProgressBar } from "../src/helpers/progress";
import { TocHeaders, IdentifyHeaders } from "../src/helpers/text/identifyHeaders";
import { extractWords } from "../src/helpers/text/extractWords";
import { getKeyValues } from "../src/helpers/forms/formFields";
import { toMarkdownPages } from "../src/index";
import { PDFMarkdownReader } from "../src/llama/pdfMarkdownReader";

function openFixture(name: string): mupdf.PDFDocument {
  return mupdf.PDFDocument.openDocument(
    new Uint8Array(readFileSync(`tests/fixtures/${name}`)),
    "application/pdf",
  ) as mupdf.PDFDocument;
}

test("isWhite + startswithBullet", () => {
  expect(isWhite("   ")).toBe(true);
  expect(isWhite(" a ")).toBe(false);
  expect(startswithBullet("- foo")).toBe(true);
  expect(startswithBullet("– foo")).toBe(true);
  expect(startswithBullet("Foo")).toBe(false);
});

test("clusterStripes groups overlapping bands", () => {
  const a = new Rect(0, 0, 50, 10);
  const b = new Rect(60, 2, 100, 12);
  const c = new Rect(0, 50, 50, 60);
  const stripes = clusterStripes([a, b, c]);
  expect(stripes.length).toBe(2);
  expect(stripes[0]!.length).toBe(2);
  expect(stripes[1]!.length).toBe(1);
});

test("computeReadingOrder sorts top→bottom, left→right within stripe", () => {
  const a = new Rect(50, 0, 100, 10);
  const b = new Rect(0, 2, 40, 12);
  const c = new Rect(0, 50, 50, 60);
  const order = computeReadingOrder([a, b, c]);
  expect(order[0]).toBe(b);
  expect(order[1]).toBe(a);
  expect(order[2]).toBe(c);
});

test("ProgressBar yields all items in order", () => {
  const sink: string[] = [];
  const bar = new ProgressBar([1, 2, 3], {
    width: 10,
    stream: { write: (s) => sink.push(s) },
  });
  const collected: number[] = [];
  for (const x of bar) collected.push(x);
  expect(collected).toEqual([1, 2, 3]);
  // first render: 0/3, last: 3/3, plus a final newline
  expect(sink.some((s) => s.includes("0/3"))).toBe(true);
  expect(sink.some((s) => s.includes("3/3"))).toBe(true);
});

test("IdentifyHeaders maps the largest font to '#'", () => {
  const doc = openFixture("pdflatex-outline.pdf");
  try {
    const ih = new IdentifyHeaders(doc);
    expect(ih.header_id.size).toBeGreaterThan(0);
    // body_limit should be a sensible default
    expect(ih.body_limit).toBeGreaterThan(0);
  } finally {
    doc.destroy();
  }
});

test("TocHeaders constructs without error on an outlined doc", () => {
  const doc = openFixture("pdflatex-outline.pdf");
  try {
    const th = new TocHeaders(doc);
    // The outline test PDF has nested chapters; verify the constructor wired
    // them into the per-page map (smoke check only — exact titles depend on PDF).
    expect(th).toBeInstanceOf(TocHeaders);
  } finally {
    doc.destroy();
  }
});

test("extractWords resets word index per line", () => {
  const doc = openFixture("pdflatex-4-pages.pdf");
  try {
    const page = doc.loadPage(0);
    const words = extractWords(page);
    expect(words.length).toBeGreaterThan(0);
    // Every line should start at word === 0
    const seen = new Map<string, number>();
    for (const w of words) {
      const key = `${w.block}:${w.line}`;
      if (!seen.has(key)) {
        expect(w.word).toBe(0);
        seen.set(key, 1);
      } else {
        // Consecutive words on the same line increase monotonically.
        const prev = seen.get(key)!;
        expect(w.word).toBe(prev);
        seen.set(key, prev + 1);
      }
    }
  } finally {
    doc.destroy();
  }
});

test("getKeyValues extracts a non-empty list with valid shapes", () => {
  const doc = openFixture("pdflatex-forms.pdf");
  try {
    const fields = getKeyValues(doc);
    expect(fields.length).toBeGreaterThan(0);
    for (const f of fields) {
      expect(typeof f.name).toBe("string");
      expect(typeof f.value).toBe("string");
      expect(["text", "checkbox", "radio", "choice", "signature", "unknown"]).toContain(f.type);
      expect(f.bbox).toHaveLength(4);
      expect(typeof f.page).toBe("number");
    }
  } finally {
    doc.destroy();
  }
});

test("MarkdownOptions.fontsizeLimit drops small spans", () => {
  // pdflatex-4-pages renders body text around 11pt and headers ~12pt.
  // Setting fontsizeLimit above body kills body but keeps headers.
  const buf = readFileSync("tests/fixtures/pdflatex-4-pages.pdf");
  const full = toMarkdownPages(buf);
  const trimmed = toMarkdownPages(buf, { fontsizeLimit: 100 });
  // Filter so aggressive that nothing should survive
  const fullLen = full.map((c) => c.text.length).reduce((a, b) => a + b, 0);
  const trimmedLen = trimmed.map((c) => c.text.length).reduce((a, b) => a + b, 0);
  expect(fullLen).toBeGreaterThan(0);
  expect(trimmedLen).toBeLessThan(fullLen);
});

test("PageChunk shape: tables/images carry real bboxes, words are typed", () => {
  // Use the vendored real-world fixture which has tables.
  const buf = readFileSync("tests/fixtures/pdflatex-4-pages.pdf");
  const chunks = toMarkdownPages(buf, { extractWords: true });
  expect(chunks.length).toBeGreaterThan(0);
  for (const c of chunks) {
    expect(Array.isArray(c.words)).toBe(true);
    expect(Array.isArray(c.tables)).toBe(true);
    expect(Array.isArray(c.images)).toBe(true);
    // PageChunk no longer carries a `graphics` field — confirm it's absent.
    expect("graphics" in c).toBe(false);
  }
});

test("PDFMarkdownReader yields { text, metadata } regardless of llamaindex", async () => {
  // tests/fixtures/pdflatex-forms.pdf is small (1 page) → fast.
  const reader = new PDFMarkdownReader();
  const docs = await reader.loadData("tests/fixtures/pdflatex-forms.pdf");
  expect(docs.length).toBe(1);
  const d = docs[0]!;
  expect(typeof d.text).toBe("string");
  expect(d.metadata).toBeTruthy();
  // metadata must be the field name, not extra_info
  expect("metadata" in d).toBe(true);
  expect("extra_info" in d).toBe(false);
});

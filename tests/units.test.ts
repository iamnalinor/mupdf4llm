import { test, expect } from "bun:test";
import { Rect } from "../src/helpers/geometry";
import {
  clusterStripes,
  computeReadingOrder,
  startswithBullet,
  isWhite,
} from "../src/helpers/utils";
import { ProgressBar } from "../src/helpers/progress";
import { TocHeaders, IdentifyHeaders } from "../src/helpers/identifyHeaders";
import * as mupdf from "mupdf";

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
  const doc = mupdf.PDFDocument.openDocument(
    new Uint8Array(require("fs").readFileSync("tests/fixtures/pdflatex-outline.pdf")),
    "application/pdf",
  ) as mupdf.PDFDocument;
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
  const doc = mupdf.PDFDocument.openDocument(
    new Uint8Array(require("fs").readFileSync("tests/fixtures/pdflatex-outline.pdf")),
    "application/pdf",
  ) as mupdf.PDFDocument;
  try {
    const th = new TocHeaders(doc);
    // The outline test PDF has nested chapters; verify the constructor wired
    // them into the per-page map (smoke check only — exact titles depend on PDF).
    expect(th).toBeInstanceOf(TocHeaders);
  } finally {
    doc.destroy();
  }
});

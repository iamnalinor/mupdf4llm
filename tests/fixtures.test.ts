import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { toMarkdown } from "../src/index";

const SYNTH_DIR = "/tmp/mupdf4llm-fixtures";
const VENDORED_DIR = "tests/fixtures";

/**
 * Parity tests shell out to `python3 -c "import pymupdf4llm; ..."` to compare
 * against the upstream reference. Skip every parity assertion if Python or
 * pymupdf4llm isn't installed — this keeps `bun test` green for JS-only
 * contributors.
 */
const HAS_PYMUPDF = (() => {
  try {
    execSync('python3 -c "import pymupdf4llm"', { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const testIf = HAS_PYMUPDF ? test : test.skip;

function pyMarkdown(file: string): string {
  return execSync(
    `python3 -c "import pymupdf4llm; pymupdf4llm.use_layout(False); import sys; sys.stdout.write(pymupdf4llm.to_markdown('${file}'))"`,
    { maxBuffer: 16 * 1024 * 1024 },
  ).toString();
}

// ---------------------------------------------------------------------------
// Synthetic fixtures: programmatically generated with PyMuPDF, byte-for-byte
// parity asserted against pymupdf4llm.to_markdown.
// ---------------------------------------------------------------------------

function ensureSyntheticFixtures() {
  if (existsSync(`${SYNTH_DIR}/simple.pdf`) && existsSync(`${SYNTH_DIR}/tableWrapped.pdf`)) return;
  mkdirSync(SYNTH_DIR, { recursive: true });
  execSync(`python3 - <<'EOF'
import pymupdf
doc = pymupdf.open()
page = doc.new_page()
page.insert_text((50, 80), 'Hello World', fontsize=24)
page.insert_text((50, 120), 'Body paragraph text.', fontsize=12)
page.insert_text((50, 160), 'Another body line.', fontsize=12)
doc.save('${SYNTH_DIR}/simple.pdf')

doc = pymupdf.open()
page = doc.new_page()
page.insert_text((50, 80), 'Document Title', fontsize=28)
page.insert_text((50, 120), 'Introduction', fontsize=20)
page.insert_text((50, 160), 'Normal body text demonstrating basic flow.', fontsize=11)
page.insert_text((50, 220), chr(0x2022) + ' First bullet item', fontsize=11)
page.insert_text((50, 240), chr(0x2022) + ' Second bullet', fontsize=11)
page.insert_text((50, 300), 'Conclusion', fontsize=18)
page.insert_text((50, 330), 'Final paragraph.', fontsize=11)
doc.save('${SYNTH_DIR}/medium.pdf')

doc = pymupdf.open()
for i in range(3):
    p = doc.new_page()
    p.insert_text((50, 80), f'Page {i+1} Title', fontsize=24)
    p.insert_text((50, 120), 'Body text on this page.', fontsize=11)
    p.insert_text((50, 200), 'Subsection', fontsize=16)
    p.insert_text((50, 230), 'Sub body content.', fontsize=11)
doc.save('${SYNTH_DIR}/multi.pdf')

doc = pymupdf.open()
page = doc.new_page()
page.insert_text((50, 80), 'Table Test', fontsize=20)
for y in (120, 145, 170, 195, 220):
    page.draw_line((50, y), (450, y))
for x in (50, 180, 310, 450):
    page.draw_line((x, 120), (x, 220))
page.insert_text((60, 140), 'Name', fontsize=12)
page.insert_text((190, 140), 'Age', fontsize=12)
page.insert_text((320, 140), 'City', fontsize=12)
page.insert_text((60, 165), 'Alice', fontsize=11)
page.insert_text((190, 165), '30', fontsize=11)
page.insert_text((320, 165), 'NYC', fontsize=11)
page.insert_text((60, 190), 'Bob', fontsize=11)
page.insert_text((190, 190), '25', fontsize=11)
page.insert_text((320, 190), 'LA', fontsize=11)
page.insert_text((60, 215), 'Charlie', fontsize=11)
page.insert_text((190, 215), '35', fontsize=11)
page.insert_text((320, 215), 'SF', fontsize=11)
page.insert_text((50, 260), 'After the table.', fontsize=11)
doc.save('${SYNTH_DIR}/table.pdf')

# Wrapped-cell table — exercises the >50% char-overlap dedup in
# extractCellText. Each org-name cell holds two visual lines that nearly
# touch the row boundary; the school-column cell on row 2 holds three.
# Without the fix, the trailing visual line is duplicated and/or leaks into
# the neighbour cell.
doc = pymupdf.open()
page = doc.new_page()
xs = [40, 80, 320, 555]
ys = [60, 80, 130, 195, 260]
for y in ys:
    page.draw_line((xs[0], y), (xs[-1], y))
for x in xs:
    page.draw_line((x, ys[0]), (x, ys[-1]))
# Header row (bold via font name; renders as plain in Python's header.names).
page.insert_text((xs[0] + 4, ys[0] + 14), '#', fontsize=10, fontname='Helvetica-Bold')
page.insert_text((xs[1] + 4, ys[0] + 14), 'Organisation', fontsize=10, fontname='Helvetica-Bold')
page.insert_text((xs[2] + 4, ys[0] + 14), 'Score', fontsize=10, fontname='Helvetica-Bold')
# Row 1 — wrapped on 2 lines.
page.insert_text((xs[0] + 4, ys[1] + 14), '1', fontsize=10)
page.insert_text((xs[1] + 4, ys[1] + 14), 'State Budgetary Educational Institution', fontsize=10)
page.insert_text((xs[1] + 4, ys[1] + 30), 'No. 548 "Tsaritsyno"', fontsize=10)
page.insert_text((xs[2] + 4, ys[1] + 14), '86.8', fontsize=10)
# Row 2 — wrapped on 3 lines.
page.insert_text((xs[0] + 4, ys[2] + 14), '2', fontsize=10)
page.insert_text((xs[1] + 4, ys[2] + 14), 'Autonomous Non-Profit General', fontsize=10)
page.insert_text((xs[1] + 4, ys[2] + 30), 'Educational Organisation', fontsize=10)
page.insert_text((xs[1] + 4, ys[2] + 46), 'School "LETOVO"', fontsize=10)
page.insert_text((xs[2] + 4, ys[2] + 14), '71.8', fontsize=10)
# Row 3 — wrapped on 2 lines, different org.
page.insert_text((xs[0] + 4, ys[3] + 14), '3', fontsize=10)
page.insert_text((xs[1] + 4, ys[3] + 14), 'Lyceum of Innovative Technologies', fontsize=10)
page.insert_text((xs[1] + 4, ys[3] + 30), '(Khabarovsk)', fontsize=10)
page.insert_text((xs[2] + 4, ys[3] + 14), '64.3', fontsize=10)
doc.save('${SYNTH_DIR}/tableWrapped.pdf')
EOF`);
}

describe("synthetic fixtures (byte parity vs pymupdf4llm)", () => {
  for (const name of ["simple", "medium", "multi", "table", "tableWrapped"]) {
    testIf(`${name}.pdf`, () => {
      ensureSyntheticFixtures();
      const file = `${SYNTH_DIR}/${name}.pdf`;
      const buf = readFileSync(file);
      const ts = toMarkdown(buf);
      const py = pyMarkdown(file);
      if (ts !== py) {
        writeFileSync(`/tmp/${name}-ts.md`, ts);
        writeFileSync(`/tmp/${name}-py.md`, py);
      }
      expect(ts).toBe(py);
    });
  }
});

// ---------------------------------------------------------------------------
// Vendored fixtures: real-world PDFs covering features that synthetic
// fixtures don't (LaTeX ligatures, outlines, AcroForm widgets, multi-column,
// rotation, multi-line table cells).
//
//   - exact:    TS output must byte-equal pymupdf4llm.to_markdown
//   - similar:  TS output within ±5% of Python's length, both non-empty
//   - smoke:    only assert no crash and non-empty output (used for fixtures
//               where PyMuPDF and JS mupdf diverge in known ways)
//
// Provenance — all PDFs are public domain or MIT-derived test fixtures:
//   - py-pdf/sample-files (MIT): pdflatex-*.pdf, multicolumn.pdf,
//     cropped-rotated-scaled.pdf.
//   - jsvine/pdfplumber (MIT) / FBI (US gov, 17 USC §105 public domain):
//     nics-background-checks-2015-11.pdf.
// ---------------------------------------------------------------------------

type Mode = "exact" | "similar" | "smoke";

interface Fixture {
  name: string;
  mode: Mode;
  note?: string;
}

const VENDORED: Fixture[] = [
  { name: "pdflatex-forms.pdf", mode: "exact" },
  {
    name: "pdflatex-4-pages.pdf",
    mode: "similar",
    note: "matches len exactly; diverges on en-dash → '- ' bullet substitution (span-grouping difference vs PyMuPDF)",
  },
  {
    name: "pdflatex-outline.pdf",
    mode: "similar",
    note: "same en-dash / span-grouping divergence as pdflatex-4-pages",
  },
  {
    name: "multicolumn.pdf",
    mode: "similar",
    note: "diverges in the table near the end (column header grouping)",
  },
  {
    name: "cropped-rotated-scaled.pdf",
    mode: "smoke",
    note: "we unrotate by default → much more content extracted than Python's default; intentional behavior gap",
  },
  {
    name: "nics-background-checks-2015-11.pdf",
    mode: "smoke",
    note: "heavy multi-line table cells; covers the >50% char-overlap dedup path in extractCellText. Smoke-only because column-boundary detection still diverges (separate parity gap)",
  },
];

describe("vendored fixtures", () => {
  for (const f of VENDORED) {
    const path = `${VENDORED_DIR}/${f.name}`;
    // Smoke = TS-only sanity check, run regardless of Python.
    // exact / similar = compare against pymupdf4llm, skip when Python missing.
    const runner = f.mode === "smoke" ? test : testIf;
    runner(
      `${f.name} (${f.mode})`,
      () => {
        if (!existsSync(path)) {
          throw new Error(`missing fixture ${path}`);
        }
        const buf = readFileSync(path);
        const ts = toMarkdown(buf);
        expect(ts.length).toBeGreaterThan(0);

        if (f.mode === "smoke") return;

        const py = pyMarkdown(path);
        if (f.mode === "exact") {
          expect(ts).toBe(py);
          return;
        }

        // "similar": length within ±5%, both non-empty
        expect(py.length).toBeGreaterThan(0);
        const ratio = ts.length / py.length;
        expect(ratio).toBeGreaterThan(0.95);
        expect(ratio).toBeLessThan(1.05);
      },
      30_000,
    );
  }
});

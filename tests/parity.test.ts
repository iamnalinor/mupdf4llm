import { test, expect } from "bun:test";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { toMarkdown } from "../src/index.ts";

const FIXTURES = "/tmp/mupdf4llm-fixtures";

function ensureFixtures() {
  if (existsSync(`${FIXTURES}/simple.pdf`)) return;
  mkdirSync(FIXTURES, { recursive: true });
  execSync(`python3 - <<'EOF'
import pymupdf
doc = pymupdf.open()
page = doc.new_page()
page.insert_text((50, 80), 'Hello World', fontsize=24)
page.insert_text((50, 120), 'Body paragraph text.', fontsize=12)
page.insert_text((50, 160), 'Another body line.', fontsize=12)
doc.save('${FIXTURES}/simple.pdf')

doc = pymupdf.open()
page = doc.new_page()
page.insert_text((50, 80), 'Document Title', fontsize=28)
page.insert_text((50, 120), 'Introduction', fontsize=20)
page.insert_text((50, 160), 'Normal body text demonstrating basic flow.', fontsize=11)
page.insert_text((50, 220), chr(0x2022) + ' First bullet item', fontsize=11)
page.insert_text((50, 240), chr(0x2022) + ' Second bullet', fontsize=11)
page.insert_text((50, 300), 'Conclusion', fontsize=18)
page.insert_text((50, 330), 'Final paragraph.', fontsize=11)
doc.save('${FIXTURES}/medium.pdf')

doc = pymupdf.open()
for i in range(3):
    p = doc.new_page()
    p.insert_text((50, 80), f'Page {i+1} Title', fontsize=24)
    p.insert_text((50, 120), 'Body text on this page.', fontsize=11)
    p.insert_text((50, 200), 'Subsection', fontsize=16)
    p.insert_text((50, 230), 'Sub body content.', fontsize=11)
doc.save('${FIXTURES}/multi.pdf')
EOF`);
}

function pyMarkdown(file: string): string {
  return execSync(
    `python3 -c "import pymupdf4llm; pymupdf4llm.use_layout(False); import sys; sys.stdout.write(pymupdf4llm.to_markdown('${file}'))"`,
    { maxBuffer: 16 * 1024 * 1024 },
  ).toString();
}

for (const name of ["simple", "medium", "multi"]) {
  test(`parity: ${name}.pdf`, () => {
    ensureFixtures();
    const file = `${FIXTURES}/${name}.pdf`;
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

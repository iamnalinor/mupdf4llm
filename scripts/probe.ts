import { readFileSync } from "node:fs";
import { toMarkdown } from "../src/index";

const file = process.argv[2];
if (!file) {
  console.error("usage: bun scripts/probe.ts <file.pdf>");
  process.exit(1);
}
const buf = readFileSync(file);
const md = toMarkdown(buf);
process.stdout.write(md);

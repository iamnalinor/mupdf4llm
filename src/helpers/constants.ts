export const REPLACEMENT_CHARACTER = "�";
export const TYPE3_FONT_NAME = "Type3";
export const TESSERACT_FONT_NAME = "GlyphLessFont";

const whiteList = [
  ...Array.from({ length: 33 }, (_, i) => String.fromCharCode(i)),
  " ",
  " ",
  " ",
  " ",
  " ",
  " ",
  " ",
  " ",
  " ",
  " ",
  " ",
  " ",
  " ",
  " ",
  "　",
];
export const WHITE_CHARS: ReadonlySet<string> = new Set(whiteList);

const bulletList = [
  0x2a, 0x2d, 0x3e, 0x6f, 0xb6, 0xb7, 0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2020,
  0x2021, 0x2022, 0x2212, 0x2219, 0xf0a7, 0xf0b7,
].map((c) => String.fromCharCode(c));
for (let i = 0x25a0; i < 0x2600; i++) bulletList.push(String.fromCharCode(i));
bulletList.push(REPLACEMENT_CHARACTER);
export const BULLETS: ReadonlySet<string> = new Set(bulletList);

// PyMuPDF span flag bits
export const FLAG_SUPERSCRIPT = 1;
export const FLAG_ITALIC = 2;
export const FLAG_SERIF = 4;
export const FLAG_MONOSPACED = 8;
export const FLAG_BOLD = 16;

// PyMuPDF char_flags bits (from MuPDF FZ_STEXT_*)
export const CHAR_STRIKEOUT = 1;
export const CHAR_UNDERLINE = 2;
export const CHAR_SYNTHETIC = 4;
export const CHAR_BOLD = 8;
export const CHAR_FILLED = 16;
export const CHAR_STROKED = 32;

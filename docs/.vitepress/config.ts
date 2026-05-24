import { defineConfig } from "vitepress";

export default defineConfig({
  title: "mupdf4llm",
  description: "TypeScript port of pymupdf4llm — convert PDFs to LLM-ready Markdown.",
  base: "/mupdf4llm/",
  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: "localhostLinks",
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Reference", link: "/reference/" },
      { text: "Examples", link: "/examples/basic" },
      {
        text: "Changelog",
        link: "https://github.com/iamnalinor/mupdf4llm/blob/main/CHANGELOG.md",
      },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "Getting started",
          items: [
            { text: "Overview", link: "/guide/getting-started" },
            { text: "Installation", link: "/guide/installation" },
            { text: "Quick start", link: "/guide/quick-start" },
          ],
        },
        {
          text: "Features",
          items: [
            { text: "Options", link: "/guide/options" },
            { text: "Headers", link: "/guide/headers" },
            { text: "Tables", link: "/guide/tables" },
            { text: "Images", link: "/guide/images" },
            { text: "Words & chunks", link: "/guide/words-and-chunks" },
            { text: "Form fields", link: "/guide/form-fields" },
            { text: "Page rotation", link: "/guide/page-rotation" },
            { text: "Progress bar", link: "/guide/progress" },
            { text: "LlamaIndex adapter", link: "/guide/llamaindex" },
          ],
        },
        {
          text: "Reference",
          items: [{ text: "Parity & limits", link: "/guide/parity-and-limits" }],
        },
      ],
      "/reference/": [
        {
          text: "API reference",
          items: [{ text: "Overview", link: "/reference/" }],
        },
      ],
      "/examples/": [
        {
          text: "Examples",
          items: [
            { text: "Basic usage", link: "/examples/basic" },
            { text: "RAG pipeline", link: "/examples/rag-pipeline" },
            { text: "LlamaIndex", link: "/examples/llama-rag" },
            { text: "Extract images", link: "/examples/extract-images" },
            { text: "Form fields", link: "/examples/form-fields" },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/iamnalinor/mupdf4llm" },
      { icon: "npm", link: "https://www.npmjs.com/package/@nalinor/mupdf4llm" },
    ],
    editLink: {
      pattern: "https://github.com/iamnalinor/mupdf4llm/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },
    search: { provider: "local" },
    footer: {
      message: "AGPL-3.0-or-later — inherited from PyMuPDF and pymupdf4llm.",
      copyright: "© Artifex Software (MuPDF) and the pymupdf4llm authors.",
    },
  },
});

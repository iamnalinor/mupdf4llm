#!/usr/bin/env python3
import sys
import pymupdf4llm
pymupdf4llm.use_layout(False)
md = pymupdf4llm.to_markdown(sys.argv[1])
sys.stdout.write(md)

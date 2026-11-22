#!/usr/bin/env python3
"""Build index.html: inline src/engine.js into src/app.template.html and wrap it in a standalone HTML document."""
from pathlib import Path
root = Path(__file__).parent
tpl = (root / "src/app.template.html").read_text()
eng = (root / "src/engine.js").read_text()
assert "</script" not in eng
head = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
        '<style>body{margin:0;font-size:14px}img{max-width:100%}[hidden]{display:none!important}</style>\n'
        '</head>\n<body>\n')
(root / "index.html").write_text(head + tpl.replace("/*ENGINE*/", eng) + "\n</body>\n</html>\n")
print("wrote index.html")

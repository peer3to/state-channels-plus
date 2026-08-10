#!/usr/bin/env python3
"""Generate reference/traceability-index.md from the per-document traceability tables.

Usage: python3 docs/spec/claude/tools/gen-traceability-index.py
Run from anywhere; paths are resolved relative to this script.

Definition source: any markdown table row whose first cell is exactly one ID
(e.g. `| INV-SM-1 | statement | impl | evidence |`). Every other occurrence of
the ID anywhere in the tree is recorded as a reference. The script fails loudly
on duplicate definitions and lists IDs that are mentioned but never defined.
"""

import os
import re
import sys
from collections import defaultdict

SPEC_ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
OUT_PATH = os.path.join(SPEC_ROOT, "reference", "traceability-index.md")
ID_RE = re.compile(r"\b(?:INV|REQ)-[A-Z]+-\d+\b")
ROW_RE = re.compile(r"^\|\s*`?((?:INV|REQ)-[A-Z]+-\d+)`?\s*\|(.*)$")

def md_files():
    for root, _, files in os.walk(SPEC_ROOT):
        if os.path.basename(root) == "tools":
            continue
        for f in sorted(files):
            if f.endswith(".md"):
                yield os.path.join(root, f)

def relpath(p):
    return os.path.relpath(p, SPEC_ROOT).replace(os.sep, "/")

def strip_md(cell):
    cell = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", cell)  # links -> text
    cell = cell.replace("`", "").replace("**", "").strip()
    return re.sub(r"\s+", " ", cell)

definitions = {}          # id -> (relpath, statement)
duplicates = []           # (id, first_path, dup_path)
mentions = defaultdict(set)  # id -> set of relpaths

index_rel = "reference/traceability-index.md"

for path in md_files():
    rp = relpath(path)
    if rp == index_rel:
        continue
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    for ident in ID_RE.findall(text):
        mentions[ident].add(rp)
    for line in text.splitlines():
        m = ROW_RE.match(line.strip())
        if not m:
            continue
        ident = m.group(1)
        cells = [c.strip() for c in m.group(2).split("|")]
        statement = strip_md(cells[0]) if cells else ""
        if ident in definitions and definitions[ident][0] != rp:
            duplicates.append((ident, definitions[ident][0], rp))
        elif ident not in definitions:
            definitions[ident] = (rp, statement)

undefined = sorted(i for i in mentions if i not in definitions)

def sort_key(ident):
    kind, area, num = ident.split("-")
    return (area, kind, int(num))

lines = []
lines.append("# Traceability Index")
lines.append("")
lines.append("> **Status:** Generated. Do not edit by hand — regenerate with")
lines.append("> `python3 docs/spec/claude/tools/gen-traceability-index.py` after changing any")
lines.append("> traceability table. ID scheme: [governance.md §2](../governance.md#traceability).")
lines.append("")
lines.append("Single collection point for every `INV-*` / `REQ-*` ID in the specification tree.")
lines.append("**Defined in** is the document whose traceability table owns the ID (statement,")
lines.append("implementation, and verification evidence live there). **Referenced in** lists every")
lines.append("other document that mentions the ID.")
lines.append("")

by_area = defaultdict(list)
for ident in sorted(definitions, key=sort_key):
    by_area[ident.split("-")[1]].append(ident)

total = len(definitions)
lines.append(f"{total} IDs across {len(by_area)} areas.")
lines.append("")

for area in sorted(by_area):
    lines.append(f"## {area}")
    lines.append("")
    lines.append("| ID | Statement | Defined in | Referenced in |")
    lines.append("| --- | --- | --- | --- |")
    for ident in by_area[area]:
        def_path, statement = definitions[ident]
        refs = sorted(mentions[ident] - {def_path})
        ref_links = ", ".join(f"[{r}](../{r})" for r in refs) if refs else "—"
        if len(statement) > 160:
            statement = statement[:157] + "..."
        statement = statement.replace("|", "\\|")
        lines.append(f"| `{ident}` | {statement} | [{def_path}](../{def_path}) | {ref_links} |")
    lines.append("")

if undefined:
    lines.append("## Mentioned but not defined")
    lines.append("")
    lines.append("IDs used somewhere in the tree without a defining traceability-table row —")
    lines.append("each needs a definition or the mention removed:")
    lines.append("")
    for ident in undefined:
        where = ", ".join(f"[{r}](../{r})" for r in sorted(mentions[ident]))
        lines.append(f"- `{ident}` — {where}")
    lines.append("")

os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
with open(OUT_PATH, "w", encoding="utf-8") as fh:
    fh.write("\n".join(lines) + "\n")

print(f"wrote {relpath(OUT_PATH)}: {total} IDs, {len(undefined)} undefined mentions")
for ident, first, dup in duplicates:
    print(f"DUPLICATE definition: {ident} in {first} and {dup}", file=sys.stderr)
if duplicates:
    sys.exit(1)

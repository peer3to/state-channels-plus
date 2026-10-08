"use strict";

const { TEST_PLAN_ITEM_RE, PERMUTATION_RE } = require("./id-utils");

function identityFromCell(cell) {
    return cell
        .replace(/<[^>]+>/g, "")
        .replace(/`/g, "")
        .trim();
}

function prosePlanEntries(lines, document) {
    const tables = [];
    const headers = [
        "plan item",
        "requirements / invariants",
        "setup and stimulus",
        "expected result",
        "required permutations"
    ];
    for (let index = 0; index < lines.length; index += 1) {
        const heading = /^(#{1,6})\s+(.+)$/.exec(lines[index]);
        if (
            !heading ||
            !/^(?:<a id="[^"]+"><\/a>)?`[^`]+`$/.test(heading[2]) ||
            !TEST_PLAN_ITEM_RE.test(identityFromCell(heading[2]))
        )
            continue;
        const start = index;
        const cells = [heading[2], "", "", "", ""];
        const definitions = [{ id: identityFromCell(heading[2]), line: start }];
        const seen = new Set();
        let field = -1;
        while (
            index + 1 < lines.length &&
            !/^#{1,6}\s/.test(lines[index + 1])
        ) {
            index += 1;
            const label = /^\*\*([^*]+):\*\*\s*(.*)$/.exec(lines[index]);
            if (label) {
                field = headers.indexOf(label[1].toLowerCase());
                if (field > 0) {
                    seen.add(field);
                    cells[field] = label[2];
                }
            } else if (field > 0 && lines[index].trim()) {
                cells[field] +=
                    (cells[field] ? "\n" : "") + lines[index].trim();
            }
            if (field === 4) {
                const definition = label ? label[2] : lines[index].trim();
                const permutation =
                    /^(?:<a id="[^"]+"><\/a>)?`([^`]+)`(?:\s|$)/.exec(
                        definition
                    );
                if (permutation && PERMUTATION_RE.test(permutation[1]))
                    definitions.push({ id: permutation[1], line: index });
            }
        }
        if (seen.size !== headers.length - 1) {
            throw new Error(
                `Incomplete planned test at ${document}:${start + 1}`
            );
        }
        tables.push({
            definitions,
            headers,
            rows: [
                {
                    line: start + 1,
                    cells,
                    raw: lines.slice(start, index + 1).join("\n")
                }
            ]
        });
    }
    return tables;
}

module.exports = { prosePlanEntries };

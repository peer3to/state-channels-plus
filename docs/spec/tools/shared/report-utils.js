"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { buildIdRegistry, linkIdReferences } = require("./id-registry");
const { anchorForId } = require("./id-utils");

let registry;

function idRegistry() {
    if (!registry) registry = buildIdRegistry();
    return registry;
}

function parseReportArgs(argv = process.argv.slice(2)) {
    const allowed = new Set(["--check", "--strict", "--fix"]);
    for (const argument of argv) {
        if (!allowed.has(argument))
            throw new Error(`unknown argument: ${argument}`);
    }
    return {
        check: argv.includes("--check"),
        strict: argv.includes("--strict"),
        fix: argv.includes("--fix")
    };
}

async function writeOrCheckReport(target, markdown, options) {
    // Deliberately unformatted: prettier pads table columns to the widest
    // cell, so a one-cell edit rewrites every row of the table. Generated
    // reports stay compact (docs/spec/generated is in .prettierignore).
    const report =
        linkIdReferences(markdown, target, idRegistry()).trimEnd() + "\n";
    const current = fs.existsSync(target)
        ? fs.readFileSync(target, "utf8")
        : null;
    if (options.check) {
        if (current !== report) {
            process.stderr.write(`stale generated report: ${target}\n`);
            return false;
        }
        return true;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, report);
    return true;
}

function escapeCell(value) {
    return (
        String(value ?? "—")
            .replaceAll("|", "\\|")
            .replace(/\r?\n/g, " ")
            .trim() || "—"
    );
}

function relativeTarget(from, target) {
    let relative = path
        .relative(path.dirname(from), target)
        .split(path.sep)
        .join("/");
    if (!relative.startsWith(".")) relative = `./${relative}`;
    return relative;
}

function relativeLink(from, target, label, line = null) {
    const relative = relativeTarget(from, target);
    return `[${label}](${relative}${line === null ? "" : `#L${line}`})`;
}

function relativeAnchorLink(from, target, label, anchor) {
    return `[${label}](${relativeTarget(from, target)}#${anchor})`;
}

function relativeIdLink(from, label, id) {
    const definition = idRegistry().definitions.get(id);
    if (!definition) throw new Error(`unknown documentation ID: ${id}`);
    return relativeAnchorLink(
        from,
        definition.document,
        label,
        anchorForId(id)
    );
}

function headingAnchorBefore(document, line) {
    const lines = fs.readFileSync(document, "utf8").split(/\r?\n/);
    for (
        let index = Math.min(line - 1, lines.length - 1);
        index >= 0;
        index--
    ) {
        const heading = lines[index].match(/^#{1,6}\s+(.+?)\s*#*\s*$/)?.[1];
        if (!heading) continue;
        return heading
            .replace(/<[^>]+>/g, "")
            .replace(/[`*_~]/g, "")
            .trim()
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s-]/gu, "")
            .replace(/\s+/g, "-");
    }
    return null;
}

module.exports = {
    escapeCell,
    headingAnchorBefore,
    parseReportArgs,
    relativeAnchorLink,
    relativeIdLink,
    relativeLink,
    writeOrCheckReport
};

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { formatMarkdown } = require("./documentation-graph");

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
    const report = await formatMarkdown(markdown);
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

function relativeLink(from, target, label, line = null) {
    let relative = path
        .relative(path.dirname(from), target)
        .split(path.sep)
        .join("/");
    if (!relative.startsWith(".")) relative = `./${relative}`;
    return `[${label}](${relative}${line === null ? "" : `#L${line}`})`;
}

module.exports = {
    escapeCell,
    parseReportArgs,
    relativeLink,
    writeOrCheckReport
};

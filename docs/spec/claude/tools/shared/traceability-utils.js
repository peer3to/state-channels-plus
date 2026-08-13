"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { REQUIREMENT_PATTERN, REQUIREMENT_RE } = require("./id-utils");

const SPEC_ROOT = path.resolve(__dirname, "../..");
const REPO_ROOT = path.resolve(SPEC_ROOT, "../../..");
const ID_PATTERN = REQUIREMENT_PATTERN;
const ID_RE = REQUIREMENT_RE;
const ID_GLOBAL_RE = new RegExp(ID_PATTERN, "g");
const LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;
const TABLE_SEPARATOR_RE = /^:?-{3,}:?$/;

function walkFiles(root, options = {}) {
    const { extensions, skipDirectories = new Set() } = options;
    if (!fs.existsSync(root)) return [];
    const files = [];
    function visit(directory) {
        for (const entry of fs
            .readdirSync(directory, { withFileTypes: true })
            .sort((a, b) => a.name.localeCompare(b.name))) {
            const target = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                if (!skipDirectories.has(entry.name)) visit(target);
            } else if (
                !extensions ||
                extensions.some((extension) => entry.name.endsWith(extension))
            ) {
                files.push(path.resolve(target));
            }
        }
    }
    visit(root);
    return files;
}

function markdownFiles() {
    return walkFiles(SPEC_ROOT, {
        extensions: [".md"],
        skipDirectories: new Set(["tools", "generated"])
    });
}

function splitRow(line) {
    let body = line.trim();
    if (body.startsWith("|")) body = body.slice(1);
    if (body.endsWith("|")) body = body.slice(0, -1);
    const cells = [];
    let current = "";
    for (let index = 0; index < body.length; index += 1) {
        if (body[index] === "|" && body[index - 1] !== "\\") {
            cells.push(current.replaceAll("\\|", "|").trim());
            current = "";
        } else {
            current += body[index];
        }
    }
    cells.push(current.replaceAll("\\|", "|").trim());
    return cells;
}

function isSeparator(line) {
    const cells = splitRow(line);
    return (
        cells.length > 0 &&
        cells.every((cell) => TABLE_SEPARATOR_RE.test(cell.replaceAll(" ", "")))
    );
}

function linkValues(markdown) {
    const prose = markdown
        .replace(/```[\s\S]*?```/g, "")
        .replace(/~~~[\s\S]*?~~~/g, "")
        .replace(/(`+)([^`\r\n]*?)\1/g, "");
    return [...prose.matchAll(LINK_RE)].map((match) =>
        match[1].trim().replace(/^<|>$/g, "")
    );
}

function localTargets(markdown, document) {
    return linkValues(markdown)
        .map((raw) => raw.split("#", 1)[0])
        .filter((raw) => raw && !/^(?:https?:\/\/|mailto:|#)/.test(raw))
        .map((raw) =>
            path.resolve(path.dirname(document), decodeURIComponent(raw))
        );
}

function repoRelative(target) {
    const relative = path.relative(REPO_ROOT, target);
    if (
        relative === "" ||
        (!relative.startsWith(".." + path.sep) &&
            relative !== ".." &&
            !path.isAbsolute(relative))
    ) {
        return relative.split(path.sep).join("/");
    }
    return null;
}

function specRelative(target) {
    return path.relative(SPEC_ROOT, target).split(path.sep).join("/");
}

function readText(target) {
    return fs.readFileSync(target, "utf8");
}

function readLines(target) {
    return readText(target).split(/\r?\n/);
}

function stripMarkdown(cell) {
    return cell
        .replace(/\[([^\]]*)\]\([^)]+\)/g, "$1")
        .replaceAll("`", "")
        .replaceAll("**", "")
        .trim()
        .replace(/\s+/g, " ");
}

function parseArgs(definitions) {
    const values = Object.fromEntries(
        Object.keys(definitions).map((name) => [name, false])
    );
    for (const argument of process.argv.slice(2)) {
        if (!(argument in definitions)) {
            process.stderr.write(`unknown argument: ${argument}\n`);
            process.exit(2);
        }
        values[argument] = true;
    }
    return values;
}

module.exports = {
    ID_GLOBAL_RE,
    ID_PATTERN,
    ID_RE,
    REPO_ROOT,
    SPEC_ROOT,
    isSeparator,
    linkValues,
    localTargets,
    markdownFiles,
    parseArgs,
    readLines,
    readText,
    repoRelative,
    specRelative,
    splitRow,
    stripMarkdown,
    walkFiles
};

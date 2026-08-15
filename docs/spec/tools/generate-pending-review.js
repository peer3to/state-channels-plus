#!/usr/bin/env node
"use strict";

// Pending-review register: every maintained document under specification/, implementation/, and
// verification/ is pending engineer review until an engineer records its current content hash via
// tools/review.js. Any later edit changes the hash, so the file automatically returns to pending.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
    parseReportArgs,
    relativeLink,
    writeOrCheckReport
} = require("./shared/report-utils");

const SPEC_ROOT = path.join(__dirname, "..");
const REGISTER = path.join(SPEC_ROOT, "audit/review-state.json");
const LAYERS = ["specification", "implementation", "verification"];

function listMd(dir) {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...listMd(p));
        else if (entry.name.endsWith(".md")) out.push(p);
    }
    return out;
}

function contentHash(file) {
    return crypto
        .createHash("sha256")
        .update(fs.readFileSync(file))
        .digest("hex")
        .slice(0, 16);
}

function loadRegister() {
    if (!fs.existsSync(REGISTER)) return {};
    return JSON.parse(fs.readFileSync(REGISTER, "utf8"));
}

function generatePendingReview() {
    const output = path.join(SPEC_ROOT, "generated/pending-review.md");
    const register = loadRegister();
    const rows = { pending: [], stale: [], verified: [] };
    for (const layer of LAYERS) {
        for (const file of listMd(path.join(SPEC_ROOT, layer))) {
            const rel = path.relative(SPEC_ROOT, file);
            const hash = contentHash(file);
            const entry = register[rel];
            if (!entry) rows.pending.push({ rel, file, layer });
            else if (entry.hash !== hash)
                rows.stale.push({
                    rel,
                    file,
                    layer,
                    reviewer: entry.reviewer,
                    date: entry.date
                });
            else
                rows.verified.push({
                    rel,
                    file,
                    layer,
                    reviewer: entry.reviewer,
                    date: entry.date
                });
        }
    }
    const byLayer = (list) => {
        const m = {};
        for (const r of list) (m[r.layer] = m[r.layer] || []).push(r);
        return m;
    };
    const lines = [
        "# Pending Engineer Review",
        "",
        "> **Generated—do not edit.** Every maintained document is pending until an engineer records",
        '> its content hash with `SPEC_REVIEWER="Name" node docs/spec/tools/review.js <file...>`.',
        "> Any later edit invalidates the record automatically (the file returns to pending as stale).",
        "",
        `- Verified (current): **${rows.verified.length}/${rows.pending.length + rows.stale.length + rows.verified.length}**${rows.pending.length + rows.stale.length + rows.verified.length ? ` (${Math.round((rows.verified.length / (rows.pending.length + rows.stale.length + rows.verified.length)) * 100)}%)` : ""}`,
        `- Pending (never reviewed): **${rows.pending.length}**`,
        `- Stale (edited since review): **${rows.stale.length}**`,
        ""
    ];
    for (const [title, list, extra] of [
        ["Stale — edited since engineer review", rows.stale, true],
        ["Pending — never reviewed", rows.pending, false],
        ["Verified — current", rows.verified, true]
    ]) {
        lines.push(`## ${title}`, "");
        if (!list.length) {
            lines.push("None.", "");
            continue;
        }
        const grouped = byLayer(list);
        for (const layer of LAYERS) {
            if (!grouped[layer]) continue;
            lines.push(`### ${layer} (${grouped[layer].length})`, "");
            for (const r of grouped[layer].sort((a, b) =>
                a.rel.localeCompare(b.rel)
            )) {
                const meta =
                    extra && r.reviewer ? ` — ${r.reviewer}, ${r.date}` : "";
                lines.push(`- ${relativeLink(output, r.file, r.rel)}${meta}`);
            }
            lines.push("");
        }
    }
    return {
        report: lines.join("\n"),
        issueCount: rows.pending.length + rows.stale.length
    };
}

async function main() {
    const options = parseReportArgs();
    const result = generatePendingReview();
    const target = path.join(SPEC_ROOT, "generated/pending-review.md");
    const current = await writeOrCheckReport(target, result.report, options);
    process.stdout.write(
        `pending review: ${result.issueCount} document(s) awaiting engineer review\n`
    );
    if (!current || (options.strict && result.issueCount)) process.exit(1);
}

if (require.main === module)
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });

module.exports = { generatePendingReview };

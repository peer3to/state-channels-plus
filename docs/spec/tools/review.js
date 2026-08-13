#!/usr/bin/env node
"use strict";

// Engineer review recorder: SPEC_REVIEWER="Name" node tools/review.js <file...>
// Records the current content hash of each maintained document; generate-pending-review.js
// treats a matching hash as verified and any mismatch as stale (back to pending).

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SPEC_ROOT = path.join(__dirname, "..");
const REGISTER = path.join(SPEC_ROOT, "audit/review-state.json");

const reviewer = process.env.SPEC_REVIEWER;
if (!reviewer) {
    console.error('Set SPEC_REVIEWER="Your Name" to record a review.');
    process.exit(1);
}
const files = process.argv.slice(2);
if (!files.length) {
    console.error("Usage: SPEC_REVIEWER=... node tools/review.js <file...>");
    process.exit(1);
}
const register = fs.existsSync(REGISTER)
    ? JSON.parse(fs.readFileSync(REGISTER, "utf8"))
    : {};
for (const f of files) {
    const abs = path.resolve(f);
    const rel = path.relative(SPEC_ROOT, abs);
    if (rel.startsWith("..") || !fs.existsSync(abs)) {
        console.error(`skip (outside tree or missing): ${f}`);
        continue;
    }
    const hash = crypto
        .createHash("sha256")
        .update(fs.readFileSync(abs))
        .digest("hex")
        .slice(0, 16);
    register[rel] = {
        hash,
        reviewer,
        date: new Date().toISOString().slice(0, 10)
    };
    console.log(`verified ${rel} @ ${hash}`);
}
fs.writeFileSync(REGISTER, JSON.stringify(register, null, 1) + "\n");

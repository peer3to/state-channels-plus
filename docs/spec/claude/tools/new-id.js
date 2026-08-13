#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const { HASH_ALPHABET, HASH_LENGTH } = require("./shared/id-utils");
const { buildIdRegistry } = require("./shared/id-registry");

const stem = process.argv[2];
if (
    !stem ||
    !/^(?:(?:REQ|INV)-[A-Z0-9-]+-\d+|(?:UNIT|INTEGRATION)-TEST-[A-Z0-9-]+-\d+|OQ-\d+|OQ-(?:SPEC|IMPL|VER|AUDIT)-[A-Z0-9-]+-\d+|DEF-\d+|FIND-[A-Z0-9-]+-\d+)$/.test(
        stem
    )
) {
    process.stderr.write(
        "usage: node docs/spec/claude/tools/new-id.js <semantic-sequential-stem>\n" +
            "example: node docs/spec/claude/tools/new-id.js REQ-SM-10\n"
    );
    process.exit(2);
}

const existing = new Set(buildIdRegistry().definitions.keys());
for (;;) {
    const bytes = crypto.randomBytes(HASH_LENGTH);
    const suffix = [...bytes]
        .map((value) => HASH_ALPHABET[value & 31])
        .join("");
    const id = `${stem}-${suffix}`;
    if (!existing.has(id)) {
        process.stdout.write(`${id}\n`);
        break;
    }
}

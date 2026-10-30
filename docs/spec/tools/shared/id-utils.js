"use strict";

const HASH_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const HASH_LENGTH = 6;
const HASH_PATTERN = `[${HASH_ALPHABET}]{${HASH_LENGTH}}`;
const REQUIREMENT_PATTERN = `(?:REQ|INV)-[A-Z0-9-]+-\\d+-${HASH_PATTERN}`;
const SPECIFICATION_PLAN_PATTERN = `${REQUIREMENT_PATTERN}\\.T\\d+`;
const SPECIFICATION_PERMUTATION_PATTERN = `${SPECIFICATION_PLAN_PATTERN}\\.P\\d+`;
const IMPLEMENTATION_TEST_PATTERN = `(?:UNIT|INTEGRATION)-TEST-[A-Z0-9-]+-\\d+-${HASH_PATTERN}`;
const IMPLEMENTATION_PERMUTATION_PATTERN = `${IMPLEMENTATION_TEST_PATTERN}\\.P\\d+`;
const QUESTION_PATTERN = `(?:OQ-\\d+-${HASH_PATTERN}|OQ-(?:SPEC|IMPL|VER|AUDIT)-[A-Z0-9-]+-\\d+-${HASH_PATTERN})`;
const FINDING_PATTERN = `(?:DEF-\\d+-${HASH_PATTERN}|FIND-[A-Z0-9-]+-\\d+-${HASH_PATTERN})`;
const ROOT_ID_PATTERN = `(?:${REQUIREMENT_PATTERN}|${IMPLEMENTATION_TEST_PATTERN}|${QUESTION_PATTERN}|${FINDING_PATTERN})`;
const AUDITABLE_ID_PATTERN = `(?:${SPECIFICATION_PERMUTATION_PATTERN}|${SPECIFICATION_PLAN_PATTERN}|${IMPLEMENTATION_PERMUTATION_PATTERN}|${ROOT_ID_PATTERN})`;

const REQUIREMENT_RE = new RegExp(`^${REQUIREMENT_PATTERN}$`);
const TEST_PLAN_ITEM_RE = new RegExp(`^${SPECIFICATION_PLAN_PATTERN}$`);
const PERMUTATION_RE = new RegExp(`^${SPECIFICATION_PERMUTATION_PATTERN}$`);
const IMPLEMENTATION_TEST_RE = new RegExp(`^${IMPLEMENTATION_TEST_PATTERN}$`);
const IMPLEMENTATION_PERMUTATION_RE = new RegExp(
    `^${IMPLEMENTATION_PERMUTATION_PATTERN}$`
);
const QUESTION_RE = new RegExp(`^${QUESTION_PATTERN}$`);
const FINDING_RE = new RegExp(`^${FINDING_PATTERN}$`);
const AUDITABLE_ID_RE = new RegExp(AUDITABLE_ID_PATTERN, "g");

// A linked ID reference, with or without its tool-written label:
// [`ID` (label)](target) or [`ID`](target).
const EXACT_ID_LINK_RE = new RegExp(
    `(?:\\x60)?\\[+\\x60*(${AUDITABLE_ID_PATTERN})\\x60*(?:[ \\t]*\\([^)\\]]*\\))?\\]\\([^)]+\\)(?:\\x60)?`,
    "g"
);

// Drops what the tools write (case checkboxes, reference links and labels) so
// review and approval hashes cover only authored content.
function withoutToolWritten(markdown) {
    return markdown
        .replace(/^(\s*-\s+)\[[ x]\]\s+/gm, "$1")
        .replace(EXACT_ID_LINK_RE, (_, id) => `\x60${id}\x60`);
}

function anchorForId(id) {
    return id.toLowerCase();
}

module.exports = {
    EXACT_ID_LINK_RE,
    withoutToolWritten,
    AUDITABLE_ID_PATTERN,
    AUDITABLE_ID_RE,
    FINDING_PATTERN,
    FINDING_RE,
    HASH_ALPHABET,
    HASH_LENGTH,
    HASH_PATTERN,
    IMPLEMENTATION_PERMUTATION_PATTERN,
    IMPLEMENTATION_PERMUTATION_RE,
    IMPLEMENTATION_TEST_PATTERN,
    IMPLEMENTATION_TEST_RE,
    PERMUTATION_RE,
    QUESTION_PATTERN,
    QUESTION_RE,
    REQUIREMENT_PATTERN,
    REQUIREMENT_RE,
    ROOT_ID_PATTERN,
    SPECIFICATION_PERMUTATION_PATTERN,
    SPECIFICATION_PLAN_PATTERN,
    TEST_PLAN_ITEM_RE,
    anchorForId
};

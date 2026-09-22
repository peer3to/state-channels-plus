const { check, exact, digest } = require("./data");
const { MESSAGES } = require("./errors");
const { MAX_MODEL_MS } = require("./config");
const VERSION = 1;
const SHA = /^[a-f0-9]{40}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SOURCE =
    /^(finding:R[1-9][0-9]*[A-Z][A-Z0-9]*|comment:[1-9][0-9]*|review:[1-9][0-9]*|inline:[1-9][0-9]*|schema:[A-Za-z][A-Za-z0-9_.-]*)$/;
const REQUEST_KEYS = [
    "version",
    "repository",
    "pr",
    "head",
    "base",
    "mergeBase",
    "attempt",
    "run",
    "caller",
    "mode",
    "botRevision",
    "skillDigest",
    "policyDigest",
    "runtime",
    "operations",
    "readScope"
];
function string(value, pattern = ID) {
    check(typeof value === "string" && pattern.test(value));
}
function unique(values) {
    check(Array.isArray(values) && new Set(values).size === values.length);
}
function request(value) {
    exact(value, REQUEST_KEYS);
    check(
        REQUEST_KEYS.every((key) => Object.hasOwn(value, key)) &&
            value.version === VERSION
    );
    exact(value.repository, ["id", "name"]);
    check(Number.isSafeInteger(value.repository.id) && value.repository.id > 0);
    string(value.repository.name, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
    check(Number.isSafeInteger(value.pr) && value.pr > 0);
    for (const key of ["head", "base", "mergeBase", "botRevision"])
        string(value[key], SHA);
    for (const key of ["skillDigest", "policyDigest", "caller"])
        string(value[key], /^[a-f0-9]{64}$/);
    string(value.attempt);
    string(value.runtime, /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/);
    exact(value.run, ["id", "attempt"]);
    check(
        Number.isSafeInteger(value.run.id) &&
            value.run.id >= 0 &&
            Number.isSafeInteger(value.run.attempt) &&
            value.run.attempt > 0
    );
    check(
        ["local", "ci"].includes(value.mode) &&
            (value.mode !== "ci" || value.run.id > 0)
    );
    unique(value.operations);
    check(
        value.operations.length > 0 &&
            value.operations.every((op) =>
                ["review", "propose-replies"].includes(op)
            )
    );
    unique(value.readScope);
    check(
        value.readScope.length > 0 &&
            value.readScope.every((scope) =>
                ["source", "discussion", "reviews"].includes(scope)
            )
    );
    return value;
}
function effectiveIdentity(value, evidenceIdentity) {
    request(value);
    string(evidenceIdentity, /^[a-f0-9]{64}$/);
    return digest({
        repository: value.repository.id,
        pr: value.pr,
        head: value.head,
        mergeBase: value.mergeBase,
        botRevision: value.botRevision,
        skillDigest: value.skillDigest,
        policyDigest: value.policyDigest,
        runtime: value.runtime,
        operations: [...value.operations].sort(),
        readScope: [...value.readScope].sort(),
        evidenceIdentity
    });
}
function binding(value) {
    request(value);
    return {
        repositoryId: value.repository.id,
        pr: value.pr,
        head: value.head,
        attempt: value.attempt,
        run: value.run,
        caller: value.caller
    };
}
function assertBinding(actual, expected) {
    check(digest(actual) === digest(binding(expected)), "INVALID_RESULT");
}
function sourceId(id) {
    string(id, SOURCE);
    return id;
}
function correction(value, expected) {
    exact(value, [
        "version",
        "kind",
        "binding",
        "executionId",
        "resultRevision",
        "effectiveIdentity",
        "ids"
    ]);
    check(
        value.version === VERSION &&
            ["missing-accounting", "invalid-format"].includes(value.kind)
    );
    assertBinding(value.binding, expected);
    string(value.executionId);
    string(value.effectiveIdentity, /^[a-f0-9]{64}$/);
    check(
        Number.isSafeInteger(value.resultRevision) && value.resultRevision >= 0
    );
    unique(value.ids);
    check(value.ids.length > 0 && value.ids.length <= 1000);
    value.ids.forEach(sourceId);
    check(
        value.ids.every((id) =>
            value.kind === "invalid-format"
                ? ["schema:result", "schema:report"].includes(id)
                : !id.startsWith("schema:")
        )
    );
    return value;
}
function correctionPrompt(value, expected) {
    correction(value, expected);
    const prefix =
        value.kind === "missing-accounting"
            ? "Required accounting is missing for these identifiers: "
            : "Structured output failed these schema identifiers: ";
    return (
        prefix +
        [...value.ids].sort().join(", ") +
        ". Read missing original context through the permitted tools and repair the saved Markdown report. Follow model-output.md; do not emit hidden bookkeeping or duplicate prose as JSON."
    );
}
function result(value, expected) {
    exact(
        value,
        [
            "version",
            "binding",
            "executionId",
            "revision",
            "effectiveIdentity",
            "sessionId",
            "runtime",
            "report",
            "findings",
            "accounting",
            "coverage",
            "evidence",
            "recommendation"
        ],
        "INVALID_RESULT"
    );
    check(value.version === VERSION, "INVALID_RESULT");
    assertBinding(value.binding, expected);
    string(value.executionId);
    string(value.sessionId);
    string(value.effectiveIdentity, /^[a-f0-9]{64}$/);
    check(
        Number.isSafeInteger(value.revision) &&
            value.revision >= 0 &&
            value.revision <= 1,
        "INVALID_RESULT"
    );
    check(
        value.runtime === expected.runtime &&
            typeof value.report === "string" &&
            Buffer.byteLength(value.report) <= 1024 * 1024,
        "INVALID_RESULT"
    );
    check(
        ["approve", "comment"].includes(value.recommendation),
        "INVALID_RESULT"
    );
    exact(
        value.coverage,
        [
            "complete",
            "missing",
            "verificationMissing",
            "files",
            "lenses",
            "behaviors"
        ],
        "INVALID_RESULT"
    );
    check(
        typeof value.coverage.complete === "boolean" &&
            Array.isArray(value.coverage.missing) &&
            (value.coverage.verificationMissing === undefined ||
                Array.isArray(value.coverage.verificationMissing)) &&
            Array.isArray(value.coverage.files) &&
            Array.isArray(value.coverage.lenses) &&
            Array.isArray(value.coverage.behaviors),
        "INVALID_RESULT"
    );
    check(
        value.recommendation !== "approve" ||
            (value.coverage.complete &&
                value.coverage.missing.length === 0 &&
                !value.coverage.verificationMissing?.length),
        "INVALID_RESULT"
    );
    check(
        Array.isArray(value.findings) &&
            value.findings.length <= 1000 &&
            Array.isArray(value.accounting) &&
            value.accounting.length <= 10000,
        "INVALID_RESULT"
    );
    unique(value.findings.map((item) => item.id));
    unique(value.accounting.map((item) => item.sourceId));
    for (const item of value.findings) {
        exact(
            item,
            [
                "id",
                "threadId",
                "status",
                "body",
                "path",
                "line",
                "human",
                "evidence"
            ],
            "INVALID_RESULT"
        );
        string(item.id, /^[A-Z][A-Z0-9]{0,127}$/);
        check(
            typeof item.body === "string" &&
                item.body.length > 0 &&
                item.body.length <= 30000,
            "INVALID_RESULT"
        );
        check(
            ["new", "continued", "fixed", "recurred", "disagreement"].includes(
                item.status
            ),
            "INVALID_RESULT"
        );
        check(
            item.threadId === null ||
                (typeof item.threadId === "string" &&
                    /^[A-Za-z0-9_=-]+$/.test(item.threadId)),
            "INVALID_RESULT"
        );
        check(
            item.path === null ||
                (typeof item.path === "string" &&
                    !item.path.startsWith("/") &&
                    !item.path.split(/[\\/]/).includes("..")),
            "INVALID_RESULT"
        );
        check(
            item.line === null ||
                (Number.isSafeInteger(item.line) && item.line > 0),
            "INVALID_RESULT"
        );
        check(
            Array.isArray(item.evidence) &&
                item.evidence.length <= 1000 &&
                item.evidence.every(
                    (e) =>
                        typeof e === "string" &&
                        e.length >= 1 &&
                        e.length <= 30000
                ),
            "INVALID_RESULT"
        );
        if (item.human !== null) {
            exact(
                item.human,
                ["required", "question", "reason", "revision", "authority"],
                "INVALID_RESULT"
            );
            check(
                item.human.required === true &&
                    typeof item.human.question === "string" &&
                    item.human.question.trim() &&
                    typeof item.human.reason === "string" &&
                    item.human.reason.trim(),
                "INVALID_RESULT"
            );
            check(
                Number.isSafeInteger(item.human.revision) &&
                    item.human.revision > 0 &&
                    ["author", "maintainer"].includes(item.human.authority),
                "INVALID_RESULT"
            );
        }
    }
    for (const item of value.accounting) {
        exact(
            item,
            [
                "sourceId",
                "sourceRevision",
                "disposition",
                "response",
                "findingId",
                "humanAssessment"
            ],
            "INVALID_RESULT"
        );
        sourceId(item.sourceId);
        string(item.sourceRevision, /^[a-f0-9]{64}$/);
        check(
            [
                "response",
                "no-action",
                "continued",
                "fixed",
                "disagreement"
            ].includes(item.disposition),
            "INVALID_RESULT"
        );
        check(
            typeof item.response === "string" &&
                item.response.trim() &&
                item.response.length <= 30000,
            "INVALID_RESULT"
        );
        check(
            item.findingId === null ||
                value.findings.some((f) => f.id === item.findingId),
            "INVALID_RESULT"
        );
        check(
            item.humanAssessment === null ||
                ["accepted", "insufficient", "conflict"].includes(
                    item.humanAssessment
                ),
            "INVALID_RESULT"
        );
    }
    exact(
        value.evidence,
        [
            "identity",
            "sources",
            "requests",
            "pages",
            "bytes",
            "durations",
            "errors",
            "limits",
            "cacheHits"
        ],
        "INVALID_RESULT"
    );
    string(value.evidence.identity, /^[a-f0-9]{64}$/);
    check(
        Array.isArray(value.evidence.sources) &&
            value.evidence.sources.length <= 10000 &&
            Array.isArray(value.evidence.errors),
        "INVALID_RESULT"
    );
    for (const source of value.evidence.sources) {
        exact(
            source,
            [
                "url",
                "revision",
                "contextRevision",
                "etag",
                "modified",
                "page",
                "next",
                "loaded"
            ],
            "INVALID_RESULT"
        );
        require("./github-read").permittedUrl(
            source.url,
            expected.repository.name,
            expected.pr,
            expected.head
        );
        string(source.revision, /^[a-f0-9]{64}$/);
        string(source.contextRevision, /^[a-f0-9]{64}$/);
        check(
            typeof source.page === "string" &&
                source.page.length <= 1000 &&
                ["data", "unknown"].includes(source.loaded),
            "INVALID_RESULT"
        );
        if (source.next !== null)
            require("./github-read").permittedUrl(
                source.next,
                expected.repository.name,
                expected.pr,
                expected.head
            );
        if (value.coverage.complete)
            check(
                source.loaded === "data" &&
                    (source.next === null ||
                        value.evidence.sources.some(
                            (entry) => entry.url === source.next
                        )),
                "INVALID_RESULT"
            );
        for (const key of ["etag", "modified"])
            check(
                source[key] === null ||
                    (typeof source[key] === "string" &&
                        source[key].length <= 1000),
                "INVALID_RESULT"
            );
    }
    for (const list of [
        value.coverage.missing,
        value.coverage.verificationMissing || [],
        value.coverage.files,
        value.coverage.lenses,
        value.coverage.behaviors,
        value.evidence.errors
    ])
        check(
            list.length <= 10000 &&
                list.every(
                    (item) => typeof item === "string" && item.length <= 10000
                ),
            "INVALID_RESULT"
        );
    exact(
        value.evidence.limits,
        ["requests", "pages", "bytes", "elapsedMs"],
        "INVALID_RESULT"
    );
    check(
        Object.entries(value.evidence.limits).every(
            ([key, limit]) =>
                Number.isSafeInteger(limit) &&
                (key === "elapsedMs" ? limit > 0 : limit >= 0)
        ),
        "INVALID_RESULT"
    );
    check(
        Number.isSafeInteger(value.evidence.cacheHits) &&
            value.evidence.cacheHits >= 0,
        "INVALID_RESULT"
    );
    for (const key of ["requests", "pages", "bytes"])
        check(
            Number.isSafeInteger(value.evidence[key]) &&
                value.evidence[key] >= 0,
            "INVALID_RESULT"
        );
    exact(
        value.evidence.durations,
        [
            "modelMs",
            "validationMs",
            "turns",
            "gatheringMs",
            "assessmentMs",
            "correctionMs"
        ],
        "INVALID_RESULT"
    );
    check(
        ["gatheringMs", "assessmentMs", "correctionMs"].every(
            (key) =>
                Number.isFinite(value.evidence.durations[key]) &&
                value.evidence.durations[key] >= 0
        ),
        "INVALID_RESULT"
    );
    check(
        Number.isFinite(value.evidence.durations.modelMs) &&
            value.evidence.durations.modelMs >= 0 &&
            value.evidence.durations.modelMs <= MAX_MODEL_MS,
        "INVALID_RESULT"
    );
    check(
        !value.coverage.complete ||
            (value.coverage.missing.length === 0 &&
                value.evidence.errors.length === 0),
        "INVALID_RESULT"
    );
    check(
        Number.isFinite(value.evidence.durations.validationMs) &&
            value.evidence.durations.validationMs >= 0 &&
            Array.isArray(value.evidence.durations.turns) &&
            value.evidence.durations.turns.every(
                (duration) => Number.isFinite(duration) && duration >= 0
            ),
        "INVALID_RESULT"
    );
    try {
        require("./review-format").validateReport(value, expected);
    } catch {
        check(false, "INVALID_RESULT");
    }
    return value;
}
function receipt(value, expected) {
    exact(
        value,
        [
            "version",
            "binding",
            "kind",
            "complete",
            "round",
            "code",
            "actions",
            "mappings",
            "state",
            "dispositions"
        ],
        "INVALID_RESULT"
    );
    assertBinding(value.binding, expected);
    check(
        value.version === 1 &&
            ["review", "notice-only"].includes(value.kind) &&
            typeof value.complete === "boolean",
        "INVALID_RESULT"
    );
    check(
        value.kind !== "notice-only" ||
            (value.complete === false && value.round === undefined),
        "INVALID_RESULT"
    );
    check(
        value.kind !== "review" ||
            (Number.isSafeInteger(value.round) && value.round > 0),
        "INVALID_RESULT"
    );
    check(
        value.code === undefined || Object.hasOwn(MESSAGES, value.code),
        "INVALID_RESULT"
    );
    if (value.mappings !== undefined) {
        check(
            value.mappings &&
                typeof value.mappings === "object" &&
                !Array.isArray(value.mappings),
            "INVALID_RESULT"
        );
        for (const [localId, publishedId] of Object.entries(value.mappings)) {
            string(localId, /^[A-Z][A-Z0-9]{0,127}$/);
            string(publishedId, /^R[1-9][0-9]*[A-Z][A-Z0-9]*$/);
        }
    }
    if (value.state !== undefined)
        check(
            value.state === (value.complete ? "complete" : "partial"),
            "INVALID_RESULT"
        );
    if (value.dispositions !== undefined) {
        check(
            Array.isArray(value.dispositions) &&
                value.dispositions.length <= 1000,
            "INVALID_RESULT"
        );
        for (const item of value.dispositions) {
            exact(item, ["findingId", "status", "threadId"], "INVALID_RESULT");
            string(item.findingId, /^R[1-9][0-9]*[A-Z][A-Z0-9]*$/);
            check(
                [
                    "new",
                    "continued",
                    "fixed",
                    "recurred",
                    "disagreement"
                ].includes(item.status) &&
                    (item.threadId === null ||
                        typeof item.threadId === "string"),
                "INVALID_RESULT"
            );
        }
    }
    check(
        Array.isArray(value.actions) && value.actions.length <= 10000,
        "INVALID_RESULT"
    );
    for (const action of value.actions) {
        exact(action, ["kind", "id", "url"], "INVALID_RESULT");
        check(
            [
                "notice",
                "review-comment",
                "approve",
                "resolve",
                "reopen",
                "dismiss"
            ].includes(action.kind) &&
                Number.isSafeInteger(action.id) &&
                action.id > 0,
            "INVALID_RESULT"
        );
        const url = new URL(action.url);
        check(
            url.protocol === "https:" &&
                url.hostname === "github.com" &&
                !url.username &&
                !url.password &&
                url.pathname ===
                    `/${expected.repository.name}/pull/${expected.pr}`,
            "INVALID_RESULT"
        );
    }
    return value;
}
function failureResult(value, expected) {
    exact(
        value,
        ["version", "binding", "code", "message", "diagnostics"],
        "INVALID_RESULT"
    );
    assertBinding(value.binding, expected);
    check(
        value.version === VERSION &&
            Object.hasOwn(MESSAGES, value.code) &&
            value.message === MESSAGES[value.code],
        "INVALID_RESULT"
    );
    if (value.diagnostics !== undefined) {
        const item = value.diagnostics;
        exact(
            item,
            [
                "requests",
                "pages",
                "bytes",
                "modelMs",
                "validationMs",
                "limits",
                "sources"
            ],
            "INVALID_RESULT"
        );
        for (const key of [
            "requests",
            "pages",
            "bytes",
            "modelMs",
            "validationMs"
        ])
            check(
                Number.isFinite(item[key]) && item[key] >= 0,
                "INVALID_RESULT"
            );
        exact(
            item.limits,
            ["requests", "pages", "bytes", "elapsedMs"],
            "INVALID_RESULT"
        );
        check(
            Object.entries(item.limits).every(
                ([key, limit]) =>
                    Number.isSafeInteger(limit) &&
                    (key === "elapsedMs" ? limit > 0 : limit >= 0)
            ),
            "INVALID_RESULT"
        );
        check(
            Array.isArray(item.sources) && item.sources.length <= 10000,
            "INVALID_RESULT"
        );
        for (const url of item.sources)
            require("./github-read").permittedUrl(
                url,
                expected.repository.name,
                expected.pr,
                expected.head
            );
    }
    return value;
}
function requireCompleteReview(value) {
    check(
        value.coverage?.complete === true &&
            value.coverage.missing.length === 0 &&
            value.evidence?.errors?.length === 0,
        "REVIEW_INCOMPLETE"
    );
}
function failure(error, expected) {
    const value = {
        version: VERSION,
        binding: binding(expected),
        code: error.code,
        message: MESSAGES[error.code]
    };
    if (error.diagnostics !== undefined) value.diagnostics = error.diagnostics;
    return failureResult(value, expected);
}
module.exports = {
    requireCompleteReview,
    VERSION,
    request,
    result,
    binding,
    assertBinding,
    effectiveIdentity,
    correction,
    correctionPrompt,
    sourceId,
    failure,
    failureResult,
    receipt
};

const { digest } = require("../../data");
const { binding, effectiveIdentity } = require("../../protocol");
function request(overrides = {}) {
    return {
        version: 1,
        repository: { id: 1, name: "peer3to/state-channels-plus" },
        pr: 6,
        head: "a".repeat(40),
        base: "b".repeat(40),
        mergeBase: "c".repeat(40),
        attempt: "attempt-1",
        run: { id: 1, attempt: 1 },
        caller: "d".repeat(64),
        mode: "ci",
        botRevision: "e".repeat(40),
        skillDigest: digest("skill"),
        policyDigest: digest("policy"),
        runtime: "codex-0.156.1",
        operations: ["review", "propose-replies"],
        readScope: ["source", "discussion", "reviews"],
        ...overrides
    };
}
function result(input = request(), overrides = {}) {
    return {
        version: 1,
        binding: binding(input),
        executionId: "execution-1",
        revision: 0,
        effectiveIdentity: effectiveIdentity(input, digest("context")),
        sessionId: "session-1",
        runtime: input.runtime,
        report: `<!-- pr-review-document ${JSON.stringify({ schema: 2, repo: input.repository.name, pr: input.pr, headSha: input.head, baseSha: input.base })} -->\n\nNo actionable findings.`,
        findings: [],
        accounting: [],
        coverage: {
            complete: true,
            missing: [],
            files: ["README.md"],
            lenses: ["correctness"],
            behaviors: ["documented public boundary"]
        },
        evidence: {
            identity: digest("context"),
            sources: [],
            requests: 1,
            pages: 1,
            bytes: 10,
            limits: {
                requests: 40,
                pages: 40,
                bytes: 8388608,
                elapsedMs: 300000
            },
            cacheHits: 0,
            durations: {
                gatheringMs: 0,
                assessmentMs: 1,
                correctionMs: 0,
                modelMs: 1,
                validationMs: 0,
                turns: [1]
            },
            errors: []
        },
        recommendation: "approve",
        ...overrides
    };
}
module.exports = { request, result };

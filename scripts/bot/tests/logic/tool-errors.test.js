const assert = require("node:assert/strict");
const { toolFailureResult } = require("../../adapters/codex");
const { ReviewError } = require("../../errors");
describe("review recoverable tool failures", function () {
    it("returns sanitized native failed-tool results without provider diagnostics", function () {
        for (const code of [
            "INVALID_REQUEST",
            "UNAUTHORIZED",
            "CONTEXT_UNAVAILABLE",
            "BUSY"
        ]) {
            const error = new ReviewError(code);
            error.message = "sensitive-provider-detail";
            error.diagnostics = { secret: "private-canary" };
            const result = toolFailureResult(error);
            assert.equal(result.success, false);
            const payload = JSON.parse(result.contentItems[0].text);
            assert.equal(payload.error.code, code);
            assert.equal(payload.error.message, new ReviewError(code).message);
            assert.ok(payload.guidance.includes("incomplete"));
            assert.ok(!JSON.stringify(result).includes("private-canary"));
            assert.ok(
                !JSON.stringify(result).includes("sensitive-provider-detail")
            );
        }
    });
    it("keeps budget, rate-limit, isolation, infrastructure and unknown failures fatal", function () {
        for (const code of [
            "CONTEXT_BUDGET_EXCEEDED",
            "CONTEXT_RATE_LIMITED",
            "ISOLATION_UNVERIFIED",
            "SERVICE_UNAVAILABLE",
            "DISK_FULL",
            "REVIEW_TIMEOUT"
        ]) {
            const error = new ReviewError(code);
            assert.throws(
                () => toolFailureResult(error),
                (caught) => caught === error
            );
        }
        const error = Object.assign(new Error("unexpected"), {
            code: "CONTEXT_UNAVAILABLE"
        });
        assert.throws(
            () => toolFailureResult(error),
            (caught) => caught === error
        );
    });
});

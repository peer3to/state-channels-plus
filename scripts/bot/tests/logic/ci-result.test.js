const assert = require("node:assert/strict");
const protocol = require("../../protocol");
const { digest } = require("../../data");
const { ReviewError } = require("../../errors");
const records = require("../fixtures/records");

function evidenceResult() {
    const input = records.request();
    const output = records.result(input);
    const prefix = `https://api.github.com/repos/${input.repository.name}`;
    const runs = `${prefix}/actions/runs?head_sha=${input.head}`;
    output.evidence.sources = [
        `${prefix}/commits/${input.head}/check-runs`,
        `${prefix}/commits/${input.head}/status`,
        runs,
        `${runs}&page=2`
    ].map((url, index) => ({
        url,
        revision: digest(url),
        contextRevision: digest(url),
        etag: null,
        modified: null,
        page: String(index + 1),
        next: index === 2 ? `${runs}&page=2` : null,
        loaded: "data"
    }));
    return { input, output };
}

describe("review CI result evidence", function () {
    it("accepts pinned check, status and paginated workflow receipts", function () {
        const { input, output } = evidenceResult();
        assert.equal(protocol.result(output, input), output);
    });
    it("rejects a receipt for another head", function () {
        const { input, output } = evidenceResult();
        output.evidence.sources[0].url = output.evidence.sources[0].url.replace(
            input.head,
            input.base
        );
        assert.throws(() => protocol.result(output, input), {
            code: "CONTEXT_UNAVAILABLE"
        });
    });
    it("rejects pagination pointing at another head", function () {
        const { input, output } = evidenceResult();
        output.evidence.sources[2].next =
            output.evidence.sources[2].next.replace(input.head, input.base);
        assert.throws(() => protocol.result(output, input), {
            code: "CONTEXT_UNAVAILABLE"
        });
    });
    it("preserves the original failure with pinned CI diagnostics", function () {
        const { input, output } = evidenceResult();
        const error = new ReviewError("INVALID_RESULT");
        error.diagnostics = {
            requests: 4,
            pages: 4,
            bytes: 100,
            modelMs: 1000,
            validationMs: 0,
            limits: output.evidence.limits,
            sources: output.evidence.sources.map((source) => source.url)
        };
        assert.equal(protocol.failure(error, input).code, "INVALID_RESULT");
        error.diagnostics.sources[0] = error.diagnostics.sources[0].replace(
            input.head,
            input.base
        );
        assert.throws(() => protocol.failure(error, input), {
            code: "CONTEXT_UNAVAILABLE"
        });
    });
});

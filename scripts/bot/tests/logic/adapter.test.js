const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { NativeProcess, providerFailure } = require("../../adapters/codex");
const { ModelBudget } = require("../../timing");
const { configuration } = require("../../config");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function config(extra = {}) {
    return {
        stateRoot: "/private/tmp/review-fixture",
        ...extra
    };
}
describe("review native adapter controls", function () {
    it("uses codex from PATH and a runtime under the worker review directory", function () {
        const value = configuration(config());
        assert.equal(value.codexPath, "codex");
        assert.equal(value.runtimeRoot, path.join(value.stateRoot, "runtime"));
    });
    it("rejects configured API-key fallback", function () {
        assert.throws(() => configuration(config({ apiKey: "forbidden" })));
    });
    it("rejects a paid-credit route", function () {
        assert.throws(() => configuration(config({ paidCredits: true })));
    });
    it("rejects purchase and reset requests", function () {
        assert.throws(() =>
            configuration(config({ purchase: true, reset: true }))
        );
    });
    it("verifies child termination before reusing timed-out PR state", async function () {
        const root = await fs.mkdtemp(
            path.join(os.tmpdir(), "review-process-")
        );
        const file = path.join(root, "writes.txt");
        const child = new NativeProcess(
            process.execPath,
            [
                "-e",
                'const fs = require("node:fs"); setInterval(() => fs.appendFileSync(process.argv[1], "x"), 5);',
                file
            ],
            { cwd: root, env: {} }
        );
        try {
            await delay(150);
            const budget = new ModelBudget(20);
            await assert.rejects(
                budget.run(
                    () => new Promise(() => {}),
                    () => child.stop(1000)
                ),
                { code: "REVIEW_TIMEOUT" }
            );
            const afterExit = await fs.readFile(file, "utf8");
            await delay(30);
            assert.equal(await fs.readFile(file, "utf8"), afterExit);
            assert.equal(budget.terminationFailed, false);
        } finally {
            await child.stop(1000);
            await fs.rm(root, { recursive: true });
        }
    });
    it("rejects ancillary limits that exceed the fixed client and CI phase allowances", function () {
        assert.throws(() =>
            configuration(config({ limits: { setupMs: 300001 } }))
        );
        assert.throws(() =>
            configuration(config({ limits: { validationMs: 900001 } }))
        );
        assert.throws(() =>
            configuration(config({ limits: { terminationMs: 10001 } }))
        );
        assert.equal(
            configuration(config({ limits: { setupMs: 1000 } })).limits.setupMs,
            1000
        );
    });
    it("reports recorded included-usage exhaustion without an alternate route", function () {
        assert.deepEqual(
            {
                code: providerFailure({ codexErrorInfo: "usageLimitExceeded" })
                    .code,
                message: providerFailure({
                    codexErrorInfo: "usageLimitExceeded"
                }).message
            },
            {
                code: "SUBSCRIPTION_LIMIT",
                message: "Included subscription usage is exhausted."
            }
        );
    });
    it("reports recorded expired subscription login without credential fallback", function () {
        assert.equal(
            providerFailure({
                codexErrorInfo: "unauthorized",
                message: "sensitive provider details"
            }).message,
            "Subscription login has expired."
        );
    });
    it("rejects an unavailable model configuration instead of substituting another model", function () {
        assert.throws(() =>
            configuration(config({ model: "different-model" }))
        );
        assert.equal(configuration(config()).model, "gpt-6-astra");
        assert.equal(configuration(config()).effort, "high");
    });
});

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
async function stopTree(forceParent) {
    const child = new NativeProcess(
        process.execPath,
        [
            "-e",
            `
        const {spawn}=require('node:child_process');
        const nested=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),50));process.send('ready');setInterval(()=>{},1000)"],{stdio:['ignore','ignore','ignore','ipc']});
        nested.on('message',()=>process.stdout.write(JSON.stringify({method:'ready',params:{pid:nested.pid}})+'\\n'));
        process.on('SIGTERM',()=>{});
        nested.on('exit',()=>{if(!${forceParent})process.exit(0)});
        setInterval(()=>{},1000);
    `
        ],
        {}
    );
    try {
        const message = await new Promise((resolve, reject) => {
            child.once("message", resolve);
            child.once("failure", reject);
        });
        await child.stop(3000);
        assert.throws(() => process.kill(message.params.pid, 0), {
            code: "ESRCH"
        });
        assert.throws(() => process.kill(child.child.pid, 0), {
            code: "ESRCH"
        });
    } finally {
        await child.stop(3000);
    }
}
describe("review native adapter controls", function () {
    it("signals the descendant directly and waits for its delayed exit before releasing its parent", async function () {
        await stopTree(false);
    });
    it("forces an uncooperative parent after its descendant has been reaped", async function () {
        await stopTree(true);
    });
    it("rejects pending requests when the native child closes its input pipe", async function () {
        const child = new NativeProcess(
            process.execPath,
            [
                "-e",
                "require('node:fs').closeSync(0); process.stdout.write(JSON.stringify({method:'ready'})+'\\n'); setInterval(()=>{},1000)"
            ],
            {}
        );
        try {
            await new Promise((resolve, reject) => {
                child.once("message", resolve);
                child.once("failure", reject);
            });
            await assert.rejects(child.request("after-close", {}, 2000), {
                code: "SERVICE_UNAVAILABLE"
            });
            assert.equal(child.pending.size, 0);
            assert.equal(child.failure.code, "SERVICE_UNAVAILABLE");
        } finally {
            await child.stop(1000);
        }
    });
    it("accepts resumed native history larger than eight megabytes without corrupting split UTF-8", async function () {
        const child = new NativeProcess(
            process.execPath,
            [
                "-e",
                `
            process.stdin.once("data", data => {
                const request = JSON.parse(data);
                const frame = Buffer.from(JSON.stringify({id: request.id, result: {
                    thread: {id: "same-chat", history: "x".repeat(12 * 1024 * 1024) + "🧑"}
                }}) + "\\n");
                const split = frame.indexOf(Buffer.from("🧑")) + 2;
                process.stdout.write(frame.subarray(0, split), () => {
                    setTimeout(() => process.stdout.write(frame.subarray(split)), 10);
                });
            });
        `
            ],
            { env: {} }
        );
        try {
            const response = await child.request("thread/resume", {
                threadId: "same-chat"
            });
            assert.equal(response.thread.id, "same-chat");
            assert.equal(
                response.thread.history,
                "x".repeat(12 * 1024 * 1024) + "🧑"
            );
            assert.equal(child.failure, null);
        } finally {
            await child.stop(1000);
        }
    });
    it("still rejects malformed native JSON frames", async function () {
        const child = new NativeProcess(
            process.execPath,
            [
                "-e",
                `
            process.stdin.once("data", () => process.stdout.write("not-json\\n"));
        `
            ],
            { env: {} }
        );
        try {
            await assert.rejects(child.request("thread/read", {}), {
                code: "INVALID_RESULT"
            });
        } finally {
            await child.stop(1000);
        }
    });
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
    it("allows unlimited retrieval without disabling model and phase timeouts", function () {
        const value = configuration(config());
        assert.equal(value.limits.contextRequests, 0);
        assert.equal(value.limits.contextPages, 0);
        assert.equal(value.limits.contextBytes, 0);
        assert.equal(value.limits.modelMs, 3600000);
        assert.throws(() =>
            configuration(config({ limits: { contextBytes: -1 } }))
        );
        assert.throws(() => configuration(config({ limits: { modelMs: 0 } })));
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
        assert.equal(configuration(config()).effort, "low");
    });
});

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { providerFailure } = require("../../adapters/codex");
const { NativeProcess } = require("../../adapters/native");
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
    it("defaults to gpt-6-astra at low effort and accepts a worker-selected model and effort", function () {
        assert.equal(configuration(config()).model, "gpt-6-astra");
        assert.equal(configuration(config()).effort, "low");
        const selected = configuration(
            config({ model: "gpt-7-nova", effort: "high" })
        );
        assert.equal(selected.model, "gpt-7-nova");
        assert.equal(selected.effort, "high");
    });
    it("defaults Claude reviews to claude-opus-5-5 at low effort and rejects unknown providers", function () {
        const claude = configuration(config({ provider: "claude" }));
        assert.equal(claude.model, "claude-opus-5-5");
        assert.equal(claude.effort, "low");
        assert.equal(claude.claudePath, "claude");
        assert.equal(configuration(config()).provider, "codex");
        assert.throws(() => configuration(config({ provider: "gemini" })), {
            code: "INVALID_REQUEST"
        });
    });
    it("maps Claude CLI errors to typed review failures", function () {
        const {
            providerFailure: claudeFailure
        } = require("../../adapters/claude");
        for (const [code, status, expected] of [
            ["rate_limit", undefined, "SUBSCRIPTION_LIMIT"],
            ["billing_error", undefined, "SUBSCRIPTION_LIMIT"],
            [null, 429, "SUBSCRIPTION_LIMIT"],
            ["authentication_failed", undefined, "LOGIN_EXPIRED"],
            [null, 401, "LOGIN_EXPIRED"],
            ["model_not_found", 404, "MODEL_UNAVAILABLE"],
            ["server_error", 500, "SERVICE_UNAVAILABLE"],
            [null, undefined, "SERVICE_UNAVAILABLE"]
        ])
            assert.equal(claudeFailure(code, status).code, expected);
    });
    it("deletes only the named Claude session transcript", async function () {
        const { ClaudeAdapter } = require("../../adapters/claude");
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "claude-cfg-"));
        const previous = process.env.CLAUDE_CONFIG_DIR;
        process.env.CLAUDE_CONFIG_DIR = root;
        const target = "0f0e6b0c-2d5e-4a8f-9c11-111111111111";
        const other = "0f0e6b0c-2d5e-4a8f-9c11-222222222222";
        const project = path.join(root, "projects", "-review-runtime");
        try {
            await fs.mkdir(path.join(project, target), { recursive: true });
            await fs.writeFile(path.join(project, `${target}.jsonl`), "{}");
            await fs.writeFile(path.join(project, `${other}.jsonl`), "{}");
            const adapter = new ClaudeAdapter(configuration(config()), {});
            await adapter.delete(target);
            assert.deepEqual(await fs.readdir(project), [`${other}.jsonl`]);
            await assert.rejects(adapter.delete("../escape"), {
                code: "INVALID_REQUEST"
            });
        } finally {
            if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
            else process.env.CLAUDE_CONFIG_DIR = previous;
            await fs.rm(root, { recursive: true, force: true });
        }
    });
    it("rejects malformed model and effort settings", function () {
        for (const setting of [
            { model: "" },
            { model: "bad model" },
            { effort: "-high" },
            { effort: 3 }
        ])
            assert.throws(() => configuration(config(setting)), {
                code: "INVALID_REQUEST"
            });
    });
});

const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const { EventEmitter } = require("node:events");
const { check, exact } = require("../data");
const { ReviewError, sanitized } = require("../errors");
const { MODEL } = require("../config");
const DISABLED = [
    "apps",
    "browser_use",
    "browser_use_external",
    "browser_use_full_cdp_access",
    "computer_use",
    "hooks",
    "plugins",
    "multi_agent",
    "shell_tool",
    "unified_exec",
    "image_generation",
    "view_image",
    "workspace_dependencies",
    "skill_mcp_dependency_install",
    "skill_search",
    "goals",
    "sleep_tool"
];
function providerFailure(error) {
    const info = error?.codexErrorInfo;
    if (
        [
            "usageLimitExceeded",
            "sessionBudgetExceeded",
            "rateLimitExceeded"
        ].includes(info)
    )
        return new ReviewError("SUBSCRIPTION_LIMIT");
    if (info === "unauthorized") return new ReviewError("LOGIN_EXPIRED");
    return new ReviewError("SERVICE_UNAVAILABLE");
}
function toolFailureResult(error) {
    // Only tool-local input/availability failures are recoverable. Transport
    // identity checks and infrastructure/budget failures remain fail-closed.
    if (
        !(error instanceof ReviewError) ||
        ![
            "INVALID_REQUEST",
            "UNAUTHORIZED",
            "CONTEXT_UNAVAILABLE",
            "BUSY"
        ].includes(error.code)
    )
        throw error;
    const safe = sanitized(error);
    return {
        success: false,
        contentItems: [
            {
                type: "inputText",
                text: JSON.stringify({
                    error: { code: safe.code, message: safe.message },
                    guidance:
                        "This tool request failed; it supplied no evidence. Use permitted requests or correct the arguments. Keep coverage incomplete if required evidence remains unavailable."
                })
            }
        ]
    };
}
class NativeProcess extends EventEmitter {
    child;
    exited;
    fragments = [];
    nextId = 1;
    pending = new Map();
    failure = null;
    constructor(executable, args, options) {
        super();
        this.child = spawn(executable, args, {
            ...options,
            detached: true,
            stdio: ["pipe", "pipe", "pipe"]
        });
        this.exited = new Promise((resolve) => {
            this.child.once("exit", (code, signal) => {
                this.fail(new ReviewError("SERVICE_UNAVAILABLE"));
                resolve({ code, signal });
            });
            this.child.once("error", () => {
                this.fail(new ReviewError("SERVICE_UNAVAILABLE"));
                resolve({ code: null, signal: null });
            });
        });
        // Provider diagnostics can contain credentials; only typed failures leave this owner.
        this.child.stdin.on("error", () =>
            this.fail(new ReviewError("SERVICE_UNAVAILABLE"))
        );
        this.child.stderr.resume();
        // Decode across pipe chunks: a UTF-8 character can straddle two reads.
        this.child.stdout.setEncoding("utf8");
        this.child.stdout.on("data", (chunk) => {
            // Resumed threads include accumulated history, not just one report.
            // Assemble each frame once without imposing a review-size cutoff.
            let start = 0,
                newline;
            while ((newline = chunk.indexOf("\n", start)) >= 0) {
                this.fragments.push(chunk.slice(start, newline));
                const line = this.fragments.join("");
                this.fragments = [];
                start = newline + 1;
                try {
                    this.receive(JSON.parse(line));
                } catch {
                    this.fail(new ReviewError("INVALID_RESULT"));
                }
            }
            if (start < chunk.length) this.fragments.push(chunk.slice(start));
        });
    }
    fail(error) {
        this.failure = error;
        for (const entry of this.pending.values()) {
            clearTimeout(entry.timer);
            entry.reject(error);
        }
        this.pending.clear();
        this.emit("failure", error);
    }
    receive(message) {
        if (message.id !== undefined && !message.method) {
            const pending = this.pending.get(message.id);
            if (!pending) return;
            clearTimeout(pending.timer);
            this.pending.delete(message.id);
            if (message.error)
                pending.reject(new ReviewError("SERVICE_UNAVAILABLE"));
            else pending.resolve(message.result);
        } else this.emit("message", message);
    }
    write(message) {
        check(!this.failure, "SERVICE_UNAVAILABLE");
        this.child.stdin.write(JSON.stringify(message) + "\n");
    }
    request(method, params, timeout = 30000) {
        check(!this.failure, "SERVICE_UNAVAILABLE");
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new ReviewError("SERVICE_UNAVAILABLE"));
            }, timeout);
            this.pending.set(id, { resolve, reject, timer });
            this.write({ id, method, params });
        });
    }
    async stop(timeoutMs) {
        const deadline = performance.now() + timeoutMs;
        const pid = this.child.pid;
        if (!pid) {
            await this.exited;
            return;
        }
        const signal = (name) => {
            try {
                process.kill(-pid, name);
            } catch (error) {
                if (error.code !== "ESRCH") throw error;
            }
        };
        signal("SIGTERM");
        let timer;
        try {
            await Promise.race([
                this.exited,
                new Promise((resolve) => {
                    timer = setTimeout(resolve, Math.min(1000, timeoutMs / 2));
                })
            ]);
        } finally {
            clearTimeout(timer);
        }
        signal("SIGKILL");
        let exitTimer;
        try {
            await Promise.race([
                this.exited,
                new Promise((_, reject) => {
                    exitTimer = setTimeout(
                        () => reject(new ReviewError("SERVICE_UNAVAILABLE")),
                        Math.max(1, deadline - performance.now())
                    );
                })
            ]);
        } finally {
            clearTimeout(exitTimer);
        }
        // The leader can exit before its signalled descendants are reaped.
        while (true) {
            try {
                process.kill(-pid, 0);
            } catch (error) {
                if (error.code === "ESRCH") return;
                throw error;
            }
            const remaining = deadline - performance.now();
            check(remaining > 0, "SERVICE_UNAVAILABLE");
            await new Promise((resolve) =>
                setTimeout(resolve, Math.min(25, remaining))
            );
        }
    }
}
function tool(
    name,
    description,
    properties,
    required = Object.keys(properties)
) {
    return {
        name,
        description,
        inputSchema: {
            type: "object",
            additionalProperties: false,
            properties,
            required
        }
    };
}
const TOOLS = [
    tool(
        "source_list",
        "List the assigned checkout's tracked source paths.",
        {}
    ),
    tool("source_read", "Read bounded lines of a tracked source file.", {
        path: { type: "string" },
        start: { type: "integer" },
        count: { type: "integer" }
    }),
    tool(
        "source_search",
        "Search literal text in bounded tracked source files.",
        {
            text: { type: "string" },
            paths: { type: "array", items: { type: "string" } }
        }
    ),
    tool("source_diff", "Read the pinned source diff for one tracked path.", {
        path: { type: "string" }
    }),
    tool("public_github_read", "Read a bounded public page for this PR only.", {
        url: { type: "string" }
    })
];
class CodexAdapter {
    config;
    process;
    threadId = null;
    turnId = null;
    stopping = null;
    tools;
    setupDeadline = null;
    activity = {
        phase: "starting",
        lastEventAt: null,
        completedItems: 0,
        toolCalls: 0
    };
    constructor(config, tools) {
        this.config = config;
        this.tools = tools;
    }
    setupTimeout(maximum = 30000) {
        if (this.setupDeadline === null) return maximum;
        const remaining = this.setupDeadline - performance.now();
        check(remaining > 0, "SETUP_TIMEOUT");
        return Math.max(1, Math.min(maximum, Math.ceil(remaining)));
    }
    async setupRequest(method, params) {
        try {
            return await this.process.request(
                method,
                params,
                this.setupTimeout()
            );
        } catch (error) {
            if (
                this.setupDeadline !== null &&
                performance.now() >= this.setupDeadline
            )
                throw new ReviewError("SETUP_TIMEOUT");
            throw error;
        }
    }
    async open({ modelAccess = true, deadline = null } = {}) {
        this.setupDeadline = deadline;
        await fs.mkdir(this.config.runtimeRoot, {
            recursive: true,
            mode: 0o700
        });
        const version = execFileSync(this.config.codexPath, ["--version"], {
            encoding: "utf8",
            timeout: this.setupTimeout(5000),
            env: { PATH: process.env.PATH },
            stdio: ["ignore", "pipe", "ignore"]
        }).trim();
        check(
            version === `codex-cli ${this.config.codexVersion}`,
            "MODEL_UNAVAILABLE"
        );
        const args = DISABLED.flatMap((name) => ["--disable", name]);
        // Dynamic source tools use Code Mode; this does not enable shell tools.
        args.push("--enable", "code_mode_host");
        args.push("-c", 'web_search="disabled"', "app-server");
        this.process = new NativeProcess(this.config.codexPath, args, {
            cwd: this.config.runtimeRoot,
            env: {
                PATH: process.env.PATH,
                HOME: process.env.HOME,
                ...(process.env.CODEX_HOME
                    ? { CODEX_HOME: process.env.CODEX_HOME }
                    : {})
            }
        });
        await this.setupRequest("initialize", {
            clientInfo: { name: "peer3-review-service", version: "1" },
            capabilities: { experimentalApi: true }
        });
        this.process.write({ method: "initialized", params: {} });
        if (!modelAccess) return;
        const account = await this.setupRequest("account/read", {
            refreshToken: false
        });
        check(account.account?.type === "chatgpt", "LOGIN_EXPIRED");
        const models = await this.setupRequest("model/list", {
            includeHidden: true
        });
        check(
            models.data?.some(
                (model) => model.id === MODEL || model.model === MODEL
            ),
            "MODEL_UNAVAILABLE"
        );
    }
    async session(existingId, instructions) {
        const params = {
            model: MODEL,
            approvalPolicy: "never",
            sandbox: "read-only",
            cwd: this.config.runtimeRoot,
            developerInstructions: instructions,
            runtimeWorkspaceRoots: []
        };
        const response = existingId
            ? await this.setupRequest("thread/resume", {
                  ...params,
                  threadId: existingId
              })
            : await this.setupRequest("thread/start", {
                  ...params,
                  allowProviderModelFallback: false,
                  environments: [],
                  dynamicTools: TOOLS
              });
        check(
            response.thread?.id &&
                (!existingId || response.thread.id === existingId),
            "INVALID_RESULT"
        );
        this.threadId = response.thread.id;
        return this.threadId;
    }
    async turn(prompt, budget) {
        check(this.threadId, "INVALID_REQUEST");
        this.activity.phase = "waiting-for-model";
        return budget.run(
            async () => {
                let finish, fail;
                const complete = new Promise((resolve, reject) => {
                    finish = resolve;
                    fail = reject;
                });
                complete.catch(() => {});
                let text = "",
                    startedId = null;
                const early = [];
                const onFailure = (error) => fail(error);
                const onMessage = async (message) => {
                    try {
                        if (!startedId) {
                            check(early.length < 1000, "INVALID_RESULT");
                            early.push(message);
                            return;
                        }
                        const notificationTurn =
                            message.params?.turnId || message.params?.turn?.id;
                        if (
                            message.id === undefined &&
                            notificationTurn &&
                            notificationTurn !== startedId
                        )
                            return;
                        if (
                            message.params?.threadId === this.threadId &&
                            [
                                "item/started",
                                "item/completed",
                                "item/tool/call",
                                "item/agentMessage/delta",
                                "item/reasoning/summaryTextDelta",
                                "item/reasoning/textDelta",
                                "turn/completed"
                            ].includes(message.method)
                        ) {
                            this.activity.lastEventAt = Date.now();
                            if (message.method === "item/completed")
                                this.activity.completedItems++;
                            if (message.method === "item/tool/call")
                                this.activity.toolCalls++;
                            this.activity.phase =
                                message.method === "turn/completed"
                                    ? "completed"
                                    : message.method === "item/tool/call"
                                      ? "reading-source"
                                      : "model-event";
                        }
                        if (
                            message.method === "item/tool/call" &&
                            message.id !== undefined
                        ) {
                            check(
                                message.params.threadId === this.threadId &&
                                    message.params.turnId === startedId,
                                "UNAUTHORIZED"
                            );
                            this.process.write({
                                id: message.id,
                                result: await this.toolResult(
                                    message.params.tool,
                                    message.params.arguments
                                )
                            });
                        } else if (message.id !== undefined) {
                            this.process.write({
                                id: message.id,
                                error: {
                                    code: -32601,
                                    message: "Operation is not permitted."
                                }
                            });
                            throw new ReviewError("ISOLATION_UNVERIFIED");
                        } else if (
                            message.method === "item/completed" &&
                            message.params.threadId === this.threadId &&
                            message.params.item.type === "agentMessage"
                        )
                            text = message.params.item.text;
                        else if (
                            message.method === "turn/completed" &&
                            message.params.threadId === this.threadId
                        ) {
                            if (message.params.turn.status !== "completed")
                                throw providerFailure(
                                    message.params.turn.error
                                );
                            finish(text);
                        }
                    } catch (error) {
                        fail(error);
                    }
                };
                this.process.on("message", onMessage);
                this.process.on("failure", onFailure);
                try {
                    const started = await this.process.request("turn/start", {
                        threadId: this.threadId,
                        model: MODEL,
                        effort: this.config.effort,
                        approvalPolicy: "never",
                        environments: [],
                        input: [{ type: "text", text: prompt }]
                    });
                    this.turnId = started.turn.id;
                    startedId = this.turnId;
                    for (const message of early.splice(0))
                        await onMessage(message);
                    return await complete;
                } catch (error) {
                    // Keep the triggering error; the rejected stop promise still
                    // prevents the session owner from releasing this PR.
                    await this.stop().catch(() => {});
                    throw error;
                } finally {
                    this.process.off("message", onMessage);
                    this.process.off("failure", onFailure);
                }
            },
            () => this.stop()
        );
    }
    async toolResult(name, input) {
        let value;
        try {
            value = await this.tools.call(name, input);
        } catch (error) {
            return toolFailureResult(error);
        }
        const output = JSON.stringify(value);
        check(
            Buffer.byteLength(output) <= this.config.limits.maxBytes,
            "CONTEXT_BUDGET_EXCEEDED"
        );
        return {
            contentItems: [{ type: "inputText", text: output }],
            success: true
        };
    }
    async read(threadId) {
        return this.process.request("thread/read", {
            threadId,
            includeTurns: false
        });
    }
    async delete(threadId) {
        return this.process.request("thread/delete", { threadId });
    }
    async stop() {
        if (this.stopping) return this.stopping;
        this.stopping = (async () => {
            let timer;
            try {
                await Promise.race([
                    Promise.all([
                        this.process?.stop(this.config.limits.terminationMs),
                        this.tools.close?.()
                    ]),
                    new Promise((_, reject) => {
                        timer = setTimeout(
                            () =>
                                reject(new ReviewError("SERVICE_UNAVAILABLE")),
                            this.config.limits.terminationMs
                        );
                    })
                ]);
            } finally {
                clearTimeout(timer);
            }
        })();
        return this.stopping;
    }
}
module.exports = {
    CodexAdapter,
    NativeProcess,
    providerFailure,
    toolFailureResult,
    TOOLS
};

const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { check } = require("../data");
const { ReviewError } = require("../errors");
const {
    NativeProcess,
    TOOLS,
    setupTimeout,
    stopNative,
    toolFailureText,
    runTool
} = require("./native");
const { resolveExecutable, toolchainRoots } = require("../workspace");
// Features that reach outside the review sandbox. The model keeps its own
// shell, file and image tools, which run inside the sandbox profile below.
const DISABLED = [
    "apps",
    "browser_use",
    "browser_use_external",
    "browser_use_full_cdp_access",
    "computer_use",
    "hooks",
    "plugins",
    "multi_agent",
    "image_generation",
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
// Codex permission profile: only the listed paths exist inside the sandbox
// (":minimal" adds system directories), so worker secrets and logins are absent.
function sandboxArgs(workspace, codexPath) {
    const toml = (value) => JSON.stringify(value);
    const installed = resolveExecutable(codexPath);
    const filesystem = {
        ":minimal": "read",
        ...Object.fromEntries(
            [
                ...(installed ? [path.dirname(path.dirname(installed))] : []),
                ...toolchainRoots(),
                workspace.source,
                workspace.git,
                workspace.github
            ].map((root) => [root, "read"])
        ),
        [workspace.scratch]: "write"
    };
    return [
        "-c",
        'default_permissions="review"',
        "-c",
        `permissions.review.filesystem={${Object.entries(filesystem)
            .map(([key, access]) => `${toml(key)}=${toml(access)}`)
            .join(",")}}`,
        "-c",
        "permissions.review.network.enabled=false",
        // Commands see only core variables, never the worker's environment.
        "-c",
        'shell_environment_policy.inherit="core"',
        "-c",
        `shell_environment_policy.set={TMPDIR=${toml(path.join(workspace.scratch, "tmp"))}}`
    ];
}
// Headless: a request for human input is answered, never left waiting.
const HEADLESS_ANSWER =
    "No human is available: this review runs headless. Decide yourself and continue; record any open question in the review.";
function toolFailureResult(error) {
    return {
        success: false,
        contentItems: [{ type: "inputText", text: toolFailureText(error) }]
    };
}
class CodexAdapter {
    config;
    process;
    runtime = null;
    threadId = null;
    turnId = null;
    stopping = null;
    tools;
    // Sandbox folders for model turns; null for native cleanup only.
    workspace;
    setupDeadline = null;
    activity = {
        phase: "starting",
        lastEventAt: null,
        completedItems: 0,
        toolCalls: 0
    };
    constructor(config, tools, workspace = null) {
        this.config = config;
        this.tools = tools;
        this.workspace = workspace;
    }
    setupTimeout(maximum = 30000) {
        return setupTimeout(this.setupDeadline, maximum);
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
        // Versions are recorded, not enforced; see docs for the tested version.
        const installed = /^codex-cli (\S+)$/.exec(version)?.[1];
        check(installed, "MODEL_UNAVAILABLE");
        this.runtime = `codex-${installed}`;
        const args = DISABLED.flatMap((name) => ["--disable", name]);
        // Dynamic source tools use Code Mode.
        args.push("--enable", "code_mode_host");
        // Hosted web search runs outside the sandbox's network block.
        args.push("-c", 'web_search="disabled"');
        if (this.workspace)
            args.push(...sandboxArgs(this.workspace, this.config.codexPath));
        args.push("app-server");
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
                (model) =>
                    model.id === this.config.model ||
                    model.model === this.config.model
            ),
            "MODEL_UNAVAILABLE"
        );
    }
    async session(existingId, instructions) {
        const params = {
            model: this.config.model,
            approvalPolicy: "never",
            // No sandbox field: it would replace the default_permissions profile.
            cwd: this.workspace?.scratch || this.config.runtimeRoot,
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
                  // An empty list disables the model's own command environment.
                  ...(this.workspace ? {} : { environments: [] }),
                  dynamicTools: TOOLS
              });
        check(
            response.thread?.id &&
                (!existingId || response.thread.id === existingId),
            "INVALID_RESULT"
        );
        if (this.workspace)
            check(
                response.activePermissionProfile?.id === "review",
                "ISOLATION_UNVERIFIED"
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
                        } else if (
                            message.method === "item/tool/requestUserInput" &&
                            message.id !== undefined
                        ) {
                            this.process.write({
                                id: message.id,
                                result: {
                                    answers: Object.fromEntries(
                                        message.params.questions.map(
                                            (question) => [
                                                question.id,
                                                { answers: [HEADLESS_ANSWER] }
                                            ]
                                        )
                                    )
                                }
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
                        model: this.config.model,
                        effort: this.config.effort,
                        approvalPolicy: "never",
                        ...(this.workspace ? {} : { environments: [] }),
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
        const outcome = await runTool(
            this.tools,
            name,
            input,
            this.config.limits.maxBytes
        );
        return {
            contentItems: [{ type: "inputText", text: outcome.text }],
            success: outcome.success
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
        if (!this.stopping)
            this.stopping = stopNative(
                this.process,
                this.tools,
                this.config.limits.terminationMs
            );
        return this.stopping;
    }
}
module.exports = { CodexAdapter, providerFailure, toolFailureResult };

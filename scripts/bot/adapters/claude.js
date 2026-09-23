const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { check } = require("../data");
const { ReviewError } = require("../errors");
const {
    NativeProcess,
    TOOLS,
    runTool,
    setupTimeout,
    stopNative
} = require("./native");
const { secretRoots, toolchainRoots } = require("../workspace");
// The CLI exposes worker-served tools as mcp__<server>__<tool>.
const SERVER = "review";
const TOOL_NAMES = TOOLS.map((tool) => `mcp__${SERVER}__${tool.name}`);
// Above the CLI's default size threshold a result is replaced by a 2 KB preview
// and a saved file the model cannot open; raise it to the CLI's maximum.
const LISTED_TOOLS = TOOLS.map((tool) => ({
    ...tool,
    _meta: { "anthropic/maxResultSizeChars": 500000 }
}));
const SESSION_ID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// The model's own tools. Shell commands run in Claude Code's bubblewrap sandbox;
// Read/Edit/Write are held to the workspace by permission rules.
const BUILT_IN = ["Bash", "Edit", "Read", "Write"];
// Settings for a sandboxed headless review; `//` prefixes an absolute path.
function sandboxSettings(workspace, stateRoot) {
    const absolute = (value) => `/${value}`;
    const readable = [
        workspace.source,
        workspace.git,
        workspace.github,
        workspace.scratch,
        ...toolchainRoots()
    ];
    return {
        sandbox: {
            enabled: true,
            failIfUnavailable: true,
            allowUnsandboxedCommands: false,
            autoAllowBashIfSandboxed: true,
            // As root the strict mode cannot map its user namespace; the
            // weaker mode keeps the file and network rules below.
            enableWeakerNestedSandbox: process.getuid?.() === 0,
            filesystem: {
                denyRead: secretRoots(stateRoot).map(absolute),
                allowRead: readable.map(absolute),
                allowWrite: [absolute(workspace.scratch)],
                denyWrite: [
                    workspace.source,
                    workspace.git,
                    workspace.github
                ].map(absolute)
            },
            network: { allowedDomains: [] }
        },
        permissions: {
            blockReadsOutsideWorkingDirectories: true,
            additionalDirectories: [
                workspace.source,
                workspace.git,
                workspace.github
            ],
            allow: [
                `Write(${absolute(workspace.scratch)}/**)`,
                `Edit(${absolute(workspace.scratch)}/**)`
            ],
            deny: ["WebFetch", "WebSearch"]
        }
    };
}
function providerFailure(code, status) {
    if (["rate_limit", "billing_error"].includes(code) || status === 429)
        return new ReviewError("SUBSCRIPTION_LIMIT");
    if (code === "authentication_failed" || status === 401)
        return new ReviewError("LOGIN_EXPIRED");
    if (code === "model_not_found" || status === 404)
        return new ReviewError("MODEL_UNAVAILABLE");
    return new ReviewError("SERVICE_UNAVAILABLE");
}
class ClaudeAdapter {
    config;
    process;
    runtime = null;
    sessionId = null;
    instructionsFile = null;
    settingsFile = null;
    // Sandbox folders for model turns; null keeps only the worker tools.
    workspace;
    stopping = null;
    tools;
    setupDeadline = null;
    // Set while a turn runs; tool calls outside a turn are refused.
    active = null;
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
    environment() {
        // No API key is passed: reviews run on the CLI's claude.ai login only.
        return {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            // The CLI's default 25k-token MCP result cap rejects full GitHub
            // pages, and the model then re-pages in tiny requests. The worker's
            // own maxBytes check is the limit; a token is at least one byte.
            MAX_MCP_OUTPUT_TOKENS: String(this.config.limits.maxBytes),
            ...(process.env.CLAUDE_CONFIG_DIR
                ? { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR }
                : {})
        };
    }
    cli(args) {
        return execFileSync(this.config.claudePath, args, {
            encoding: "utf8",
            timeout: setupTimeout(this.setupDeadline, 10000),
            env: this.environment(),
            stdio: ["ignore", "pipe", "ignore"]
        }).trim();
    }
    async open({ modelAccess = true, deadline = null } = {}) {
        this.setupDeadline = deadline;
        await fs.mkdir(this.config.runtimeRoot, {
            recursive: true,
            mode: 0o700
        });
        // Versions are recorded, not enforced; see docs for the tested version.
        const installed = /^(\S+) \(Claude Code\)$/.exec(
            this.cli(["--version"])
        )?.[1];
        check(installed, "MODEL_UNAVAILABLE");
        this.runtime = `claude-${installed}`;
        if (!modelAccess) return;
        let auth;
        try {
            auth = JSON.parse(this.cli(["auth", "status"]));
        } catch {
            throw new ReviewError("LOGIN_EXPIRED");
        }
        check(
            auth.loggedIn === true && auth.authMethod === "claude.ai",
            "LOGIN_EXPIRED"
        );
    }
    async session(existingId, instructions) {
        check(!existingId || SESSION_ID.test(existingId), "INVALID_RESULT");
        const id = existingId || crypto.randomUUID();
        this.instructionsFile = path.join(
            this.config.runtimeRoot,
            `${crypto.randomUUID()}-instructions.md`
        );
        await fs.writeFile(this.instructionsFile, instructions, {
            mode: 0o600
        });
        if (this.workspace) {
            this.settingsFile = path.join(
                this.config.runtimeRoot,
                `${crypto.randomUUID()}-settings.json`
            );
            await fs.writeFile(
                this.settingsFile,
                JSON.stringify(
                    sandboxSettings(this.workspace, this.config.stateRoot)
                ),
                { mode: 0o600 }
            );
        }
        const args = [
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--model",
            this.config.model,
            "--effort",
            this.config.effort,
            // No settings files, skills, plugins or user MCP servers. With a
            // workspace the model also keeps its sandboxed built-in tools.
            "--tools",
            this.workspace ? BUILT_IN.join(",") : "",
            "--setting-sources",
            "",
            ...(this.settingsFile ? ["--settings", this.settingsFile] : []),
            "--disable-slash-commands",
            "--strict-mcp-config",
            "--mcp-config",
            JSON.stringify({
                mcpServers: { [SERVER]: { type: "sdk", name: SERVER } }
            }),
            // Headless: anything not allowed is denied, never asked about.
            "--permission-mode",
            "dontAsk",
            "--permission-prompts",
            "none",
            "--allowedTools",
            ...TOOL_NAMES,
            "--system-prompt-file",
            this.instructionsFile,
            ...(existingId ? ["--resume", id] : ["--session-id", id])
        ];
        this.process = new NativeProcess(this.config.claudePath, args, {
            cwd: this.workspace?.scratch || this.config.runtimeRoot,
            env: this.environment()
        });
        this.process.on("message", (message) =>
            this.control(message).catch((error) => this.process.fail(error))
        );
        const requestId = crypto.randomUUID();
        const initialized = new Promise((resolve, reject) => {
            const timer = setTimeout(
                () =>
                    reject(
                        new ReviewError(
                            this.setupDeadline !== null &&
                            performance.now() >= this.setupDeadline
                                ? "SETUP_TIMEOUT"
                                : "SERVICE_UNAVAILABLE"
                        )
                    ),
                setupTimeout(this.setupDeadline)
            );
            const onMessage = (message) => {
                if (
                    message.type !== "control_response" ||
                    message.response?.request_id !== requestId
                )
                    return;
                clearTimeout(timer);
                this.process.off("message", onMessage);
                this.process.off("failure", onFailure);
                if (message.response.subtype === "success") resolve();
                else reject(new ReviewError("SERVICE_UNAVAILABLE"));
            };
            const onFailure = (error) => {
                clearTimeout(timer);
                reject(error);
            };
            this.process.on("message", onMessage);
            this.process.on("failure", onFailure);
        });
        this.process.write({
            type: "control_request",
            request_id: requestId,
            request: { subtype: "initialize", sdkMcpServers: [SERVER] }
        });
        await initialized;
        this.sessionId = id;
        return id;
    }
    // Serves the CLI's in-band MCP requests; anything else is refused.
    async control(message) {
        if (message.type !== "control_request") return;
        const request = message.request;
        if (
            request?.subtype !== "mcp_message" ||
            request.server_name !== SERVER
        ) {
            this.process.write({
                type: "control_response",
                response: {
                    subtype: "error",
                    request_id: message.request_id,
                    error: "Operation is not permitted."
                }
            });
            throw new ReviewError("ISOLATION_UNVERIFIED");
        }
        const rpc = request.message;
        let reply;
        if (rpc.method === "initialize")
            reply = {
                result: {
                    protocolVersion: rpc.params.protocolVersion,
                    capabilities: { tools: {} },
                    serverInfo: { name: SERVER, version: "1" }
                }
            };
        else if (rpc.method === "tools/list")
            reply = { result: { tools: LISTED_TOOLS } };
        else if (rpc.method === "tools/call") {
            check(this.active, "ISOLATION_UNVERIFIED");
            this.activity.toolCalls++;
            this.activity.phase = "reading-source";
            this.activity.lastEventAt = Date.now();
            const outcome = await runTool(
                this.tools,
                rpc.params.name,
                rpc.params.arguments,
                this.config.limits.maxBytes
            );
            reply = {
                result: {
                    content: [{ type: "text", text: outcome.text }],
                    isError: !outcome.success
                }
            };
        } else if (rpc.id === undefined) reply = { result: {} };
        else
            reply = {
                error: { code: -32601, message: "Method not found" }
            };
        this.process.write({
            type: "control_response",
            response: {
                subtype: "success",
                request_id: message.request_id,
                response: {
                    mcp_response: { jsonrpc: "2.0", id: rpc.id ?? 0, ...reply }
                }
            }
        });
    }
    async turn(prompt, budget) {
        check(this.sessionId && !this.active, "INVALID_REQUEST");
        this.activity.phase = "waiting-for-model";
        return budget.run(
            async () => {
                let finish, fail;
                const complete = new Promise((resolve, reject) => {
                    finish = resolve;
                    fail = reject;
                });
                complete.catch(() => {});
                let errorCode = null;
                const onFailure = (error) => fail(error);
                const onMessage = (message) => {
                    try {
                        if (
                            ["system", "assistant", "user", "result"].includes(
                                message.type
                            )
                        ) {
                            check(
                                message.session_id === this.sessionId,
                                "UNAUTHORIZED"
                            );
                            this.activity.lastEventAt = Date.now();
                        }
                        if (
                            message.type === "system" &&
                            message.subtype === "init"
                        ) {
                            // The session must expose exactly the worker tools.
                            check(
                                JSON.stringify([...message.tools].sort()) ===
                                    JSON.stringify(
                                        [
                                            ...(this.workspace ? BUILT_IN : []),
                                            ...TOOL_NAMES
                                        ].sort()
                                    ),
                                "ISOLATION_UNVERIFIED"
                            );
                            this.activity.phase = "model-event";
                        } else if (message.type === "assistant") {
                            this.activity.completedItems++;
                            this.activity.phase = "model-event";
                            if (message.error) errorCode = message.error;
                        } else if (message.type === "result") {
                            this.activity.phase = "completed";
                            if (message.is_error)
                                throw providerFailure(
                                    errorCode,
                                    message.api_error_status
                                );
                            check(
                                typeof message.result === "string",
                                "INVALID_RESULT"
                            );
                            finish(message.result);
                        }
                    } catch (error) {
                        fail(error);
                    }
                };
                this.process.on("message", onMessage);
                this.process.on("failure", onFailure);
                this.active = true;
                try {
                    this.process.write({
                        type: "user",
                        message: { role: "user", content: prompt },
                        parent_tool_use_id: null,
                        session_id: this.sessionId
                    });
                    return await complete;
                } catch (error) {
                    // Keep the triggering error; the rejected stop promise still
                    // prevents the session owner from releasing this PR.
                    await this.stop().catch(() => {});
                    throw error;
                } finally {
                    this.active = null;
                    this.process.off("message", onMessage);
                    this.process.off("failure", onFailure);
                }
            },
            () => this.stop()
        );
    }
    // Claude keeps transcripts as <config>/projects/<cwd-slug>/<id>.jsonl.
    async delete(sessionId) {
        check(SESSION_ID.test(sessionId), "INVALID_REQUEST");
        const projects = path.join(
            process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
            "projects"
        );
        let directories;
        try {
            directories = await fs.readdir(projects, { withFileTypes: true });
        } catch (error) {
            if (error.code === "ENOENT") return;
            throw error;
        }
        for (const entry of directories.filter((item) => item.isDirectory()))
            for (const name of [`${sessionId}.jsonl`, sessionId])
                await fs.rm(path.join(projects, entry.name, name), {
                    recursive: true,
                    force: true
                });
    }
    async stop() {
        if (!this.stopping)
            this.stopping = stopNative(
                this.process,
                this.tools,
                this.config.limits.terminationMs
            ).finally(async () => {
                for (const file of [this.instructionsFile, this.settingsFile])
                    if (file) await fs.rm(file, { force: true });
            });
        return this.stopping;
    }
}
module.exports = {
    ClaudeAdapter,
    providerFailure,
    sandboxSettings,
    BUILT_IN,
    TOOL_NAMES
};

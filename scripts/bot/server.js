const fs = require("node:fs/promises");
const path = require("node:path");
const { configuration, policyDigest } = require("./config");
const { check, digest, writeJson, writeText, ownedPath } = require("./data");
const { sanitized } = require("./errors");
const protocol = require("./protocol");
const { Sessions } = require("./sessions");
const { Worktrees, git } = require("./worktrees");
const { SourceTools } = require("./source-tools");
const {
    PublicGitHub,
    ContextBudget,
    PublicAccounting
} = require("./github-read");
const { CodexAdapter } = require("./adapters/codex");
const { ReviewConnection } = require("./transport");
const { bundleDigest } = require("./request");
const { validateReport } = require("./review-format");
const { acquireOsFileLock } = require("../e2e-parallel/distributed/hostLock");
class ReviewService {
    config;
    sessions;
    worktrees;
    lock;
    skillDigest;
    botRevision;
    policyDigest;
    instructions;
    prompt;
    connections = new Set();
    adapters = new Map();
    operations = new Set();
    closing = false;
    publicAccounting;
    maintenanceTimer = null;
    maintenance = null;
    constructor(config) {
        this.config = configuration(config);
        this.publicAccounting = new PublicAccounting(this.config.limits);
        this.sessions = new Sessions(
            path.join(this.config.stateRoot, "sessions"),
            this.config.limits
        );
        this.worktrees = new Worktrees(
            path.join(this.config.stateRoot, "worktrees")
        );
    }
    async start() {
        await fs.mkdir(this.config.stateRoot, { recursive: true, mode: 0o700 });
        this.lock = acquireOsFileLock(
            path.join(this.config.stateRoot, "service.lock"),
            "Another review service owns this state root."
        );
        try {
            await this.sessions.initialize();
            await this.worktrees.initialize();
            const skillRoot = path.join(__dirname, "skill");
            this.skillDigest = await bundleDigest(skillRoot);
            this.policyDigest = policyDigest(this.config.limits);
            this.botRevision = git(
                ["log", "-1", "--format=%H", "--", "scripts/bot"],
                path.resolve(__dirname, "../..")
            );
            const files = [
                "references/automation.md",
                "SKILL.md",
                "inherited/review-implementation/SKILL.md",
                "inherited/review-implementation/example-review.md",
                "inherited/no-ai-slop/SKILL.md",
                "inherited/no-ai-slop/eval.md",
                "references/publishing.md"
            ];
            this.instructions = (
                await Promise.all(
                    files.map((file) =>
                        fs.readFile(path.join(skillRoot, file), "utf8")
                    )
                )
            ).join("\n\n");
            this.prompt = await fs.readFile(
                path.join(skillRoot, "references/review-prompt.md"),
                "utf8"
            );
            this.maintenanceTimer = setInterval(
                () =>
                    this.maintain().catch((error) =>
                        console.error(sanitized(error).message)
                    ),
                24 * 60 * 60 * 1000
            );
        } catch (error) {
            await this.close();
            throw sanitized(error);
        }
    }
    attach(peer, authenticatedKey) {
        const connection = new ReviewConnection(
            peer.stream,
            this.config.limits,
            peer
        );
        connection.authenticatedKey = authenticatedKey;
        this.connections.add(connection);
        connection.on("close", () => this.connections.delete(connection));
        connection.on("failure", () => connection.close());
        connection.on(
            "payload",
            ({ operation, requestId, attemptId, value }) => {
                const task = this.handle(
                    connection,
                    operation,
                    value,
                    requestId,
                    attemptId
                ).catch(() => connection.close());
                this.operations.add(task);
                task.finally(() => this.operations.delete(task));
            }
        );
        connection.activate(false);
        return connection;
    }
    authorize(input, connection) {
        check(!this.closing, "SERVICE_UNAVAILABLE");
        protocol.request(input);
        check(input.caller === connection.authenticatedKey, "UNAUTHORIZED");
        check(
            input.skillDigest === this.skillDigest &&
                input.botRevision === this.botRevision,
            "UNAUTHORIZED"
        );
        check(input.policyDigest === this.policyDigest, "UNAUTHORIZED");
        check(
            input.runtime === `codex-${this.config.codexVersion}`,
            "MODEL_UNAVAILABLE"
        );
    }
    async handle(connection, operation, value, requestId, attemptId) {
        const input = operation === "request" ? value : value.request;
        let progress;
        try {
            this.authorize(input, connection);
            check(input.attempt === attemptId);
            if (operation === "request") {
                const current = this.sessions.slots.get(
                    this.sessions.key(input)
                )?.active;
                if (current?.context?.gathered() && !current.result) {
                    current.evidenceIdentity =
                        current.context.budget.identity();
                    current.effective = protocol.effectiveIdentity(
                        current.request,
                        current.evidenceIdentity
                    );
                }
                const contextIdentity =
                    current?.result?.evidence.identity ||
                    current?.evidenceIdentity ||
                    digest({ pending: input.attempt });
                progress = setInterval(() => {
                    const active = this.sessions.slots.get(
                        this.sessions.key(input)
                    )?.active;
                    if (
                        active?.budget.active !== null &&
                        active?.deliveries.some(
                            (delivery) =>
                                delivery.request.attempt === input.attempt
                        )
                    )
                        connection
                            .progress(requestId, attemptId, active.id)
                            .catch(() => connection.close());
                }, this.config.limits.progressMs);
                let preparation;
                const result = await this.sessions.submit(
                    input,
                    contextIdentity,
                    (execution) => this.execute(input, execution, preparation),
                    async (active) => {
                        if (active)
                            return active.context?.gathered()
                                ? active.context.fresh([
                                      ...active.context.budget.sources
                                  ])
                                : false;
                        const setupDeadline =
                            performance.now() + this.config.limits.setupMs;
                        const context = new PublicGitHub(
                            input.repository,
                            input.pr,
                            new ContextBudget(
                                this.config.limits,
                                this.publicAccounting
                            )
                        );
                        const pr = await context.read(
                            `https://api.github.com/repos/${input.repository.name}/pulls/${input.pr}`
                        );
                        preparation = { context, pr, setupDeadline };
                        return pr.data.head.sha === input.head;
                    }
                );
                await connection.send("result", requestId, attemptId, result);
            } else if (operation === "correction") {
                const result = await this.sessions.correct(
                    input,
                    value.correction,
                    (execution, prompt) =>
                        this.correct(input, execution, prompt)
                );
                await connection.send("result", requestId, attemptId, result);
            } else if (
                operation === "receipt" ||
                operation === "acknowledgement"
            ) {
                await this.sessions.acknowledge(
                    input,
                    value.executionId,
                    value.receipt
                );
                await connection.send("acknowledgement", requestId, attemptId, {
                    accepted: true
                });
            } else check(false);
        } catch (error) {
            await connection.send(
                "failure",
                requestId,
                attemptId,
                protocol.failure(sanitized(error), input)
            );
        } finally {
            clearInterval(progress);
        }
    }
    async execute(input, execution, preparation) {
        const setupDeadline =
            preparation?.setupDeadline ||
            performance.now() + this.config.limits.setupMs;
        const context =
            preparation?.context ||
            new PublicGitHub(
                input.repository,
                input.pr,
                new ContextBudget(this.config.limits, this.publicAccounting)
            );
        const budget = context.budget;
        execution.context = context;
        const pr =
            preparation?.pr ||
            (await context.read(
                `https://api.github.com/repos/${input.repository.name}/pulls/${input.pr}`
            ));
        const tree = await this.worktrees.prepare(
            input,
            pr.data,
            setupDeadline
        );
        execution.sourceBase = tree.base;
        const outputRoot = await ownedPath(
            tree.checkout,
            `temp/pr-github-reviews/${input.pr}`,
            true
        );
        await fs.mkdir(outputRoot, { recursive: true, mode: 0o700 });
        const tools = new SourceTools(
            tree.checkout,
            input,
            context,
            outputRoot
        );
        const adapter = new CodexAdapter(this.config, tools);
        this.adapters.set(execution.id, adapter);
        execution.adapter = adapter;
        execution.tools = tools;
        execution.release = async () => {
            await adapter.stop();
            this.adapters.delete(execution.id);
        };
        try {
            await adapter.open({ deadline: setupDeadline });
            const previous = this.sessions.previous.get(
                this.sessions.key(input)
            );
            execution.sessionId = await adapter.session(
                previous?.sessionId || null,
                this.instructions
            );
            execution.nativeProcessPid = adapter.process.child.pid;
            execution.request = input;
            await this.sessions.persist(this.sessions.key(input), execution);
            check(performance.now() < setupDeadline, "SETUP_TIMEOUT");
            execution.evidenceIdentity = budget.identity();
            execution.effective = protocol.effectiveIdentity(
                input,
                execution.evidenceIdentity
            );
            return await this.generate(
                input,
                execution,
                { ...input, base: tree.base },
                outputRoot
            );
        } catch (error) {
            await adapter.stop();
            const failure = sanitized(error);
            failure.diagnostics = {
                requests: budget.requests,
                pages: budget.pages,
                bytes: budget.bytes,
                modelMs: execution.budget.consumed,
                validationMs: execution.validationMs,
                limits: {
                    requests: budget.limits.contextRequests,
                    pages: budget.limits.contextPages,
                    bytes: budget.limits.contextBytes,
                    elapsedMs: budget.limits.contextMs
                },
                sources: budget.sources.map((source) => source.url)
            };
            throw failure;
        }
    }
    async generate(input, execution, source, outputRoot) {
        const generated = await execution.adapter.turn(
            this.prompt +
                "\nController-bound input:\n" +
                JSON.stringify(source),
            execution.budget
        );
        execution.initialGatheringMs = execution.tools.gatheringMs;
        try {
            return await this.complete(input, execution, generated, outputRoot);
        } catch (error) {
            if (!["INVALID_RESULT", "INVALID_REQUEST"].includes(error.code))
                throw error;
            execution.correctionUsed = true;
            execution.revision = 1;
            await this.sessions.persist(this.sessions.key(input), execution);
            const correction = {
                version: 1,
                kind: "invalid-format",
                binding: protocol.binding(input),
                executionId: execution.id,
                resultRevision: 0,
                effectiveIdentity: execution.effective,
                ids: ["schema:result"]
            };
            const corrected = await execution.adapter.turn(
                protocol.correctionPrompt(correction, input),
                execution.budget
            );
            return this.complete(input, execution, corrected, outputRoot);
        }
    }
    async complete(
        input,
        execution,
        generated,
        outputRoot,
        revision = execution.revision
    ) {
        if (typeof generated === "string") {
            try {
                generated = JSON.parse(generated);
            } catch {
                check(false, "INVALID_RESULT");
            }
        }
        check(
            generated &&
                typeof generated === "object" &&
                !Array.isArray(generated),
            "INVALID_RESULT"
        );
        const budget = execution.context.budget;
        if (generated.coverage?.complete)
            check(execution.context.gathered(), "INVALID_RESULT");
        if (!execution.result)
            execution.effective = protocol.effectiveIdentity(
                input,
                budget.identity()
            );
        Object.assign(generated, {
            version: 1,
            binding: protocol.binding(input),
            executionId: execution.id,
            revision,
            effectiveIdentity: execution.effective,
            sessionId: execution.sessionId,
            runtime: input.runtime
        });
        generated.evidence = {
            identity: budget.identity(),
            sources: structuredClone(budget.sources),
            requests: budget.requests,
            pages: budget.pages,
            bytes: budget.bytes,
            limits: {
                requests: budget.limits.contextRequests,
                pages: budget.limits.contextPages,
                bytes: budget.limits.contextBytes,
                elapsedMs: budget.limits.contextMs
            },
            cacheHits: budget.cacheHits,
            durations: {
                gatheringMs: Math.min(
                    execution.initialGatheringMs || 0,
                    execution.budget.durations[0] || 0
                ),
                assessmentMs: Math.max(
                    0,
                    (execution.budget.durations[0] || 0) -
                        (execution.initialGatheringMs || 0)
                ),
                correctionMs: execution.budget.durations[1] || 0,
                modelMs: execution.budget.consumed,
                validationMs: execution.validationMs,
                turns: execution.budget.durations
            },
            errors: generated.evidence?.errors || []
        };
        protocol.result(generated, input);
        check(
            validateReport(generated, input).document.baseSha ===
                (execution.sourceBase || input.base),
            "INVALID_RESULT"
        );
        await writeJson(
            outputRoot,
            `${input.attempt}-${revision}.json`,
            generated
        );
        await writeText(
            outputRoot,
            `${input.attempt}-${revision}-review.md`,
            generated.report
        );
        execution.outputRoot = outputRoot;
        return generated;
    }
    async correct(input, execution, prompt) {
        const generated = await execution.adapter.turn(
            prompt,
            execution.budget
        );
        return this.complete(
            input,
            execution,
            generated,
            execution.outputRoot,
            execution.revision + 1
        );
    }
    async maintain() {
        if (this.maintenance) return this.maintenance;
        const { LifecycleCleanup } = require("./cleanup");
        const cleanup = new LifecycleCleanup({
            worktrees: this.worktrees,
            sessions: this.sessions,
            repositories: null,
            limits: this.config.limits,
            accounting: this.publicAccounting,
            deleteNative: async (threadId) => {
                const adapter = new CodexAdapter(this.config, {
                    close: async () => {}
                });
                try {
                    await adapter.open({ modelAccess: false });
                    await adapter.delete(threadId);
                } finally {
                    await adapter.stop();
                }
            }
        });
        this.maintenance = cleanup.run();
        try {
            return await this.maintenance;
        } finally {
            this.maintenance = null;
        }
    }
    async close() {
        this.closing = true;
        this.sessions.stopping = true;
        clearInterval(this.maintenanceTimer);
        if (this.maintenance) await this.maintenance;
        for (const adapter of this.adapters.values()) await adapter.stop();
        await this.sessions.close();
        await Promise.all([...this.operations]);
        for (const connection of this.connections) connection.close();
        this.lock?.release();
    }
}
module.exports = { ReviewService };

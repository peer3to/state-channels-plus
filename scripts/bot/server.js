const fs = require("node:fs/promises");
const path = require("node:path");
const { configuration, policyDigest } = require("./config");
const { check, digest, writeJson, writeText, ownedPath } = require("./data");
const { sanitized, ReviewError } = require("./errors");
const protocol = require("./protocol");
const { Sessions } = require("./sessions");
const { PublicationStore } = require("./publication-store");
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
const { validateReport, validateInlineTargets } = require("./review-format");
const {
    decodeModelResult,
    repairModelResult,
    formatFeedback
} = require("./markdown-result");
const { acquireOsFileLock } = require("../e2e-parallel/distributed/hostLock");
class ReviewService {
    config;
    sessions;
    publications;
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
        this.publications = new PublicationStore(this.sessions.root);
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
                "SKILL.md",
                "inherited/review-implementation/SKILL.md",
                "inherited/review-implementation/example-review.md",
                "references/automation.md",
                "references/source-review.md",
                "references/model-output.md"
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
            if (["request", "correction"].includes(operation))
                progress = setInterval(() => {
                    const active = this.sessions.slots.get(
                        this.sessions.key(input)
                    )?.active;
                    if (
                        active?.deliveries.some(
                            (delivery) =>
                                delivery.request.attempt === input.attempt
                        )
                    )
                        connection
                            .progress(
                                requestId,
                                attemptId,
                                active.id,
                                active.adapter?.activity
                            )
                            .catch(() => connection.close());
                }, this.config.limits.progressMs);
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
                            ),
                            undefined,
                            input.head,
                            input.resolvedThreads
                        );
                        const pr = await context.read(
                            `https://api.github.com/repos/${input.repository.name}/pulls/${input.pr}`
                        );
                        preparation = { context, pr, setupDeadline };
                        return pr.data.head.sha === input.head;
                    }
                );
                await connection.send("result", requestId, attemptId, result);
            } else if (operation === "publication") {
                const delivery = this.sessions.attempts.get(
                    this.sessions.attemptKey(input)
                );
                check(
                    delivery &&
                        delivery.requestDigest === digest(input) &&
                        !delivery.failure,
                    "UNAUTHORIZED"
                );
                const generated = await delivery.promise;
                check(
                    generated.executionId === value.executionId,
                    "UNAUTHORIZED"
                );
                const publication =
                    value.states === undefined
                        ? await this.publications.load(input)
                        : await this.publications.save(
                              input,
                              value.previous,
                              value.states
                          );
                await connection.send("acknowledgement", requestId, attemptId, {
                    accepted: true,
                    publication
                });
            } else if (operation === "correction") {
                const result = await this.sessions.correct(
                    input,
                    value.correction,
                    (execution, prompt) =>
                        this.correct(
                            input,
                            execution,
                            prompt,
                            value.correction.ids
                        )
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
                new ContextBudget(this.config.limits, this.publicAccounting),
                undefined,
                input.head,
                input.resolvedThreads
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
        execution.repoRoot = tree.checkout;
        const outputRoot = await ownedPath(
            tree.checkout,
            `temp/pr-github-reviews/${input.pr}`,
            true
        );
        await fs.mkdir(outputRoot, { recursive: true, mode: 0o700 });
        const tools = new SourceTools(tree.checkout, input, context);
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
            const baseline = await this.sessions.baseline(input);
            // Recover older workers' cleared registry IDs from confirmed history.
            execution.sessionId =
                previous?.sessionId || baseline?.sessionId || null;
            execution.sessionId = await adapter.session(
                execution.sessionId,
                this.instructions
            );
            const incremental =
                baseline?.sessionId === execution.sessionId
                    ? tools.setBaseline(baseline)
                    : null;
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
                {
                    ...input,
                    base: tree.base,
                    incremental,
                    previousFindings:
                        (await this.publications.load(input)).states
                            .at(-1)
                            ?.findings.filter(
                                (finding) =>
                                    !(input.resolvedThreads || []).some(
                                        (thread) =>
                                            thread.id === finding.threadId
                                    )
                            )
                            .map((finding) => ({
                                id: finding.id,
                                status: finding.status,
                                threadId: finding.threadId,
                                ...(previous?.sessionId
                                    ? {}
                                    : {
                                          body: finding.body,
                                          path: finding.path,
                                          line: finding.line,
                                          evidence: finding.evidence,
                                          human: finding.human
                                      }),
                                sourceId: `finding:${finding.id}`,
                                sourceRevision: digest(finding)
                            })) || []
                },
                outputRoot
            );
        } catch (error) {
            // release() retries the same stop promise and quarantines failures.
            // Cleanup must not replace the original model/validation error.
            await adapter.stop().catch(() => {});
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
                    bytes: budget.limits.contextBytes
                },
                sources: budget.sources.map((source) => source.url)
            };
            throw failure;
        }
    }
    async generate(input, execution, source, outputRoot) {
        const generated = await execution.adapter.turn(
            this.currentPolicyPrompt(this.prompt) +
                "\nController-bound input:\n" +
                JSON.stringify({
                    ...source,
                    modelBudgetRemainingMs: Math.floor(
                        execution.budget.remaining()
                    ),
                    modelDeadlineUtc: new Date(
                        Date.now() + execution.budget.remaining()
                    ).toISOString()
                }),
            execution.budget
        );
        execution.initialGatheringMs = execution.tools.gatheringMs;
        return this.completeWithRepair(input, execution, generated, outputRoot);
    }
    async completeWithRepair(
        input,
        execution,
        generated,
        outputRoot,
        revision = execution.revision
    ) {
        let repair = 0;
        while (true) {
            // Keep completed work even when validation or a later model turn fails.
            if (typeof generated === "string")
                await writeText(
                    outputRoot,
                    `${input.attempt}-${revision}-draft-${repair}.md`,
                    generated
                );
            try {
                return await this.complete(
                    input,
                    execution,
                    generated,
                    outputRoot,
                    revision
                );
            } catch (error) {
                if (
                    ![
                        "INVALID_RESULT",
                        "INVALID_REQUEST",
                        "REVIEW_INCOMPLETE"
                    ].includes(error.code)
                )
                    throw error;
                // No new revision has been accepted yet. Preserve CI's accounting
                // correction slot and public result revision during format repair.
                await this.sessions.persist(
                    this.sessions.key(input),
                    execution
                );
                const correction = {
                    version: 1,
                    kind: "invalid-format",
                    binding: protocol.binding(input),
                    executionId: execution.id,
                    resultRevision: revision,
                    effectiveIdentity: execution.effective,
                    ids: ["schema:result"]
                };
                const corrected = await execution.adapter.turn(
                    protocol.correctionPrompt(correction, input) +
                        "\nValidation feedback: " +
                        (error.validationFeedback ||
                            (execution.context.gathered()
                                ? formatFeedback(generated)
                                : "Controller evidence is incomplete. Read the missing required PR/discussion collections and every next page; recover failed reads before claiming coverage.complete. Rewriting the report cannot repair missing retrieval evidence.")) +
                        (error.code === "REVIEW_INCOMPLETE"
                            ? "\nContinue the existing review from its saved draft. Finish the missing source/discussion/lens work using the available tools; retain completed analysis and finding IDs. Controller-confirmed resolved threads are intentionally out of scope, not missing evidence. Tests are not required: record unavailable runtime verification separately. Do not merely change Complete to yes: finish genuinely missing work before returning the complete Markdown review."
                            : "\nRepair the existing draft, not the review analysis. Return the corrected Markdown document. Do not repeat source reads unless needed to resolve an actual missing fact.") +
                        this.remainingPrompt(execution),
                    execution.budget
                );
                generated = repairModelResult(generated, corrected);
                repair++;
            }
        }
    }
    async complete(
        input,
        execution,
        generated,
        outputRoot,
        revision = execution.revision
    ) {
        const previous =
            (await this.publications.load(input)).states.at(-1)?.findings || [];
        const revisions = new Map(execution.context.revisions || []);
        for (const finding of previous)
            revisions.set(`finding:${finding.id}`, digest(finding));
        generated = decodeModelResult(generated, {
            request: input,
            sourceBase: execution.sourceBase || input.base,
            revisions,
            previous
        });
        const required = [
            ...(execution.context.requiredDiscussion || []),
            ...previous
                .filter(
                    (finding) =>
                        !["fixed", "disagreement"].includes(finding.status) &&
                        !(input.resolvedThreads || []).some(
                            (thread) =>
                                thread.id === finding.threadId &&
                                !execution.reopenedThreads?.has(thread.id)
                        )
                )
                .map((finding) => `finding:${finding.id}`)
        ];
        const missing = required.filter(
            (id) =>
                !generated?.accounting?.some(
                    (entry) =>
                        entry.sourceId === id &&
                        entry.sourceRevision === revisions.get(id)
                )
        );
        if (missing.length) {
            const error = new ReviewError("INVALID_RESULT");
            error.validationFeedback = `The saved review is missing dispositions for: ${missing.join(", ")}. Add the discussion assessment rows or existing finding dispositions. The worker supplies revision hashes; do not generate them.`;
            throw error;
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
                bytes: budget.limits.contextBytes
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
                correctionMs: execution.budget.durations
                    .slice(1)
                    .reduce((sum, duration) => sum + duration, 0),
                modelMs: execution.budget.consumed,
                validationMs: execution.validationMs,
                turns: execution.budget.durations
            },
            errors: generated.evidence?.errors || []
        };
        protocol.result(generated, input);
        try {
            protocol.requireCompleteReview(generated);
        } catch (error) {
            error.validationFeedback = JSON.stringify({
                complete: generated.coverage.complete,
                missing: generated.coverage.missing,
                errors: generated.evidence.errors,
                controllerEvidenceComplete: execution.context.gathered()
            });
            throw error;
        }
        check(
            validateReport(generated, input).document.baseSha ===
                (execution.sourceBase || input.base),
            "INVALID_RESULT"
        );
        if (execution.repoRoot) {
            const parsed = validateReport(generated, input);
            try {
                validateInlineTargets(
                    parsed,
                    parsed.findings,
                    execution.repoRoot
                );
            } catch (cause) {
                const error = new ReviewError("INVALID_RESULT");
                error.validationFeedback = cause.message;
                throw error;
            }
        }
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
    async correct(input, execution, prompt, ids = []) {
        const previous =
            (await this.publications.load(input)).states.at(-1)?.findings || [];
        // Source IDs required by the authenticated publisher's current observation.
        const required = new Set(ids);
        const restored = previous.filter((finding) =>
            required.has(`finding:${finding.id}`)
        );
        // Initially excluded thread IDs restored during this execution's correction.
        execution.reopenedThreads ||= new Set();
        for (const thread of input.resolvedThreads || []) {
            if (
                !thread.comments.some((id) => required.has(`inline:${id}`)) &&
                !restored.some((finding) => finding.threadId === thread.id)
            )
                continue;
            // The authenticated publisher now requires this formerly excluded thread.
            execution.reopenedThreads.add(thread.id);
            for (const id of thread.comments)
                execution.context.resolvedComments.delete(id);
        }
        if (restored.length)
            prompt +=
                "\nPreviously excluded finding context: " +
                JSON.stringify(restored);
        const generated = await execution.adapter.turn(
            prompt +
                "\nThis is a focused correction of the saved review in this conversation, not a new review. Preserve existing findings and analysis. Read only the missing or changed discussion needed for these IDs, update their dispositions, and return the corrected report. The existing review policy still applies." +
                this.remainingPrompt(execution),
            execution.budget
        );
        return this.completeWithRepair(
            input,
            execution,
            generated,
            execution.outputRoot,
            execution.revision + 1
        );
    }
    currentPolicyPrompt(task) {
        // Resume may retain the original developer instructions. Deliver current
        // controller policy explicitly on every turn, without discarding history.
        check(
            typeof this.instructions === "string" &&
                this.instructions.length > 0,
            "INVALID_REQUEST"
        );
        return (
            "Current controller review policy (supersedes earlier review-policy versions in this conversation):\n\n" +
            this.instructions +
            "\n\nCurrent task:\n" +
            task
        );
    }
    remainingPrompt(execution) {
        return (
            "\nController timing: " +
            JSON.stringify({
                modelBudgetRemainingMs: Math.floor(
                    execution.budget.remaining()
                ),
                modelDeadlineUtc: new Date(
                    Date.now() + execution.budget.remaining()
                ).toISOString()
            })
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

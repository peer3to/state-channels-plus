const protocol = require("./protocol");
const { check, digest } = require("./data");
const { MESSAGES, ReviewError } = require("./errors");
const {
    accountingSet,
    missingAccounting,
    canonicalFindings,
    findingActions,
    findingEvidence
} = require("./reconcile");
const {
    validateReport,
    validateInlineTargets,
    renderFinding,
    renderGeneralSections,
    safeText
} = require("./review-format");
const { canApprove } = require("./approval");
const { findingSource, wrapFinding } = require("./finding-source");
const {
    stripState,
    readStates,
    allocate,
    actionMarker,
    findAction
} = require("./state");
function reviewReceipt(request, state, complete, code) {
    return {
        version: 1,
        binding: protocol.binding(request),
        kind: "review",
        complete,
        round: state.round,
        actions: state.actions,
        mappings: state.mappings || {},
        state: complete ? "complete" : "partial",
        dispositions: state.findings.map((finding) => ({
            findingId: finding.id,
            status: finding.status,
            threadId: finding.threadId
        })),
        ...(code ? { code } : {})
    };
}
class Publisher {
    request;
    github;
    policy;
    pendingState = null;
    store;
    journal = null;
    constructor(request, github, policy, store) {
        protocol.request(request);
        this.request = request;
        this.github = github;
        this.policy = policy;
        this.store = store;
    }
    async observe(withState = true) {
        const observations = await this.github.observe();
        check(observations.pull.head.sha === this.request.head, "STALE_HEAD");
        check(
            observations.pull.state === "open" &&
                !observations.pull.draft &&
                this.policy.eligible === true,
            "UNAUTHORIZED"
        );
        if (!withState) return observations;
        if (!this.journal) {
            check(this.store, "SERVICE_UNAVAILABLE");
            this.journal = await this.store.load(this.request);
            // Import historical public state once; all subsequent writes are private.
            if (!this.journal.states.length) {
                const legacy = readStates(
                    observations,
                    this.request,
                    this.github.botId
                );
                if (legacy.length)
                    this.journal = await this.store.save(
                        this.request,
                        digest(this.journal),
                        legacy
                    );
            }
        }
        observations.publicationStates = this.journal.states;
        const latest = readStates(observations, this.request, this.github.botId)
            .filter((state) => state.status !== "intent")
            .at(-1);
        observations.findings = latest?.findings || [];
        return observations;
    }
    async notice(outcome) {
        protocol.failureResult(outcome, this.request);
        check(
            !["STALE_HEAD", "UNAUTHORIZED", "INVALID_REQUEST"].includes(
                outcome.code
            ),
            "UNAUTHORIZED"
        );
        const observations = await this.observe(false);
        const marker = actionMarker(
            this.request,
            "unavailable",
            this.request.attempt
        );
        let comment = findAction(observations, marker, this.github.botId);
        if (!comment) {
            const run = `https://github.com/${this.request.repository.name}/actions/runs/${this.request.run.id}/attempts/${this.request.run.attempt}`;
            comment = await this.github.comment(
                `Automated review did not run for ${this.request.head}: ${outcome.message}\n\n[Failed CI run](${run}). After the operator repairs the cause, manually rerun this workflow if this head is still current.\n\n${marker}`
            );
        }
        return {
            version: 1,
            binding: protocol.binding(this.request),
            kind: "notice-only",
            complete: false,
            code: outcome.code,
            actions: [{ kind: "notice", id: comment.id, url: comment.html_url }]
        };
    }
    async inspect(result) {
        protocol.result(result, this.request);
        protocol.requireCompleteReview(result);
        const parsed = validateReport(result, this.request);
        if (parsed.findings.some((finding) => finding.kind === "inline")) {
            check(this.policy.repoRoot, "INVALID_RESULT");
            validateInlineTargets(
                {
                    ...parsed,
                    document: {
                        ...parsed.document,
                        baseSha: this.request.mergeBase
                    }
                },
                parsed.findings,
                this.policy.repoRoot
            );
        }
        const observations = await this.observe();
        const sameHead = readStates(
            observations,
            this.request,
            this.github.botId
        )
            .filter((state) => state.head === this.request.head)
            .at(-1);
        if (sameHead?.status === "complete")
            return {
                status: "complete",
                receipt: reviewReceipt(this.request, sameHead, true)
            };
        if (sameHead?.resultDigest === digest(result))
            observations.findings = observations.findings.filter((finding) =>
                sameHead.previousFindingIds.includes(finding.id)
            );
        const required = accountingSet(observations, this.github.botId);
        const missing = missingAccounting(required, result);
        if (missing.length) {
            if (result.revision !== 0)
                throw new ReviewError("ACCOUNTING_INCOMPLETE");
            return {
                status: "correction-required",
                correction: {
                    version: 1,
                    kind: "missing-accounting",
                    binding: protocol.binding(this.request),
                    executionId: result.executionId,
                    resultRevision: result.revision,
                    effectiveIdentity: result.effectiveIdentity,
                    ids: missing
                }
            };
        }
        return { status: "ready", observations, required };
    }
    async publish(result) {
        this.pendingState = null;
        try {
            return await this.apply(result);
        } catch (error) {
            if (this.pendingState?.actions.length) {
                this.pendingState.status = "partial";
                // Keep the original failure if the worker is also unavailable.
                await this.saveState(this.pendingState).catch(() => {});
                error.publication = {
                    status: "partial",
                    receipt: reviewReceipt(
                        this.request,
                        this.pendingState,
                        false,
                        require("./errors").sanitized(error).code
                    )
                };
            }
            throw error;
        }
    }
    async saveState(state) {
        state.sequence = (state.sequence || 0) + 1;
        const states = this.journal.states.filter(
            (entry) => entry.head !== state.head
        );
        states.push(structuredClone(state));
        this.journal = await this.store.save(
            this.request,
            digest(this.journal),
            states
        );
    }
    async apply(result) {
        const inspected = await this.inspect(result);
        if (inspected.status !== "ready") return inspected;
        // Recheck membership/revisions before the first mutation; no atomic snapshot is claimed.
        const current = await this.observe();
        current.findings = inspected.observations.findings;
        const required = accountingSet(current, this.github.botId);
        if (digest(required) !== digest(inspected.required)) {
            const missing = missingAccounting(required, result);
            if (missing.length && result.revision === 0)
                return {
                    status: "correction-required",
                    correction: {
                        version: 1,
                        kind: "missing-accounting",
                        binding: protocol.binding(this.request),
                        executionId: result.executionId,
                        resultRevision: 0,
                        effectiveIdentity: result.effectiveIdentity,
                        ids: missing
                    }
                };
            if (missing.length) throw new ReviewError("ACCOUNTING_INCOMPLETE");
        }
        const state = allocate(this.request, current, this.github.botId);
        if (state.status === "complete")
            return {
                status: "complete",
                receipt: reviewReceipt(this.request, state, true)
            };
        state.resultDigest = digest(result);
        state.previousFindingIds = current.findings.map(
            (finding) => finding.id
        );
        const canonical = canonicalFindings(current.findings, result.findings);
        const used = new Set(current.findings.map((finding) => finding.id));
        state.mappings = state.mappings || {};
        state.findings = canonical.map((finding) => {
            if (used.has(finding.id)) return finding;
            if (!Object.hasOwn(state.mappings, finding.id))
                state.mappings[finding.id] = `R${state.round}${finding.id}`;
            return { ...finding, id: state.mappings[finding.id] };
        });
        // Omission alone does not establish that any finding has been addressed.
        for (const old of current.findings.filter(
            (finding) =>
                !state.findings.some((entry) => entry.id === finding.id)
        )) {
            state.findings.push(old);
        }
        const operations = findingActions(
            current.findings,
            state.findings,
            current
        );
        this.pendingState = state;
        await this.saveState(state);
        const batchMarker = actionMarker(this.request, "findings", state.round);
        const beforeBatch = await this.observe();
        beforeBatch.findings = current.findings;
        if (
            missingAccounting(
                accountingSet(beforeBatch, this.github.botId),
                result
            ).length
        )
            throw new ReviewError("ACCOUNTING_INCOMPLETE");
        let batch = findAction(beforeBatch, batchMarker, this.github.botId);
        if (!batch) {
            const rendered = operations
                .filter((operation) => operation.kind === "new")
                .map((operation) => operation.finding)
                .filter(
                    (finding) =>
                        !["fixed", "disagreement"].includes(finding.status)
                )
                .map((finding) => ({
                    ...finding,
                    body:
                        renderFinding(finding, current.pull.user.login) +
                        "\n\n" +
                        actionMarker(this.request, "finding", finding.id)
                }));
            // Each general finding owns one comment. The same locator also reads
            // older grouped review bodies when reconciling their stable IDs.
            for (const finding of rendered.filter(
                (item) => item.path === null
            )) {
                const marker = actionMarker(
                    this.request,
                    "finding",
                    finding.id
                );
                let action = findAction(beforeBatch, marker, this.github.botId);
                if (!action) {
                    const body = renderGeneralSections(
                        [finding],
                        validateReport(result, this.request),
                        state.mappings
                    );
                    action = await this.github.comment(
                        wrapFinding(finding.id, body)
                    );
                }
                if (!state.actions.some((entry) => entry.id === action.id)) {
                    state.actions.push({
                        kind: "review-comment",
                        id: action.id,
                        url: action.html_url
                    });
                }
            }
            // Accounting responses remain in the report; public findings own IDs.
            // An inline review needs a body, but no standalone status prose.
            if (rendered.some((finding) => finding.path !== null)) {
                batch = await this.github.batch(
                    rendered.map((finding) => ({
                        ...finding,
                        body: wrapFinding(finding.id, finding.body)
                    })),
                    batchMarker
                );
            }
        }
        if (batch && !state.actions.some((action) => action.id === batch.id))
            state.actions.push({
                kind: "review-comment",
                id: batch.id,
                url: batch.html_url
            });
        this.pendingState = state;
        let deferred = false;
        for (const operation of operations.filter(
            (entry) => entry.kind !== "new"
        )) {
            const observed = await this.observe();
            observed.findings = current.findings;
            if (
                missingAccounting(
                    accountingSet(observed, this.github.botId),
                    result
                ).length
            ) {
                deferred = true;
                break;
            }
            const marker = actionMarker(this.request, operation.kind, {
                id: operation.finding.id,
                evidence: findingEvidence(operation.finding)
            });
            if (operation.kind === "general-update") {
                const source = findingSource(
                    this.request,
                    observed,
                    this.github.botId,
                    operation.finding
                );
                check(
                    source && source.kind !== "inline",
                    "CONTEXT_UNAVAILABLE"
                );
                const closed = ["fixed", "disagreement"].includes(
                    operation.finding.status
                );
                const old = current.findings.find(
                    (item) => item.id === operation.finding.id
                );
                const escape = (text) =>
                    text
                        .replaceAll("&", "&amp;")
                        .replaceAll("<", "&lt;")
                        .replaceAll(">", "&gt;");
                const content = closed
                    ? `<details>\n<summary>✅ RESOLVED — [${operation.finding.id}]</summary>\n\n<del>${escape(old.body).replaceAll("\n", "<br>\n")}</del>\n\n**Resolution:** ${safeText(operation.finding.body)}\n\n</details>`
                    : renderFinding(operation.finding, current.pull.user.login);
                const replacement = wrapFinding(
                    operation.finding.id,
                    `${content}\n\n${source.marker}\n${marker}`
                );
                const body =
                    source.item.body.slice(0, source.start) +
                    replacement +
                    source.item.body.slice(source.end);
                const action =
                    findAction(observed, marker, this.github.botId) ||
                    (await this.github.editGeneral(source, stripState(body)));
                state.actions.push({
                    kind: "review-comment",
                    id: action.id,
                    url: action.html_url
                });
            } else if (operation.kind === "evidence") {
                let action = findAction(observed, marker, this.github.botId);
                if (!action) {
                    const body =
                        renderFinding(
                            operation.finding,
                            current.pull.user.login
                        ) +
                        "\n\n" +
                        marker;
                    action = operation.thread
                        ? await this.github.reply(
                              operation.thread,
                              wrapFinding(operation.finding.id, body),
                              observed
                          )
                        : await this.github.comment(
                              wrapFinding(operation.finding.id, body)
                          );
                }
                state.actions.push({
                    kind: "review-comment",
                    id: action.id,
                    url: action.html_url
                });
            } else {
                await this.github.setResolved(
                    operation.thread,
                    operation.kind === "resolve",
                    observed
                );
                const root = observed.inline.find(
                    (entry) =>
                        operation.thread.comments.nodes[0]?.databaseId ===
                        entry.id
                );
                check(root, "CONTEXT_UNAVAILABLE");
                state.actions.push({
                    kind: operation.kind,
                    id: root.id,
                    url: root.html_url
                });
            }
        }
        state.status = "partial";
        await this.saveState(state);
        const beforeApproval = await this.observe();
        for (const finding of state.findings.filter(
            (entry) => entry.path !== null && !entry.threadId
        )) {
            const marker = actionMarker(this.request, "finding", finding.id);
            const comment = beforeApproval.inline.find(
                (entry) =>
                    entry.user?.id === this.github.botId &&
                    entry.user.type === "Bot" &&
                    entry.body?.includes(marker)
            );
            const thread =
                comment &&
                beforeApproval.threads.find((entry) =>
                    entry.comments.nodes.some(
                        (node) => node.databaseId === comment.id
                    )
                );
            if (thread) finding.threadId = thread.id;
        }
        beforeApproval.findings = current.findings;
        const missing = missingAccounting(
            accountingSet(beforeApproval, this.github.botId),
            result
        );
        if (deferred || missing.length) {
            await this.saveState(state);
            return {
                status: "partial",
                receipt: reviewReceipt(
                    this.request,
                    state,
                    false,
                    "ACCOUNTING_INCOMPLETE"
                )
            };
        }
        for (const stale of beforeApproval.reviews.filter(
            (entry) =>
                entry.user?.id === this.github.botId &&
                entry.user.type === "Bot" &&
                entry.state === "APPROVED" &&
                entry.commit_id !== this.request.head
        )) {
            try {
                await this.github.dismissOwnStale(stale);
                state.actions.push({
                    kind: "dismiss",
                    id: stale.id,
                    url: stale.html_url
                });
            } catch {
                const marker = actionMarker(
                    this.request,
                    "dismiss-unavailable",
                    stale.id
                );
                if (!findAction(beforeApproval, marker, this.github.botId)) {
                    const action = await this.github.comment(
                        "The bot could not dismiss its approval for an older head. Human review still required.\n\n" +
                            marker
                    );
                    state.actions.push({
                        kind: "notice",
                        id: action.id,
                        url: action.html_url
                    });
                }
                return {
                    status: "partial",
                    receipt: reviewReceipt(
                        this.request,
                        state,
                        false,
                        "CONTEXT_UNAVAILABLE"
                    )
                };
            }
        }
        if (
            canApprove({
                result: { ...result, findings: state.findings },
                pull: beforeApproval.pull,
                head: this.request.head,
                botId: this.github.botId,
                uncertain: false,
                specApproved: this.policy.specApproved
            })
        ) {
            const approveMarker = actionMarker(
                this.request,
                "approve",
                state.round
            );
            const approval =
                findAction(beforeApproval, approveMarker, this.github.botId) ||
                (await this.github.approve(approveMarker));
            state.actions.push({
                kind: "approve",
                id: approval.id,
                url: approval.html_url
            });
        }
        state.status = "complete";
        await this.saveState(state);
        return {
            status: "complete",
            receipt: reviewReceipt(this.request, state, true)
        };
    }
}
module.exports = { Publisher };
async function main() {
    const fs = require("node:fs/promises");
    const path = require("node:path");
    const { GitHubWriter, actionsBotId } = require("./github-write");
    const { writeJson } = require("./data");
    const [mode, requestFile, resultFile, outputFile] = process.argv.slice(2);
    check(
        ["inspect", "publish", "notice"].includes(mode) &&
            requestFile &&
            resultFile &&
            outputFile
    );
    const request = protocol.request(
        JSON.parse(await fs.readFile(requestFile, "utf8"))
    );
    check(
        request.mode === "ci" &&
            request.run.id === Number(process.env.GITHUB_RUN_ID) &&
            request.run.attempt === Number(process.env.GITHUB_RUN_ATTEMPT),
        "UNAUTHORIZED"
    );
    check(
        request.repository.name === process.env.GITHUB_REPOSITORY &&
            request.caller === process.env.SCP_REVIEW_CLIENT_KEY,
        "UNAUTHORIZED"
    );
    const input = JSON.parse(await fs.readFile(resultFile, "utf8"));
    const github = new GitHubWriter(request, {
        token: process.env.GITHUB_TOKEN,
        botId: await actionsBotId(process.env.GITHUB_TOKEN)
    });
    const {
        generateAuditSummary
    } = require("../../docs/spec/tools/generate-audit-summary");
    const specApproved = generateAuditSummary().issueCount === 0;
    const { withPublicationStore } = require("./publication-store");
    const owner = new Publisher(request, github, {
        eligible: process.env.REVIEW_ELIGIBLE === "true",
        specApproved,
        repoRoot: process.cwd()
    });
    const root = path.dirname(path.resolve(outputFile));
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    let output;
    try {
        if (mode === "notice" || input.code) {
            output = {
                status: "notice-only",
                receipt: await owner.notice(input)
            };
            if (mode !== "notice") process.exitCode = 1;
        } else
            output = await withPublicationStore(
                request,
                input.executionId,
                async (store) => {
                    owner.store = store;
                    return owner[mode](input);
                }
            );
    } catch (error) {
        if (error.publication) {
            output = error.publication;
            process.exitCode = 1;
        } else if (
            ["ACCOUNTING_INCOMPLETE", "REVIEW_INCOMPLETE"].includes(
                error.code
            ) &&
            mode === "inspect"
        )
            output = { status: "accounting-failed" };
        else if (
            ["ACCOUNTING_INCOMPLETE", "REVIEW_INCOMPLETE"].includes(
                error.code
            ) &&
            mode === "publish"
        ) {
            output = {
                status: "failed",
                receipt: await owner.notice(protocol.failure(error, request))
            };
            process.exitCode = 1;
        } else throw error;
    }
    if (
        mode !== "inspect" &&
        ["partial", "failed", "accounting-failed"].includes(output.status)
    )
        process.exitCode = 1;
    if (output.status === "ready") output = { status: "ready" };
    await writeJson(root, path.basename(outputFile), output);
    if (process.env.GITHUB_OUTPUT)
        await fs.appendFile(
            process.env.GITHUB_OUTPUT,
            `status=${output.status}\nreceipt=${Boolean(output.receipt)}\n`
        );
}
if (require.main === module)
    main().catch((error) => {
        console.error(require("./errors").sanitized(error).message);
        process.exitCode = 1;
    });

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
const { enforceHumanState, humanBlockReasons } = require("./policy");
const { canApprove } = require("./approval");
const { findingSource, wrapFinding } = require("./finding-source");
const {
    encodeState,
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
    constructor(request, github, policy) {
        protocol.request(request);
        this.request = request;
        this.github = github;
        this.policy = policy;
    }
    async observe() {
        const observations = await this.github.observe();
        check(observations.pull.head.sha === this.request.head, "STALE_HEAD");
        check(
            observations.pull.state === "open" &&
                !observations.pull.draft &&
                this.policy.eligible === true,
            "UNAUTHORIZED"
        );
        const latest = readStates(
            observations.comments,
            this.request,
            this.github.botId
        )
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
        const observations = await this.observe();
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
            observations.comments,
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
            if (this.pendingState?.actions.length)
                error.publication = {
                    status: "partial",
                    receipt: reviewReceipt(
                        this.request,
                        this.pendingState,
                        false,
                        require("./errors").sanitized(error).code
                    )
                };
            throw error;
        }
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
        const blocked = enforceHumanState(current.findings, result, current);
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
        // Required Human state survives omission or a proposed replacement.
        for (const old of current.findings.filter(
            (finding) =>
                !state.findings.some((entry) => entry.id === finding.id) ||
                (finding.human?.required && blocked.includes(finding.id))
        )) {
            const index = state.findings.findIndex(
                (finding) => finding.id === old.id
            );
            if (index === -1) state.findings.push(old);
            else
                state.findings[index] = {
                    ...state.findings[index],
                    human: old.human,
                    status: "continued"
                };
        }
        const operations = findingActions(
            current.findings,
            state.findings,
            current,
            blocked
        );
        const intentMarker = actionMarker(this.request, "intent", state.round);
        const intent =
            findAction(current, intentMarker, this.github.botId) ||
            (await this.github.comment(
                `Automated review intent for ${this.request.head}.\n\n${encodeState(state)}\n${intentMarker}`
            ));
        if (!state.actions.some((action) => action.id === intent.id))
            state.actions.push({
                kind: "review-comment",
                id: intent.id,
                url: intent.html_url
            });
        this.pendingState = state;
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
                if (!findAction(beforeBatch, marker, this.github.botId)) {
                    const body = renderGeneralSections(
                        [finding],
                        validateReport(result, this.request),
                        state.mappings
                    );
                    const action = await this.github.comment(
                        wrapFinding(finding.id, body)
                    );
                    state.actions.push({
                        kind: "review-comment",
                        id: action.id,
                        url: action.html_url
                    });
                }
            }
            // safeText strips HTML comment syntax: these responses are
            // model-authored and land in a bot comment that also carries the
            // round state and action markers read back by state.js.
            const responses = result.accounting
                .filter((entry) => entry.disposition === "response")
                .map(
                    (entry) => `${entry.sourceId}: ${safeText(entry.response)}`
                );
            const body = [
                ...responses,
                "Human review still required.",
                batchMarker
            ].join("\n\n");
            batch = await this.github.batch(rendered, body);
        }
        if (!state.actions.some((action) => action.id === batch.id))
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
                if (
                    enforceHumanState(
                        current.findings,
                        result,
                        observed
                    ).includes(operation.finding.id)
                ) {
                    deferred = true;
                    continue;
                }
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
                    (await this.github.editGeneral(source, body));
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
                              body,
                              observed
                          )
                        : await this.github.comment(body);
                }
                state.actions.push({
                    kind: "review-comment",
                    id: action.id,
                    url: action.html_url
                });
            } else {
                if (
                    operation.kind === "resolve" &&
                    enforceHumanState(
                        current.findings,
                        result,
                        observed
                    ).includes(operation.finding.id)
                ) {
                    deferred = true;
                    continue;
                }
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
        if (blocked.length) {
            const marker = actionMarker(this.request, "human-blocked", {
                round: state.round,
                findings: state.findings
                    .filter((entry) => blocked.includes(entry.id))
                    .map((entry) => ({
                        id: entry.id,
                        revision: entry.human.revision
                    }))
            });
            const observed = await this.observe();
            observed.findings = current.findings;
            if (
                !missingAccounting(
                    accountingSet(observed, this.github.botId),
                    result
                ).length &&
                !findAction(observed, marker, this.github.botId)
            ) {
                const summary =
                    "Human questions still need attention.\n\n" +
                    humanBlockReasons(current.findings, result, current)
                        .map(
                            (entry) =>
                                `${entry.id}, decision revision ${entry.revision}: ${entry.reasons.join(", ")}.`
                        )
                        .join("\n");
                const action = await this.github.comment(
                    summary + "\n\n" + marker
                );
                state.actions.push({
                    kind: "review-comment",
                    id: action.id,
                    url: action.html_url
                });
            }
        }
        state.status = "partial";
        await this.github.comment(
            `Automated review publication record.\n\n${encodeState(state)}`
        );
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
        if (deferred || missing.length)
            return {
                status: "partial",
                receipt: reviewReceipt(
                    this.request,
                    state,
                    false,
                    "ACCOUNTING_INCOMPLETE"
                )
            };
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
                blocked: enforceHumanState(
                    current.findings,
                    result,
                    beforeApproval
                ),
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
                (await this.github.approve(
                    `Human review still required.\n\n${approveMarker}`
                ));
            state.actions.push({
                kind: "approve",
                id: approval.id,
                url: approval.html_url
            });
        }
        state.status = "complete";
        await this.github.comment(
            `Automated review publication complete.\n\n${encodeState(state)}`
        );
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
        } else output = await owner[mode](input);
    } catch (error) {
        if (error.publication) {
            output = error.publication;
            process.exitCode = 1;
        } else if (error.code === "ACCOUNTING_INCOMPLETE" && mode === "inspect")
            output = { status: "accounting-failed" };
        else if (error.code === "ACCOUNTING_INCOMPLETE" && mode === "publish") {
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

const { digest, check } = require("./data");
function sourceRevision(item) {
    return digest({
        id: item.id,
        body: item.body || "",
        author: item.user?.id,
        updated: item.updated_at || item.submitted_at
    });
}
function accountingSet(observations, botId) {
    const required = [];
    for (const finding of observations.findings) {
        if (
            !["fixed", "disagreement"].includes(finding.status) ||
            finding.human?.required
        )
            required.push({
                id: `finding:${finding.id}`,
                revision: digest(finding),
                threadId: finding.threadId
            });
    }
    for (const [kind, items] of [
        ["comment", observations.comments],
        ["inline", observations.inline],
        ["review", observations.reviews]
    ]) {
        for (const item of items) {
            if (item.user.id === botId || !item.body?.trim()) continue;
            required.push({
                id: `${kind}:${item.id}`,
                revision: sourceRevision(item),
                threadId: item.node_id || null
            });
        }
    }
    return required.sort((a, b) => a.id.localeCompare(b.id));
}
function missingAccounting(required, result) {
    return required
        .filter(
            (item) =>
                !result.accounting.some(
                    (entry) =>
                        entry.sourceId === item.id &&
                        entry.sourceRevision === item.revision
                )
        )
        .map((item) => item.id);
}
function canonicalFindings(previous, proposed) {
    return proposed.map((finding) => {
        const byThread =
            finding.threadId &&
            previous.find((item) => item.threadId === finding.threadId);
        const byId = previous.find((item) => item.id === finding.id);
        check(!finding.threadId || byThread, "INVALID_RESULT");
        check(!byThread || !byId || byThread.id === byId.id, "INVALID_RESULT");
        const existing = byThread || byId;
        check(existing || finding.status === "new", "INVALID_RESULT");
        return existing
            ? { ...finding, id: existing.id, threadId: existing.threadId }
            : finding;
    });
}
function findingEvidence(finding) {
    return digest({
        body: finding.body,
        evidence: finding.evidence,
        human: finding.human
    });
}
function findingActions(previous, proposed, observations, blocked) {
    const actions = [];
    for (const finding of proposed) {
        const old = previous.find((entry) => entry.id === finding.id);
        if (!old) {
            actions.push({ kind: "new", finding });
            continue;
        }
        const closed = ["fixed", "disagreement"].includes(finding.status);
        // A disposition needs inspected evidence; SHA changes and manual resolution
        // do not establish that a finding is fixed.
        check(!closed || finding.evidence.length > 0, "INVALID_RESULT");
        const thread =
            old.threadId &&
            observations.threads.find((entry) => entry.id === old.threadId);
        if (old.threadId) check(thread, "CONTEXT_UNAVAILABLE");
        if (findingEvidence(finding) !== findingEvidence(old))
            if (thread) actions.push({ kind: "evidence", finding, thread });
        if (
            !old.threadId &&
            !blocked.includes(finding.id) &&
            (findingEvidence(finding) !== findingEvidence(old) ||
                finding.status !== old.status)
        )
            actions.push({ kind: "general-update", finding });
        if (thread && !blocked.includes(finding.id)) {
            if (closed && !thread.isResolved)
                actions.push({ kind: "resolve", finding, thread });
            if (!closed && thread.isResolved)
                actions.push({ kind: "reopen", finding, thread });
        }
    }
    return actions;
}
module.exports = {
    accountingSet,
    missingAccounting,
    canonicalFindings,
    sourceRevision,
    findingEvidence,
    findingActions
};

const {
    sourceRevision,
    accountingSet,
    missingAccounting
} = require("./reconcile");

const closed = (finding) => ["fixed", "disagreement"].includes(finding.status);
function settledDecision(entry, findings) {
    if (!entry || !entry.response?.trim()) return false;
    if (entry.findingId) {
        const finding = findings.find((item) => item.id === entry.findingId);
        if (!finding || !closed(finding)) return false;
    }
    return (
        ["fixed", "disagreement", "no-action"].includes(entry.disposition) ||
        (entry.disposition === "response" && !!entry.findingId)
    );
}
function threadSettled(thread, observations, result, botId) {
    const comments = thread.comments.nodes.map((node) =>
        observations.inline.find((comment) => comment.id === node.databaseId)
    );
    if (!comments.length || comments.some((comment) => !comment)) return false;
    // Bot-owned findings use the finding lifecycle, never discussion-only closure.
    if (comments[0].user?.id === botId) return false;
    const external = comments.filter(
        (comment) => comment.user?.id !== botId && comment.body?.trim()
    );
    return (
        external.length > 0 &&
        external.every((comment) => {
            const entry = result.accounting.find(
                (item) =>
                    item.sourceId === `inline:${comment.id}` &&
                    item.sourceRevision === sourceRevision(comment)
            );
            return settledDecision(entry, result.findings);
        })
    );
}
function resolutionEvidence(result, observations, botId) {
    return {
        executionId: result.executionId,
        complete:
            result.coverage.complete &&
            !result.coverage.missing.length &&
            !result.evidence.errors.length,
        accounting: result.accounting,
        // Resolved threads are intentionally excluded from required accounting.
        accounted: !missingAccounting(
            accountingSet(observations, botId),
            result
        ).length,
        threadsResolved: observations.threads.every(
            (thread) => thread.isResolved
        )
    };
}
module.exports = { closed, settledDecision, threadSettled, resolutionEvidence };

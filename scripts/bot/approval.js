const { digest } = require("./data");
const { closed, settledDecision } = require("./review-decisions");
const { accountingSet, missingAccounting } = require("./reconcile");
function reviewStatus(request, executionId, state, receipt) {
    const evidence = state?.approvalEvidence;
    const everythingResolved = !!(
        state?.head === request.head &&
        state.status === "complete" &&
        receipt?.complete &&
        receipt.kind === "review" &&
        receipt.round === state.round &&
        evidence?.executionId === executionId &&
        evidence.complete &&
        evidence.accounted &&
        evidence.threadsResolved &&
        state.findings.every(closed) &&
        evidence.accounting
            .filter((entry) => /^(comment|review):/.test(entry.sourceId))
            .every((entry) => settledDecision(entry, state.findings))
    );
    return {
        repository: request.repository,
        pr: request.pr,
        head: request.head,
        run: request.run,
        executionId,
        round: state?.round,
        everythingResolved,
        findings: state?.findings || [],
        accounting: evidence?.accounting || [],
        snapshot: digest({ state: state || null, receipt: receipt || null })
    };
}
function canApprove({ status, observations, head, botId, ciPassed }) {
    const pull = observations.pull;
    return !!(
        ciPassed &&
        status?.everythingResolved &&
        status.head === head &&
        pull.state === "open" &&
        !pull.draft &&
        pull.head.sha === head &&
        pull.user.id !== botId &&
        status.findings.every(closed) &&
        observations.threads.every((thread) => thread.isResolved) &&
        !missingAccounting(
            accountingSet(
                { ...observations, findings: status.findings },
                botId
            ),
            status
        ).length
    );
}
module.exports = { reviewStatus, canApprove };

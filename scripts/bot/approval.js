function canApprove({
    result,
    pull,
    head,
    botId,
    blocked,
    uncertain,
    specApproved
}) {
    return (
        result.recommendation === "approve" &&
        result.coverage.complete &&
        !result.coverage.missing.length &&
        result.evidence.errors.length === 0 &&
        result.findings.every((finding) =>
            ["fixed", "disagreement"].includes(finding.status)
        ) &&
        pull.state === "open" &&
        !pull.draft &&
        pull.head.sha === head &&
        pull.user.id !== botId &&
        blocked.length === 0 &&
        !uncertain &&
        specApproved === true
    );
}
module.exports = { canApprove };

function canApprove({ result, pull, head, botId, uncertain, specApproved }) {
    return (
        result.recommendation === "approve" &&
        result.coverage.complete &&
        !result.coverage.missing.length &&
        !result.coverage.verificationMissing?.length &&
        result.evidence.errors.length === 0 &&
        result.findings.every((finding) =>
            ["fixed", "disagreement"].includes(finding.status)
        ) &&
        pull.state === "open" &&
        !pull.draft &&
        pull.head.sha === head &&
        pull.user.id !== botId &&
        !uncertain &&
        specApproved === true
    );
}
module.exports = { canApprove };

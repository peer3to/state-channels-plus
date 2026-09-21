function humanBlockReasons(previous, result) {
    const unresolved = [];
    for (const finding of previous.filter((entry) => entry.human?.required)) {
        const assessment = result.accounting.find(
            (entry) => entry.sourceId === `finding:${finding.id}`
        );
        // The reviewer assesses discussion; the publisher does not authenticate human decisions.
        if (
            assessment?.humanAssessment !== "accepted" ||
            !assessment?.response?.trim()
        )
            unresolved.push({
                id: finding.id,
                revision: finding.human.revision,
                reasons: ["awaiting-accepted-agent-assessment"]
            });
    }
    return unresolved;
}
function enforceHumanState(previous, result) {
    return humanBlockReasons(previous, result).map((entry) => entry.id);
}
module.exports = { enforceHumanState, humanBlockReasons };

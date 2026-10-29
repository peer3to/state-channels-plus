function shouldTransferAttemptEvidence(result) {
    return (
        result.code !== 0 ||
        Boolean(result.infrastructureFailure) ||
        (result.reduced?.starveCount || 0) > 0
    );
}

module.exports = { shouldTransferAttemptEvidence };

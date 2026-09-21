// Standalone CI cleanup owner: usable by a pinned github-script step without checkout.
async function cleanupArtifacts({
    github,
    repository,
    runId,
    attempt,
    artifacts,
    consumers
}) {
    if (
        !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
        !Number.isSafeInteger(runId) ||
        !Number.isSafeInteger(attempt)
    )
        throw new Error("Invalid artifact ownership.");
    if (
        !Array.isArray(artifacts) ||
        !Array.isArray(consumers) ||
        !consumers.length ||
        consumers.some(
            (state) =>
                !["success", "failure", "cancelled", "skipped"].includes(state)
        )
    )
        throw new Error("Artifact consumers have not stopped.");
    const [owner, repo] = repository.split("/");
    const deleted = [];
    for (const record of artifacts) {
        if (
            !Number.isSafeInteger(record.id) ||
            record.id <= 0 ||
            !["result", "receipt", "feature"].includes(record.kind) ||
            record.name !== `review-${runId}-${attempt}-${record.kind}`
        )
            throw new Error("Invalid artifact ownership.");
        let artifact;
        try {
            artifact = (
                await github.rest.actions.getArtifact({
                    owner,
                    repo,
                    artifact_id: record.id
                })
            ).data;
        } catch (error) {
            if (error.status === 404) {
                deleted.push({ id: record.id, absent: true });
                continue;
            }
            throw error;
        }
        if (
            artifact.id !== record.id ||
            artifact.workflow_run?.id !== runId ||
            artifact.name !== record.name
        )
            throw new Error("Artifact belongs to another run or attempt.");
        await github.rest.actions.deleteArtifact({
            owner,
            repo,
            artifact_id: record.id
        });
        deleted.push({ id: record.id, absent: false });
    }
    return deleted;
}
module.exports = { cleanupArtifacts };

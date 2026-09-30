const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const RUNNER_IMAGE_DOCKERFILE =
    "scripts/e2e-parallel/distributed/runner-image.Dockerfile";

// The image label naming the Dockerfile revision a runner image was built from.
const RUNNER_IMAGE_REVISION_LABEL = "org.peer3.scp.runner-image-revision";

/**
 * The revision of the runner image a checkout expects: the SHA-256 of its
 * Dockerfile. The distributed protocol version covers the runner code, not the
 * image, so a host that updated its checkout without rebuilding would otherwise
 * advertise tiers its image cannot run.
 */
function runnerImageRevision(trustedRoot) {
    return crypto
        .createHash("sha256")
        .update(
            fs.readFileSync(path.join(trustedRoot, RUNNER_IMAGE_DOCKERFILE))
        )
        .digest("hex");
}

/** Why `labels` (an image's Config.Labels) do not match the checkout, or null. */
function staleRunnerImageReason(image, labels, trustedRoot) {
    const expected = runnerImageRevision(trustedRoot);
    const actual = labels?.[RUNNER_IMAGE_REVISION_LABEL];
    if (actual === expected) return null;
    return (
        `Runner image ${image} ${actual ? `was built from runner-image.Dockerfile revision ${actual.slice(0, 12)}` : `has no ${RUNNER_IMAGE_REVISION_LABEL} label`}, ` +
        `but this checkout expects ${expected.slice(0, 12)}. Rebuild it with ` +
        "`yarn test:parallel:image` and point SCP_TEST_RUNNER_IMAGE at the new image ID"
    );
}

module.exports = {
    RUNNER_IMAGE_DOCKERFILE,
    RUNNER_IMAGE_REVISION_LABEL,
    runnerImageRevision,
    staleRunnerImageReason
};

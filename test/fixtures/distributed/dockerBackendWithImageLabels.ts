// @spec-test-coverage-ignore: shared distributed-worker fixture exercised by developer tooling tests
const {
    DockerBackend
} = require("../../../scripts/e2e-parallel/distributed/isolatedEnvironment.js");

/**
 * A Docker backend for an immutable local image whose `docker image inspect`
 * reports `labels` as the image's Config.Labels (null: none). Test hosts have
 * no Docker daemon, so the Docker CLI answers through the backend's `run` seam,
 * as a darwin host without user namespaces answers every other probe.
 */
export function dockerBackendWithImageLabels(
    labels: Record<string, string> | null,
    trustedRoot?: string
) {
    return new DockerBackend({
        image: `sha256:${"f".repeat(64)}`,
        platform: "darwin",
        hostCidrs: [],
        trustedRoot,
        run: async (_command: string, args: string[]) => ({
            stdout: Buffer.from(
                args[0] === "image" && args.includes("{{json .Config.Labels}}")
                    ? JSON.stringify(labels)
                    : "[]"
            ),
            stderr: Buffer.alloc(0)
        })
    });
}

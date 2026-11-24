// @spec-test-coverage-ignore: shared distributed-worker fixture exercised by developer tooling tests
import { repoRoot } from "@test/utils/repoRoot";

const {
    DockerBackend
} = require("../../../scripts/e2e-parallel/distributed/isolatedEnvironment.js");
const {
    RUNNER_IMAGE_REVISION_LABEL,
    runnerImageRevision
} = require("../../../scripts/e2e-parallel/distributed/runnerImage.js");

/** The image ID the stand-in build returns. */
export const BUILT = `sha256:${"e".repeat(64)}`;

/**
 * A Docker backend for an immutable local image whose `docker image inspect`
 * reports `labels` as the image's Config.Labels (null: none), or fails with
 * `inspectError` as docker's stderr. Test hosts have no Docker daemon, so the
 * Docker CLI answers through the backend's `run` seam, as a darwin host without
 * user namespaces answers every other probe.
 */
export function dockerBackendWithImageLabels(
    labels: Record<string, string> | null,
    trustedRoot?: string,
    inspectError?: string
) {
    return dockerBackendForRunnerImage({
        image: `sha256:${"f".repeat(64)}`,
        labels,
        trustedRoot,
        inspectError
    }).backend;
}

/**
 * The same backend as the worker server builds it when `server` is given: a
 * stale or missing image is rebuilt through `buildImage`, which counts its
 * calls, returns `sha256:eee…` (labelled for this checkout) or fails when
 * `buildFails`. `linuxWithoutUserns` makes `docker info` report a linux host
 * without user namespaces, the probe that must fail before any build.
 */
export function dockerBackendForRunnerImage(options: {
    image: string | undefined;
    labels?: Record<string, string> | null;
    inspectError?: string;
    trustedRoot?: string;
    server?: { buildFails?: boolean };
    linuxWithoutUserns?: boolean;
}) {
    const build = { count: 0 };
    const backend = new DockerBackend({
        image: options.image,
        platform: options.linuxWithoutUserns ? "linux" : "darwin",
        hostCidrs: [],
        trustedRoot: options.trustedRoot,
        buildImage:
            options.server &&
            (() => {
                build.count++;
                if (options.server?.buildFails)
                    throw new Error("docker build exited with 3");
                return BUILT;
            }),
        run: async (_command: string, args: string[]) => {
            const inspect =
                args[0] === "image" && args.includes("{{json .Config.Labels}}");
            if (inspect && options.inspectError !== undefined)
                throw Object.assign(new Error("docker failed (1)"), {
                    stderr: Buffer.from(options.inspectError)
                });
            const labels =
                backend.image === BUILT
                    ? {
                          [RUNNER_IMAGE_REVISION_LABEL]:
                              runnerImageRevision(repoRoot())
                      }
                    : (options.labels ?? null);
            return {
                stdout: Buffer.from(inspect ? JSON.stringify(labels) : "[]"),
                stderr: Buffer.alloc(0)
            };
        }
    });
    return { backend, build };
}

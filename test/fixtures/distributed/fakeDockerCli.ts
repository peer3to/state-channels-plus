// @spec-test-coverage-ignore: shared distributed-worker fixture exercised by developer tooling tests
import fs from "fs";

/**
 * A stand-in for the docker CLI behind buildRunnerImage.js's `run` seam: `image inspect` answers
 * `labels` with `inspectStatus`, a build answers `buildStatus` and on success writes `sha256:new`
 * to its --iidfile. `builds` counts the builds.
 */
export function fakeDockerCli(
    labels: Record<string, string> | null,
    inspectStatus = 0,
    buildStatus = 0
) {
    const docker = {
        builds: 0,
        run(args: string[]) {
            if (args[0] === "image")
                return {
                    status: inspectStatus,
                    stdout: JSON.stringify(labels)
                };
            docker.builds++;
            if (buildStatus === 0)
                fs.writeFileSync(
                    args[args.indexOf("--iidfile") + 1],
                    "sha256:new\n"
                );
            return { status: buildStatus, stdout: "" };
        }
    };
    return docker;
}

/** A docker server's configuration with `runnerImage`. */
export function dockerServer(runnerImage: string | undefined) {
    return { executionBackend: "docker", runnerImage };
}

// @spec-test-coverage-ignore: shared distributed-worker fixture exercised by developer tooling tests
const {
    DockerBackend
} = require("../../../scripts/e2e-parallel/distributed/isolatedEnvironment.js");

/**
 * A Docker backend configured with `image`, whose ID `docker image inspect`
 * reports as `imageId`, and whose retained containers report the image IDs in
 * `containerImages`. A container missing from it does not exist. Test hosts
 * have no Docker daemon, so the Docker CLI answers through the backend's `run`
 * seam.
 */
export function dockerBackendWithContainerImages(
    image: string,
    imageId: string,
    containerImages: Record<string, string>
) {
    return new DockerBackend({
        image,
        platform: "darwin",
        hostCidrs: [],
        run: async (_command: string, args: string[]) => {
            const target = args[args.length - 1];
            if (args[0] === "image" && target === image)
                return {
                    stdout: Buffer.from(`${imageId}\n`),
                    stderr: Buffer.alloc(0)
                };
            if (args[0] === "container" && target in containerImages)
                return {
                    stdout: Buffer.from(`${containerImages[target]}\n`),
                    stderr: Buffer.alloc(0)
                };
            throw new Error(`Error: No such object: ${target}`);
        }
    });
}

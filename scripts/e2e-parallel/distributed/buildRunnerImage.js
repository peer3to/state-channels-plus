#!/usr/bin/env node
// Build the distributed runner image labelled with the Dockerfile revision the
// worker server checks at startup, and print the image ID to configure.
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
    RUNNER_IMAGE_DOCKERFILE,
    RUNNER_IMAGE_REVISION_LABEL,
    runnerImageRevision,
    staleRunnerImageReason
} = require("./runnerImage");

// docker build flags that cannot change what goes into the image, with
// whether each takes a value. The label hashes only the Dockerfile, so
// anything else (--build-arg, --label, --file, ...) could build a different
// image under the checkout's revision.
const FORWARDED_FLAGS = new Map([
    ["--tag", true],
    ["-t", true],
    ["--progress", true],
    ["--no-cache", false],
    ["--pull", false],
    ["--quiet", false],
    ["-q", false]
]);

/** An error for a refused argument; `yarn test:parallel:image` exits 2 on it. */
function refusal(message) {
    return Object.assign(new Error(message), { exitCode: 2 });
}

/** The docker build arguments for `extra`, or a thrown refusal. */
function runnerImageBuildArgs(root, idFile, extra) {
    const forwarded = [];
    for (let index = 0; index < extra.length; index++) {
        const arg = extra[index];
        const [flag, inline] = arg.split(/=(.*)/s, 2);
        const takesValue = FORWARDED_FLAGS.get(flag);
        if (takesValue === undefined) {
            throw refusal(
                `Refusing docker build argument ${arg}: the image label covers only ` +
                    `${RUNNER_IMAGE_DOCKERFILE}, so change its defaults there instead. ` +
                    `Accepted: ${[...FORWARDED_FLAGS.keys()].join(", ")}`
            );
        }
        if (takesValue && inline === undefined) {
            if (index + 1 >= extra.length) {
                throw refusal(`${flag} requires a value`);
            }
            forwarded.push(arg, extra[++index]);
        } else {
            forwarded.push(arg);
        }
    }
    return [
        "build",
        "--file",
        path.join(root, RUNNER_IMAGE_DOCKERFILE),
        "--label",
        `${RUNNER_IMAGE_REVISION_LABEL}=${runnerImageRevision(root)}`,
        "--iidfile",
        idFile,
        ...forwarded,
        root
    ];
}

/** Runs docker with `args`; output goes to this process's console. */
function docker(args, options = {}) {
    const result = spawnSync("docker", args, {
        stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
        encoding: "utf8"
    });
    if (result.error) throw result.error;
    return { status: result.status ?? 1, stdout: result.stdout ?? "" };
}

/** Builds the runner image from the checkout at `root` and returns its image ID. */
function buildRunnerImage(root, extra = [], run = docker) {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "runner-image-"));
    const idFile = path.join(scratch, "image-id");
    try {
        const build = run(runnerImageBuildArgs(root, idFile, extra));
        if (build.status !== 0) {
            throw Object.assign(
                new Error(`docker build exited with ${build.status}`),
                { exitCode: build.status }
            );
        }
        return fs.readFileSync(idFile, "utf8").trim();
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}

/**
 * The runner image a docker server runs: the configured one when it was built from this checkout's
 * runner Dockerfile, otherwise the ID of a fresh build, so a worker that updated its checkout
 * rebuilds instead of refusing to start. Other backends keep the configured image.
 */
function currentRunnerImage(config, root, run = docker) {
    const image = config.runnerImage;
    if (config.executionBackend !== "docker" || config.environmentBackend) {
        return image;
    }
    let reason = `No runner image is configured`;
    if (image) {
        const inspect = run(
            ["image", "inspect", "--format", "{{json .Config.Labels}}", image],
            { capture: true }
        );
        reason =
            inspect.status === 0
                ? staleRunnerImageReason(
                      image,
                      JSON.parse(inspect.stdout.trim() || "null"),
                      root
                  )
                : `Runner image ${image} is not on this host`;
        if (!reason) return image;
    }
    console.log(`${reason}; building it`);
    const built = buildRunnerImage(root, [], run);
    console.log(
        `Built runner image ${built}; set SCP_TEST_RUNNER_IMAGE to it so the next restart does not build again`
    );
    return built;
}

function main(extra = process.argv.slice(2), run = docker) {
    const root = path.resolve(__dirname, "../../..");
    let imageId;
    try {
        imageId = buildRunnerImage(root, extra, run);
    } catch (error) {
        // a refused argument exits 2, a failed build with docker's status, anything else 1
        console.error(error.exitCode ? error.message : error.stack);
        process.exitCode = error.exitCode ?? 1;
        return;
    }
    console.log(`\nexport SCP_TEST_RUNNER_IMAGE='${imageId}'`);
}

if (require.main === module) main();

module.exports = { currentRunnerImage, main, runnerImageBuildArgs };

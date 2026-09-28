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
    runnerImageRevision
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
    ["--pull", false]
]);

/** The docker build arguments for `extra`, or a thrown refusal. */
function runnerImageBuildArgs(root, idFile, extra) {
    const forwarded = [];
    for (let index = 0; index < extra.length; index++) {
        const arg = extra[index];
        const [flag, inline] = arg.split(/=(.*)/s, 2);
        const takesValue = FORWARDED_FLAGS.get(flag);
        if (takesValue === undefined) {
            throw new Error(
                `Refusing docker build argument ${arg}: the image label covers only ` +
                    `${RUNNER_IMAGE_DOCKERFILE}, so change its defaults there instead. ` +
                    `Accepted: ${[...FORWARDED_FLAGS.keys()].join(", ")}`
            );
        }
        if (takesValue && inline === undefined) {
            if (index + 1 >= extra.length) {
                throw new Error(`${flag} requires a value`);
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

function main() {
    const root = path.resolve(__dirname, "../../..");
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "runner-image-"));
    const idFile = path.join(scratch, "image-id");
    try {
        let args;
        try {
            args = runnerImageBuildArgs(root, idFile, process.argv.slice(2));
        } catch (error) {
            console.error(error.message);
            process.exitCode = 2;
            return;
        }
        const build = spawnSync("docker", args, { stdio: "inherit" });
        if (build.error) throw build.error;
        if (build.status !== 0) {
            process.exitCode = build.status ?? 1;
            return;
        }
        const imageId = fs.readFileSync(idFile, "utf8").trim();
        console.log(`\nexport SCP_TEST_RUNNER_IMAGE='${imageId}'`);
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}

if (require.main === module) main();

module.exports = { runnerImageBuildArgs };

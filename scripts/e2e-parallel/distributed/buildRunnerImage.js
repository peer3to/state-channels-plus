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

function main() {
    const root = path.resolve(__dirname, "../../..");
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "runner-image-"));
    const idFile = path.join(scratch, "image-id");
    try {
        const build = spawnSync(
            "docker",
            [
                "build",
                "--file",
                path.join(root, RUNNER_IMAGE_DOCKERFILE),
                "--label",
                `${RUNNER_IMAGE_REVISION_LABEL}=${runnerImageRevision(root)}`,
                "--iidfile",
                idFile,
                ...process.argv.slice(2),
                root
            ],
            { stdio: "inherit" }
        );
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

main();

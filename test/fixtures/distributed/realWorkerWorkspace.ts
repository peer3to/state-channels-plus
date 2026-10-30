// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import fs from "fs";
import { execFileSync } from "node:child_process";
import path from "path";

// The node_modules this checkout resolves Hardhat from (dist/ has none).
const HARDHAT_NODE_MODULES = path.dirname(
    path.dirname(require.resolve("hardhat/package.json"))
);
const {
    buildRuntimeBundle
} = require("../../../scripts/e2e-parallel/distributed/runtimeBundle.js");

/**
 * A git project the real `unsafe-host` worker can prepare and run: a Hardhat
 * project with no plugins and one Mocha file holding `testTitles`, each
 * running for a second so a worker requests its next task while one still
 * runs. Workspace
 * preparation meets a `pnpm` (in `binDir`, which the caller puts on PATH) that
 * links the prepared project to this checkout's `node_modules`, so the worker
 * resolves the same Hardhat. The runner entry is a placeholder: the guest
 * always forks its own trusted `worker.js`.
 */
export async function createRealWorkerWorkspace(
    root: string,
    testTitles: string[]
) {
    const projectRoot = path.join(root, "project");
    const testFile = path.join(projectRoot, "test", "cost.test.js");
    const write = (relative: string, content: string) => {
        const file = path.join(projectRoot, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
    };
    write(
        "package.json",
        JSON.stringify({ name: "real-worker-fixture", version: "1.0.0" })
    );
    write("hardhat.config.js", "module.exports = {};\n");
    write(
        "test/cost.test.js",
        `describe("cost fixture", function () {\n${testTitles
            .map(
                (title) =>
                    `    it(${JSON.stringify(title)}, function () { return new Promise((resolve) => setTimeout(resolve, 1000)); });\n`
            )
            .join("")}});\n`
    );
    write(
        "scripts/e2e-parallel/distributed/worker.js",
        "// placeholder: the guest forks its own trusted worker\n"
    );
    execFileSync("git", ["init", "-q"], { cwd: projectRoot });

    const binDir = path.join(root, "bin");
    fs.mkdirSync(binDir);
    fs.writeFileSync(
        path.join(binDir, "pnpm"),
        `#!/bin/sh\n[ -e node_modules ] || ln -s ${JSON.stringify(
            HARDHAT_NODE_MODULES
        )} node_modules\nexit 0\n`
    );
    fs.chmodSync(path.join(binDir, "pnpm"), 0o755);

    const archivePath = path.join(root, "bundle.tgz");
    const manifest = await buildRuntimeBundle(projectRoot, archivePath);
    return { projectRoot, testFile, archivePath, manifest, binDir };
}

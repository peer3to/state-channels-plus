// @spec-test-coverage-ignore: isolated runner dependency-checkpoint fixture
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const {
    PREPARATION_VERSION
} = require("../../../scripts/e2e-parallel/distributed/workspaceCache");
const {
    prepareWorkspace
} = require("../../../scripts/e2e-parallel/distributed/workspacePreparation");

export function dependencyCheckpoint() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dependency-input-"));
    const cwd = path.join(root, "project");
    const storeDir = path.join(root, "store");
    fs.mkdirSync(path.join(cwd, "node_modules"), { recursive: true });
    const manifest = {
        repositories: [{ path: "project", name: "project", hasPnpmLock: true }],
        files: [{ path: "project/pnpm-lock.yaml", sha256: "lock" }]
    };
    const state = { installs: 0, failInstall: false };
    const marker = path.join(
        storeDir,
        `prepared-dependencies-${crypto.createHash("sha256").update(cwd).digest("hex")}.json`
    );
    return {
        manifest,
        state,
        marker,
        async prepare() {
            await prepareWorkspace(root, manifest, {
                storeDir,
                cacheDependencies: true,
                onOutput() {},
                commandRunner: {
                    async run(_command: string, args: string[]) {
                        if (args[0] === "install") {
                            state.installs++;
                            if (state.failInstall)
                                throw new Error("install failed");
                        }
                    }
                }
            });
        },
        markPreviousVersion() {
            fs.writeFileSync(
                marker,
                crypto
                    .createHash("sha256")
                    .update(
                        JSON.stringify({
                            version: PREPARATION_VERSION - 1,
                            repository: "project",
                            files: manifest.files
                        })
                    )
                    .digest("hex")
            );
        },
        close() {
            fs.rmSync(root, { recursive: true, force: true });
        }
    };
}

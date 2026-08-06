import { expect } from "chai";
import fs from "fs";
import os from "os";
import path from "path";

const {
    buildWorkerEnvironment
} = require("../../scripts/e2e-parallel/distributed/remoteEnvironment.js");

const {
    prepareWorkspace
} = require("../../scripts/e2e-parallel/distributed/workspacePreparation.js");

describe("distributed workspace preparation", function () {
    it("does not pass unrelated server secrets into uploaded code", function () {
        const env = buildWorkerEnvironment({
            PATH: "/bin",
            HOME: "/tmp/home",
            SERVER_SENTINEL_SECRET: "must-not-leak",
            SCP_TEST_POOL_SECRET: "must-not-leak"
        });
        expect(env).to.deep.equal({ PATH: "/bin", HOME: "/tmp/home" });
    });

    it("installs and prepares linked repositories in dependency order", async function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "workspace-prepare-")
        );
        const workspace = path.join(root, "workspace");
        const bin = path.join(root, "bin");
        const calls = path.join(root, "calls.jsonl");
        try {
            fs.mkdirSync(path.join(workspace, "linked"), { recursive: true });
            fs.mkdirSync(path.join(workspace, "project"), { recursive: true });
            fs.mkdirSync(bin);
            const pnpm = path.join(bin, "pnpm");
            fs.writeFileSync(
                pnpm,
                `#!${process.execPath}\nconst fs=require("fs"); fs.appendFileSync(process.env.CALLS, JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),husky:process.env.HUSKY})+"\\n");\n`
            );
            fs.chmodSync(pnpm, 0o755);
            const children = new Set<unknown>();
            const stages: string[] = [];
            await prepareWorkspace(
                workspace,
                {
                    repositories: [
                        {
                            path: "linked",
                            name: "linked",
                            prepareScript: "build",
                            hasPnpmLock: false,
                            hasYarnLock: false
                        },
                        {
                            path: "project",
                            name: "project",
                            prepareScript: "compile",
                            hasPnpmLock: false,
                            hasYarnLock: true
                        }
                    ]
                },
                {
                    workRoot: path.join(root, "worker"),
                    runtime: {
                        addChild(child: unknown) {
                            children.add(child);
                        }
                    },
                    env: {
                        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
                        CALLS: calls
                    },
                    onStage(stage: string) {
                        stages.push(stage);
                    },
                    onOutput() {}
                }
            );
            const recorded = fs
                .readFileSync(calls, "utf8")
                .trim()
                .split("\n")
                .map((line) => JSON.parse(line));
            expect(
                recorded.map((entry) => path.basename(entry.cwd))
            ).to.deep.equal([
                "linked",
                "linked",
                "project",
                "project",
                "project"
            ]);
            expect(recorded.map((entry) => entry.args[0])).to.deep.equal([
                "install",
                "run",
                "import",
                "install",
                "run"
            ]);
            expect(recorded[0].args).to.include("--no-frozen-lockfile");
            expect(recorded[3].args).to.include("--frozen-lockfile");
            expect(recorded[0].args).to.include(
                "--config.dangerously-allow-all-builds=true"
            );
            expect(recorded[3].args).to.include(
                "--config.dangerously-allow-all-builds=true"
            );
            expect(recorded[0].args).not.to.include("--ignore-scripts");
            expect(recorded[3].args).not.to.include("--ignore-scripts");
            expect(recorded.every((entry) => entry.husky === "0")).to.equal(
                true
            );
            expect(
                fs.existsSync(path.join(root, "worker", "pnpm-store"))
            ).to.equal(true);
            expect(children.size).to.equal(5);
            expect(stages).to.deep.equal([
                "Installing dependencies for linked",
                "Building linked",
                "Installing dependencies for project",
                "Building project"
            ]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

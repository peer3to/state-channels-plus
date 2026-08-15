// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import { expect } from "chai";
import fs from "fs";
import os from "os";
import path from "path";

const {
    buildWorkerEnvironment
} = require("../../scripts/e2e-parallel/distributed/remoteEnvironment.js");

const {
    prepareWorkspace,
    selectPrepareScript
} = require("../../scripts/e2e-parallel/distributed/workspacePreparation.js");

describe("distributed workspace preparation", function () {
    const repository = {
        path: "state-channels-plus",
        prepareScript: "full",
        cachedPrepareScript: "cached",
        contractCompileInputs: [
            "contracts/",
            "hardhat.config.ts",
            "package.json"
        ]
    };

    it("reuses compiled contracts for non-contract source changes", function () {
        expect(
            selectPrepareScript(repository, {
                preparationChanged: false,
                changed: ["state-channels-plus/src/index.ts"],
                deleted: []
            })
        ).to.equal("cached");
    });

    it("recompiles when Solidity inputs change or preparation is stale", function () {
        for (const changed of [
            "state-channels-plus/contracts/Channel.sol",
            "state-channels-plus/hardhat.config.ts",
            "state-channels-plus/package.json"
        ]) {
            expect(
                selectPrepareScript(repository, {
                    preparationChanged: false,
                    changed: [changed],
                    deleted: []
                })
            ).to.equal("full");
        }
        expect(
            selectPrepareScript(repository, {
                preparationChanged: true,
                changed: ["state-channels-plus/src/index.ts"],
                deleted: []
            })
        ).to.equal("full");
    });
    it("does not pass unrelated server secrets into uploaded code", function () {
        const env = buildWorkerEnvironment({
            PATH: "/bin",
            HOME: "/tmp/home",
            SERVER_SENTINEL_SECRET: "must-not-leak",
            SCP_TEST_POOL_SECRET: "must-not-leak"
        });
        expect(env).to.deep.equal({ PATH: "/bin", HOME: "/tmp/home" });
    });

    it("rebuilds missing native modules once and fails the preparation loudly", async function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "workspace-native-")
        );
        const workspace = path.join(root, "workspace");
        const bin = path.join(root, "bin");
        const calls = path.join(root, "calls.jsonl");
        try {
            fs.mkdirSync(path.join(workspace, "project"), { recursive: true });
            fs.mkdirSync(bin);
            const pnpm = path.join(bin, "pnpm");
            fs.writeFileSync(
                pnpm,
                `#!${process.execPath}\nconst fs=require("fs"); fs.appendFileSync(process.env.CALLS, JSON.stringify({args:process.argv.slice(2)})+"\\n");\n`
            );
            fs.chmodSync(pnpm, 0o755);
            let failure: Error | null = null;
            try {
                await prepareWorkspace(
                    workspace,
                    {
                        repositories: [
                            {
                                path: "project",
                                name: "project",
                                prepareScript: null,
                                hasPnpmLock: true,
                                hasYarnLock: false,
                                verifyNativeModules: [
                                    "scp-missing-native-module"
                                ]
                            }
                        ]
                    },
                    {
                        workRoot: path.join(root, "worker"),
                        runtime: {
                            addChild() {},
                            inheritedFileDescriptors() {
                                return [];
                            }
                        },
                        shouldInstall: () => false,
                        env: {
                            PATH: `${bin}${path.delimiter}${process.env.PATH}`,
                            CALLS: calls
                        },
                        onOutput() {}
                    }
                );
            } catch (error) {
                failure = error as Error;
            }
            expect(failure?.message).to.include(
                "Native modules failed to load after rebuild in project"
            );
            expect(failure?.message).to.include("scp-missing-native-module");
            const recorded = fs
                .readFileSync(calls, "utf8")
                .trim()
                .split("\n")
                .map((line) => JSON.parse(line));
            expect(recorded.map((entry) => entry.args)).to.deep.equal([
                ["rebuild", "scp-missing-native-module"]
            ]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
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
                        },
                        inheritedFileDescriptors() {
                            return [];
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
            expect(recorded[0].args).not.to.include(
                "--config.dangerously-allow-all-builds=true"
            );
            expect(recorded[3].args).not.to.include(
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

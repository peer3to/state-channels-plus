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
const {
    IsolatedGuestCommandRunner
} = require("../../scripts/e2e-parallel/distributed/isolatedGuestCommandRunner.js");

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
                prepared: false,
                preparationChanged: false,
                contractPreparationChanged: false,
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
                    prepared: true,
                    preparationChanged: false,
                    changed: [changed],
                    deleted: []
                })
            ).to.equal("full");
        }
        expect(
            selectPrepareScript(repository, {
                prepared: true,
                preparationChanged: true,
                changed: ["state-channels-plus/src/index.ts"],
                deleted: []
            })
        ).to.equal("full");
    });

    it("rebuilds contracts when the cached contract preparation did not complete", function () {
        expect(
            selectPrepareScript(repository, {
                prepared: false,
                preparationChanged: false,
                contractPreparationChanged: true,
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

    it("reports activity while an isolated preparation command is silent", async function () {
        const stages: string[] = [];
        const runner = new IsolatedGuestCommandRunner({
            keepaliveIntervalMs: 10
        });
        await runner.run(
            process.execPath,
            ["-e", "setTimeout(() => process.exit(0), 60)"],
            {
                cwd: process.cwd(),
                env: process.env,
                onOutput() {},
                onStage(stage: string) {
                    stages.push(stage);
                }
            }
        );
        expect(stages.length).to.be.greaterThan(0);
        expect(stages[0]).to.include("Still running");
    });

    it("rebuilds missing native modules once and fails the preparation loudly", async function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "workspace-native-")
        );
        const workspace = path.join(root, "workspace");
        const calls: Array<{ command: string; args: string[] }> = [];
        try {
            fs.mkdirSync(path.join(workspace, "project"), { recursive: true });
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
                        storeDir: path.join(root, "store"),
                        commandRunner: {
                            async run(command: string, args: string[]) {
                                calls.push({ command, args });
                                if (command === "node") {
                                    throw new Error("native module missing");
                                }
                            }
                        },
                        shouldInstall: () => false,
                        env: {},
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
            expect(calls).to.deep.equal([
                {
                    command: "node",
                    args: [
                        "-e",
                        'for (const name of ["scp-missing-native-module"]) require(name)'
                    ]
                },
                {
                    command: "pnpm",
                    args: ["rebuild", "scp-missing-native-module"]
                },
                {
                    command: "node",
                    args: [
                        "-e",
                        'for (const name of ["scp-missing-native-module"]) require(name)'
                    ]
                }
            ]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("does not build a linked repository with no source changes", async function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "workspace-unchanged-")
        );
        const workspace = path.join(root, "workspace");
        const calls: Array<{ command: string; args: string[] }> = [];
        try {
            fs.mkdirSync(path.join(workspace, "poker-contracts"), {
                recursive: true
            });
            await prepareWorkspace(
                workspace,
                {
                    repositories: [
                        {
                            path: "poker-contracts",
                            name: "poker-contracts",
                            prepareScript: "compile",
                            hasPnpmLock: true,
                            hasYarnLock: false,
                            verifyNativeModules: []
                        }
                    ]
                },
                {
                    storeDir: path.join(root, "store"),
                    commandRunner: {
                        async run(command: string, args: string[]) {
                            calls.push({ command, args });
                        }
                    },
                    shouldInstall: () => false,
                    selectPrepareScript: () => null,
                    env: {},
                    onOutput() {}
                }
            );

            expect(calls).to.deep.equal([]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("skips an unchanged linked repository after another repository changes", function () {
        expect(
            selectPrepareScript(
                {
                    path: "poker-contracts",
                    prepareScript: "compile",
                    cachedPrepareScript: null,
                    contractCompileInputs: []
                },
                {
                    prepared: false,
                    preparationChanged: false,
                    contractPreparationChanged: false,
                    changed: ["state-channels-plus/test/utils/nodeInfra.js"],
                    deleted: []
                }
            )
        ).to.equal(null);
    });

    it("rebuilds a consumer when linked contract inputs change", function () {
        const linked = repository;
        const consumer = {
            path: "poker-contracts",
            prepareScript: "compile",
            cachedPrepareScript: null,
            contractCompileInputs: []
        };
        expect(
            selectPrepareScript(
                consumer,
                {
                    prepared: false,
                    preparationChanged: false,
                    changed: [
                        "state-channels-plus/contracts/V1/AStateMachine.sol"
                    ],
                    deleted: []
                },
                [linked, consumer]
            )
        ).to.equal("compile");
    });

    it("installs and prepares linked repositories in dependency order", async function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "workspace-prepare-")
        );
        const workspace = path.join(root, "workspace");
        const recorded: Array<{
            command: string;
            cwd: string;
            args: string[];
            husky: string;
        }> = [];
        try {
            fs.mkdirSync(path.join(workspace, "linked"), { recursive: true });
            fs.mkdirSync(path.join(workspace, "project"), { recursive: true });
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
                    storeDir: path.join(root, "store"),
                    commandRunner: {
                        async run(
                            command: string,
                            args: string[],
                            options: {
                                cwd: string;
                                env: Record<string, string>;
                            }
                        ) {
                            recorded.push({
                                command,
                                cwd: options.cwd,
                                args,
                                husky: options.env.HUSKY
                            });
                        }
                    },
                    env: {},
                    onStage(stage: string) {
                        stages.push(stage);
                    },
                    onOutput() {}
                }
            );
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
            expect(recorded[3].args).to.include("--shamefully-hoist");
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
            expect(fs.existsSync(path.join(root, "store"))).to.equal(true);
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

// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import { expect } from "chai";
import { execFileSync, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

type ParallelTask = {
    label: string;
    logName: string;
    args: string[];
    fullTitle: string;
    runner: string;
    isE2E: boolean;
};

const { FORGE_TEST_TASK, extractForgeTestContracts, discoverForgeTasks } =
    require("../../scripts/e2e-parallel/shared/forgeTaskDiscovery.js") as {
        FORGE_TEST_TASK: string;
        extractForgeTestContracts: (filePath: string) => string[];
        discoverForgeTasks: (
            testDir: string,
            grep?: string,
            options?: { threads?: number; testPattern?: string }
        ) => {
            files: string[];
            tasks: ParallelTask[];
            preGrepTaskCount: number;
        };
    };
const { DEFAULT_FORGE_THREADS, FORGE_BIN } =
    require("../../scripts/e2e-parallel/shared/forgeConfig.js") as {
        DEFAULT_FORGE_THREADS: number;
        FORGE_BIN: string;
    };
const { discoverTasks } =
    require("../../scripts/e2e-parallel/shared/taskDiscovery.js") as {
        discoverTasks: (
            testDir: string,
            grep?: string,
            e2eDir?: string,
            testPattern?: string
        ) => {
            files: string[];
            tasks: ParallelTask[];
            preGrepTaskCount: number;
        };
    };
const { TASK_RUNNERS, requiresChainSlot, countForgeTasks } =
    require("../../scripts/e2e-parallel/shared/taskRunners.js") as {
        TASK_RUNNERS: { HARDHAT: string; FORGE: string };
        requiresChainSlot: (task: { runner?: string }) => boolean;
        countForgeTasks: (tasks: { runner?: string }[]) => number;
    };
const { toWireTask, fromWireTask } =
    require("../../scripts/e2e-parallel/distributed/taskWire.js") as {
        toWireTask: (
            task: {
                label: string;
                logName: string;
                runner?: string;
                args: string[];
            },
            projectRoot: string
        ) => { label: string; logName: string; runner: string; args: string[] };
        fromWireTask: (
            task: {
                label: string;
                logName: string;
                runner?: string;
                args: string[];
            },
            projectRoot: string
        ) => { runner: string; args: string[] };
    };
const { parseCliArgs, resolveDiscoverySelection } =
    require("../../scripts/e2e-parallel/shared/argParser.js") as {
        parseCliArgs: (argv: string[]) => {
            forge: boolean;
            forgeOnly: boolean;
            forgeThreads: number;
            e2eOnly: boolean;
            testPattern?: string;
            mochaTestPattern?: string;
            forgeTestPattern?: string;
            executionProfile?: { slots?: number };
        };
        resolveDiscoverySelection: (options: {
            forge?: boolean;
            forgeOnly?: boolean;
            e2eOnly?: boolean;
        }) => { includeMocha: boolean; includeForge: boolean };
    };
const {
    discoveryFailureMessage,
    validateDiscoveryResults,
    resolveDistributedExecutionProfile,
    resolveSlotCount
} = require("../../scripts/test-e2e-parallel.js") as {
    discoveryFailureMessage: (
        tier: string,
        grep: string | undefined,
        error: Error
    ) => string;
    validateDiscoveryResults: (
        cli: Record<string, unknown>,
        selection: { includeMocha: boolean; includeForge: boolean },
        mocha: { tasks: unknown[]; preGrepTaskCount: number },
        forge: { tasks: unknown[]; preGrepTaskCount: number }
    ) => string | null;
    resolveDistributedExecutionProfile: (
        profile: Record<string, number> | undefined,
        slotCount: number
    ) => Record<string, number> | undefined;
    resolveSlotCount: (
        tasks: { runner?: string }[],
        requestedSlotCount: number,
        maxSlots: number
    ) => number;
};
const { reduceAttemptOutput, validateReducedAttempt } =
    require("../../scripts/e2e-parallel/shared/taskCoordinator.js") as {
        reduceAttemptOutput: (stdout: string, stderr: string) => unknown;
        validateReducedAttempt: (reduced: unknown) => unknown;
    };
const { resolveProjectHardhatCli } =
    require("../../scripts/e2e-parallel/shared/projectModules.js") as {
        resolveProjectHardhatCli: (projectRoot?: string) => string;
    };
const { runForge } =
    require("../../scripts/e2e-parallel/shared/forgeRunner.js") as {
        runForge: (
            args: string[],
            cwd: string,
            options: {
                env: NodeJS.ProcessEnv;
                stdio: "ignore";
                stderr: { write: (message: string) => void };
            }
        ) => Promise<number>;
    };

const REPO_TEST_DIR = path.resolve(__dirname, "..");
const argv = (...args: string[]) => ["node", "runner", ...args];

const FORGE_TASK = {
    label: "forge:Sample.t.sol:SampleTest",
    logName: "Sample.t__SampleTest",
    runner: "forge",
    args: ["forge-test", "--match-contract", "^SampleTest$", "--threads", "1"]
};
const MOCHA_TASK = {
    label: "test:logic.test.ts:runs",
    logName: "logic__runs",
    runner: "hardhat",
    args: ["test", "--no-compile"]
};

const TEST_CONTRACT_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

contract SampleHarness {
    function helper() public pure returns (uint256) {
        return 1;
    }
}

abstract contract SampleBase {
    function test_neverRunsBecauseAbstract() public {}
}

contract SampleTest {
    function setUp() public {}

    function test_first() public {}

    function testFuzz_second(uint256 value) public {}

    function invariant_third() public {}
}
`;

const INHERITED_TEST_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

abstract contract SharedCases {
    function test_sharedCase() public {}
}

contract InheritingTest is SharedCases {}

contract HelperBase {
    function helper() public pure returns (uint256) {
        return 1;
    }
}

contract PlainHelper is HelperBase {}
`;

const IMPORTED_TEST_BASE_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

abstract contract ImportedCases {
    function test_inheritedAcrossFiles() public {}
}
`;

const IMPORTING_TEST_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {ImportedCases} from "./ImportedCases.sol";

contract ImportedCasesTest is ImportedCases {}
`;

const MODERN_PREFIX_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

contract StatefulFuzzCases {
    function statefulFuzz_balanceNeverNegative() public {}
}

contract InvariantCases {
    function invariantBalanceNeverNegative() public {}
}
`;

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function newestFileMtime(root: string, include: (file: string) => boolean) {
    if (!fs.existsSync(root)) return null;
    let newest: number | null = null;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const target = path.join(root, entry.name);
        if (entry.isDirectory()) {
            const nested = newestFileMtime(target, include);
            if (nested !== null) newest = Math.max(newest ?? nested, nested);
        } else if (entry.isFile() && include(target)) {
            const mtime = fs.statSync(target).mtimeMs;
            newest = Math.max(newest ?? mtime, mtime);
        }
    }
    return newest;
}

function hasWarmForgeArtifacts(
    root = REPO_ROOT,
    forgeAvailable = () =>
        !spawnSync(FORGE_BIN, ["--version"], {
            cwd: root,
            stdio: "ignore"
        }).error
) {
    if (!fs.existsSync(path.join(root, "cache_forge"))) return false;
    const newestArtifact = newestFileMtime(path.join(root, "out"), () => true);
    if (newestArtifact === null) return false;
    const newestSource = ["contracts", "test"]
        .map((directory) =>
            newestFileMtime(path.join(root, directory), (file) =>
                file.endsWith(".sol")
            )
        )
        .filter((mtime): mtime is number => mtime !== null)
        .reduce<number | null>(
            (newest, mtime) => Math.max(newest ?? mtime, mtime),
            null
        );
    if (newestSource !== null && newestSource > newestArtifact) return false;
    return forgeAvailable();
}

/** Contract names foundry itself reports, flattened across its per-file map. */
function forgeListedContracts() {
    const listed = execFileSync("forge", ["test", "--list", "--json"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 64 * 1024 * 1024
    });
    const byFile = JSON.parse(listed) as Record<
        string,
        Record<string, string[]>
    >;
    return Object.values(byFile).flatMap((contracts) => Object.keys(contracts));
}

async function runForgeFixture(script?: string) {
    fs.mkdirSync(path.join(REPO_ROOT, "temp"), { recursive: true });
    const root = fs.mkdtempSync(
        path.join(REPO_ROOT, "temp", "forge-task-bin-")
    );
    const argsFile = path.join(root, "args.txt");
    if (script !== undefined) {
        const executable = path.join(root, "forge");
        fs.writeFileSync(executable, `#!/bin/sh\n${script}\n`);
        fs.chmodSync(executable, 0o755);
    }
    const errors: string[] = [];
    const status = await runForge(
        ["test", "--match-contract", "^SampleTest$", "--threads", "2"],
        REPO_ROOT,
        {
            env: {
                ...process.env,
                PATH: root,
                FORGE_ARGS_FILE: argsFile
            },
            stdio: "ignore",
            stderr: { write: (message: string) => errors.push(message) }
        }
    );
    return { root, argsFile, status, errors };
}

function runParallelDryEntry(args: string[], cwd = REPO_ROOT) {
    if (cwd !== REPO_ROOT) {
        const hardhatRoot = path.join(cwd, "node_modules", "hardhat");
        const hardhatCli = path.join(hardhatRoot, "internal", "cli", "cli.js");
        fs.mkdirSync(path.dirname(hardhatCli), { recursive: true });
        fs.writeFileSync(
            path.join(hardhatRoot, "package.json"),
            JSON.stringify({ name: "hardhat", version: "0.0.0" })
        );
        fs.writeFileSync(hardhatCli, "");
    }
    return spawnSync(
        process.execPath,
        [path.join(REPO_ROOT, "scripts", "test-e2e-parallel.js"), ...args],
        {
            cwd,
            encoding: "utf8",
            env: { ...process.env, PATH: "" }
        }
    );
}

describe("parallel forge task discovery", function () {
    it("does not invoke Foundry when parity artifacts are cold", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "cold-forge-parity-")
        );
        let probes = 0;
        try {
            expect(
                hasWarmForgeArtifacts(root, () => {
                    probes++;
                    return true;
                })
            ).to.equal(false);
            expect(probes).to.equal(0);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("runs parity only when warm artifacts and Foundry are present", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "warm-forge-parity-")
        );
        try {
            fs.mkdirSync(path.join(root, "out"));
            fs.mkdirSync(path.join(root, "cache_forge"));
            fs.writeFileSync(path.join(root, "out", "artifact.json"), "{}");
            expect(hasWarmForgeArtifacts(root, () => true)).to.equal(true);
            expect(hasWarmForgeArtifacts(root, () => false)).to.equal(false);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("skips parity when Solidity sources are newer than Forge artifacts", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "stale-forge-parity-")
        );
        const artifact = path.join(root, "out", "artifact.json");
        const source = path.join(root, "contracts", "Changed.sol");
        let probes = 0;
        try {
            fs.mkdirSync(path.dirname(artifact), { recursive: true });
            fs.mkdirSync(path.dirname(source), { recursive: true });
            fs.mkdirSync(path.join(root, "cache_forge"));
            fs.writeFileSync(artifact, "{}");
            fs.writeFileSync(source, "contract Changed {}");
            const old = new Date(Date.now() - 2000);
            fs.utimesSync(artifact, old, old);
            expect(
                hasWarmForgeArtifacts(root, () => {
                    probes++;
                    return true;
                })
            ).to.equal(false);
            expect(probes).to.equal(0);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("discovers one task per Foundry test contract in the repository test tree", function () {
        const { tasks } = discoverForgeTasks(REPO_TEST_DIR);
        expect(tasks.map((task) => task.fullTitle)).to.have.members([
            "DisputeVerificationFacetTest",
            "DisputeUtilsTest",
            "FraudProofFacetTest",
            "JoinChannelFacetTest",
            "StateChannelManagerProxyDepositTest",
            "StateChannelManagerProxyOpenTest",
            "StateChannelManagerProxyRegistrationTest",
            "UtilityFacetTest"
        ]);
        expect(tasks).to.have.lengthOf(8);
    });

    it("includes a test contract declared in a .test.sol file", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-dotted-"));
        try {
            fs.writeFileSync(
                path.join(root, "Sample.test.sol"),
                TEST_CONTRACT_SOURCE
            );
            const { tasks } = discoverForgeTasks(root);
            expect(tasks).to.have.lengthOf(1);
            expect(tasks[0].label).to.equal("forge:Sample.test.sol:SampleTest");
            expect(tasks[0].logName).to.equal("Sample.test__SampleTest");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("skips harness contracts that declare no test function", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-harness-"));
        try {
            fs.writeFileSync(
                path.join(root, "Sample.t.sol"),
                TEST_CONTRACT_SOURCE
            );
            expect(
                extractForgeTestContracts(path.join(root, "Sample.t.sol"))
            ).to.deep.equal(["SampleTest"]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("selects a contract that inherits its test functions from a same-file base", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-inherit-"));
        const file = path.join(root, "Inherited.t.sol");
        try {
            fs.writeFileSync(file, INHERITED_TEST_SOURCE);
            expect(extractForgeTestContracts(file)).to.deep.equal([
                "InheritingTest"
            ]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("selects a concrete contract whose tests come from an imported abstract base", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "forge-import-inherit-")
        );
        try {
            fs.writeFileSync(
                path.join(root, "ImportedCases.sol"),
                IMPORTED_TEST_BASE_SOURCE
            );
            fs.writeFileSync(
                path.join(root, "ImportedCases.t.sol"),
                IMPORTING_TEST_SOURCE
            );
            const { tasks } = discoverForgeTasks(root);
            expect(tasks.map((task) => task.fullTitle)).to.deep.equal([
                "ImportedCasesTest"
            ]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("ignores a resolved import target that is a directory", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "forge-directory-import-")
        );
        try {
            fs.mkdirSync(path.join(root, "sdk"));
            fs.writeFileSync(
                path.join(root, "Sample.t.sol"),
                `import "./sdk";\n${TEST_CONTRACT_SOURCE}`
            );
            expect(
                discoverForgeTasks(root).tasks.map((task) => task.fullTitle)
            ).to.deep.equal(["SampleTest"]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("skips a contract inheriting only from a base without test functions", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-helper-"));
        const file = path.join(root, "Inherited.t.sol");
        try {
            fs.writeFileSync(file, INHERITED_TEST_SOURCE);
            expect(extractForgeTestContracts(file)).to.not.include(
                "PlainHelper"
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("selects a contract whose only test function uses the statefulFuzz prefix", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-stateful-"));
        const file = path.join(root, "Prefixes.t.sol");
        try {
            fs.writeFileSync(file, MODERN_PREFIX_SOURCE);
            expect(extractForgeTestContracts(file)).to.include(
                "StatefulFuzzCases"
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("selects a contract whose invariant function has no underscore after the prefix", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-invariant-"));
        const file = path.join(root, "Prefixes.t.sol");
        try {
            fs.writeFileSync(file, MODERN_PREFIX_SOURCE);
            expect(extractForgeTestContracts(file)).to.include(
                "InvariantCases"
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("fails discovery when two files declare a test contract with the same name", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-duplicate-"));
        try {
            fs.writeFileSync(
                path.join(root, "First.t.sol"),
                TEST_CONTRACT_SOURCE
            );
            fs.writeFileSync(
                path.join(root, "Second.t.sol"),
                TEST_CONTRACT_SOURCE
            );
            expect(() => discoverForgeTasks(root)).to.throw(
                /Duplicate Foundry test contract name\(s\): SampleTest/
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("explains that a duplicate contract name makes every task run both contracts", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-collide-"));
        try {
            fs.writeFileSync(
                path.join(root, "First.t.sol"),
                TEST_CONTRACT_SOURCE
            );
            fs.writeFileSync(
                path.join(root, "Second.t.sol"),
                TEST_CONTRACT_SOURCE
            );
            expect(() => discoverForgeTasks(root)).to.throw(
                /matches contract names project-wide/
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("finds exactly the test contracts foundry itself lists for the repository", function () {
        if (!hasWarmForgeArtifacts()) this.skip();
        const listed = forgeListedContracts();
        const { tasks } = discoverForgeTasks(REPO_TEST_DIR);
        expect(tasks.map((task) => task.fullTitle).sort()).to.deep.equal(
            listed.sort()
        );
    });

    it("ignores contract declarations inside comments and string literals", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-comments-"));
        const file = path.join(root, "Commented.t.sol");
        try {
            fs.writeFileSync(
                file,
                [
                    "// contract CommentedOutTest { function test_x() public {} }",
                    "/* contract BlockCommentTest { function test_y() public {} } */",
                    "contract RealTest {",
                    '    string public note = "contract QuotedTest { function test_z() public {} }";',
                    "    function test_real() public {}",
                    "}"
                ].join("\n")
            );
            expect(extractForgeTestContracts(file)).to.deep.equal(["RealTest"]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("excludes vendored lib and build output directories", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-ignored-"));
        try {
            for (const dir of ["lib", "out", "unit"]) {
                fs.mkdirSync(path.join(root, dir), { recursive: true });
                fs.writeFileSync(
                    path.join(root, dir, "Sample.t.sol"),
                    TEST_CONTRACT_SOURCE
                );
            }
            const { tasks } = discoverForgeTasks(root);
            expect(tasks).to.have.lengthOf(1);
            expect(tasks[0].label).to.equal("forge:Sample.t.sol:SampleTest");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("applies --grep to the forge contract title", function () {
        const { tasks } = discoverForgeTasks(
            REPO_TEST_DIR,
            "^StateChannelManagerProxy"
        );
        expect(tasks.map((task) => task.fullTitle)).to.have.members([
            "StateChannelManagerProxyDepositTest",
            "StateChannelManagerProxyOpenTest",
            "StateChannelManagerProxyRegistrationTest"
        ]);
    });

    it("runs a forge task as a single anchored contract match", function () {
        const { tasks } = discoverForgeTasks(
            REPO_TEST_DIR,
            "^UtilityFacetTest$"
        );
        expect(tasks[0].args).to.deep.equal([
            "forge-test",
            "--match-contract",
            "^UtilityFacetTest$",
            "--threads",
            "1"
        ]);
        expect(tasks[0].runner).to.equal("forge");
        expect(tasks[0].isE2E).to.equal(false);
    });

    it("invokes the forge tier through the hardhat forge-test task", function () {
        const { tasks } = discoverForgeTasks(REPO_TEST_DIR);
        expect(
            tasks.every((task) => task.args[0] === FORGE_TEST_TASK)
        ).to.equal(true);
    });

    it("pins every forge task to one thread by default", function () {
        expect(DEFAULT_FORGE_THREADS).to.equal(1);
        const { tasks } = discoverForgeTasks(REPO_TEST_DIR);
        expect(
            tasks.every(
                (task) => task.args[task.args.indexOf("--threads") + 1] === "1"
            )
        ).to.equal(true);
    });

    it("accepts an explicit forge thread count", function () {
        const { tasks } = discoverForgeTasks(REPO_TEST_DIR, undefined, {
            threads: 3
        });
        expect(tasks[0].args[tasks[0].args.indexOf("--threads") + 1]).to.equal(
            "3"
        );
    });

    it("rejects a forge thread count of zero because it means all logical cores", function () {
        expect(() =>
            discoverForgeTasks(REPO_TEST_DIR, undefined, { threads: 0 })
        ).to.throw(/positive integer/);
    });
});

describe("forge task runner", function () {
    it("runs the configured forge binary with the selected contract and threads", async function () {
        const run = await runForgeFixture(
            'printf "%s\\n" "$@" > "$FORGE_ARGS_FILE"; exit 0'
        );
        try {
            expect(run.status).to.equal(0);
            expect(
                fs.readFileSync(run.argsFile, "utf8").trim().split("\n")
            ).to.deep.equal([
                "test",
                "--match-contract",
                "^SampleTest$",
                "--threads",
                "2"
            ]);
        } finally {
            fs.rmSync(run.root, { recursive: true, force: true });
        }
    });

    it("fails when the forge executable is missing", async function () {
        const run = await runForgeFixture();
        try {
            expect(run.status).to.equal(1);
            expect(run.errors.join("\n")).to.include(
                "Could not run `forge test"
            );
        } finally {
            fs.rmSync(run.root, { recursive: true, force: true });
        }
    });

    it("passes a nonzero forge exit through as a runner failure", async function () {
        const run = await runForgeFixture("exit 7");
        try {
            expect(run.status).to.equal(7);
        } finally {
            fs.rmSync(run.root, { recursive: true, force: true });
        }
    });

    it("turns a forge signal exit into a runner failure", async function () {
        const run = await runForgeFixture("kill -TERM $$");
        try {
            expect(run.status).to.equal(1);
        } finally {
            fs.rmSync(run.root, { recursive: true, force: true });
        }
    });
});

describe("parallel task runner classification", function () {
    it("resolves Hardhat from the caller project", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "project-hardhat-"));
        const cli = path.join(
            root,
            "node_modules",
            "hardhat",
            "internal",
            "cli",
            "cli.js"
        );
        try {
            fs.mkdirSync(path.dirname(cli), { recursive: true });
            fs.writeFileSync(cli, "");
            expect(resolveProjectHardhatCli(root)).to.equal(cli);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("loads copied node infrastructure from the compiled package layout", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "node-infra-dist-"));
        const packageRoot = path.join(root, "state-channels-plus");
        const callerRoot = path.join(root, "caller");
        const copiedNodeInfra = path.join(
            packageRoot,
            "dist",
            "test",
            "utils",
            "nodeInfra.js"
        );
        const copiedProjectModules = path.join(
            packageRoot,
            "scripts",
            "e2e-parallel",
            "shared",
            "projectModules.js"
        );
        const discoveryScript = path.join(
            packageRoot,
            "scripts",
            "infra",
            "local-discovery-registry.js"
        );
        const hardhatCli = path.join(
            callerRoot,
            "node_modules",
            "hardhat",
            "internal",
            "cli",
            "cli.js"
        );
        const previousCwd = process.cwd();
        try {
            for (const filePath of [
                copiedNodeInfra,
                copiedProjectModules,
                discoveryScript,
                hardhatCli
            ]) {
                fs.mkdirSync(path.dirname(filePath), { recursive: true });
            }
            fs.copyFileSync(
                path.join(REPO_ROOT, "test", "utils", "nodeInfra.js"),
                copiedNodeInfra
            );
            fs.copyFileSync(
                path.join(
                    REPO_ROOT,
                    "scripts",
                    "e2e-parallel",
                    "shared",
                    "projectModules.js"
                ),
                copiedProjectModules
            );
            fs.writeFileSync(discoveryScript, "");
            fs.writeFileSync(hardhatCli, "");
            process.chdir(callerRoot);

            expect(() => require(copiedNodeInfra)).not.to.throw();
        } finally {
            process.chdir(previousCwd);
            delete require.cache[copiedNodeInfra];
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("treats a task without a runner as a hardhat task", function () {
        expect(requiresChainSlot({})).to.equal(true);
    });

    it("rejects an unknown runner instead of falling back to hardhat", function () {
        expect(() => requiresChainSlot({ runner: "anvil" })).to.throw(
            /Unknown task runner/
        );
    });

    it("keeps forge tasks off the hardhat slot and account pools", function () {
        expect(requiresChainSlot({ runner: TASK_RUNNERS.FORGE })).to.equal(
            false
        );
        expect(requiresChainSlot({ runner: TASK_RUNNERS.HARDHAT })).to.equal(
            true
        );
    });

    it("marks discovered Mocha tasks as hardhat tasks", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "mocha-runner-"));
        const testDir = path.join(root, "test");
        fs.mkdirSync(testDir, { recursive: true });
        fs.writeFileSync(
            path.join(testDir, "logic.ts"),
            'describe("logic", () => { it("runs", () => {}); });'
        );
        try {
            const { tasks } = discoverTasks(testDir);
            expect(tasks[0].runner).to.equal("hardhat");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("counts only the forge tasks in a mixed run", function () {
        expect(countForgeTasks([MOCHA_TASK, FORGE_TASK, FORGE_TASK])).to.equal(
            2
        );
    });
});

describe("parallel task runner wire protocol", function () {
    it("carries the forge runner across the wire round trip", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-wire-"));
        try {
            const wire = toWireTask(FORGE_TASK, root);
            expect(wire.runner).to.equal("forge");
            expect(fromWireTask(wire, root).runner).to.equal("forge");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("stamps a runnerless task as hardhat on the wire", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "hardhat-wire-"));
        try {
            const wire = toWireTask(
                {
                    label: "test:logic.test.ts:runs",
                    logName: "logic__runs",
                    args: ["test", "--no-compile"]
                },
                root
            );
            expect(wire.runner).to.equal("hardhat");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("reads a wire task without a runner as a hardhat task", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-wire-"));
        try {
            const task = fromWireTask(
                {
                    label: "test:logic.test.ts:runs",
                    logName: "logic__runs",
                    args: ["test", "--no-compile"]
                },
                root
            );
            expect(task.runner).to.equal("hardhat");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("rejects a wire task whose runner was corrupted", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "bad-wire-"));
        try {
            expect(() =>
                fromWireTask(
                    {
                        label: "forge:Sample.t.sol:SampleTest",
                        logName: "Sample.t__SampleTest",
                        runner: "anvil",
                        args: ["forge-test"]
                    },
                    root
                )
            ).to.throw(/Unknown task runner/);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

describe("parallel forge tier selection", function () {
    it("discovers both the Mocha and forge tiers by default", function () {
        const parsed = parseCliArgs(argv());
        expect(parsed.forge).to.equal(true);
        expect(parsed.forgeOnly).to.equal(false);
        expect(resolveDiscoverySelection(parsed)).to.deep.equal({
            includeMocha: true,
            includeForge: true
        });
    });

    it("drops the Mocha tier for --forge-only", function () {
        expect(
            resolveDiscoverySelection(parseCliArgs(argv("--forge-only")))
        ).to.deep.equal({ includeMocha: false, includeForge: true });
    });

    it("drops the forge tier for --no-forge", function () {
        expect(
            resolveDiscoverySelection(parseCliArgs(argv("--no-forge")))
        ).to.deep.equal({ includeMocha: true, includeForge: false });
    });

    it("drops the forge tier for --e2e-only", function () {
        expect(
            resolveDiscoverySelection(parseCliArgs(argv("--e2e-only")))
        ).to.deep.equal({ includeMocha: true, includeForge: false });
    });

    it("rejects --forge-only together with --no-forge", function () {
        expect(() => parseCliArgs(argv("--forge-only", "--no-forge"))).to.throw(
            /conflicts with --no-forge/
        );
    });

    it("rejects --forge-only together with --e2e-only", function () {
        expect(() => parseCliArgs(argv("--forge-only", "--e2e-only"))).to.throw(
            /conflicts with --e2e-only/
        );
    });

    it("parses a forge thread override in both flag spellings", function () {
        expect(parseCliArgs(argv()).forgeThreads).to.equal(1);
        expect(
            parseCliArgs(argv("--forge-threads", "4")).forgeThreads
        ).to.equal(4);
        expect(parseCliArgs(argv("--forge-threads=2")).forgeThreads).to.equal(
            2
        );
    });

    it("rejects a --forge-threads value of zero", function () {
        expect(() => parseCliArgs(argv("--forge-threads", "0"))).to.throw(
            /positive integer/
        );
    });

    it("rejects partial, decimal, negative, missing, and nonnumeric forge thread values", function () {
        expect(() => parseCliArgs(argv("--forge-threads", "1.5"))).to.throw(
            /positive integer/
        );
        expect(() => parseCliArgs(argv("--forge-threads=2junk"))).to.throw(
            /positive integer/
        );
        expect(() => parseCliArgs(argv("--forge-threads", "-2"))).to.throw(
            /positive integer/
        );
        expect(() => parseCliArgs(argv("--forge-threads"))).to.throw(
            /positive integer/
        );
        expect(() => parseCliArgs(argv("--forge-threads=nope"))).to.throw(
            /positive integer/
        );
    });

    it("applies the shared test pattern to both tiers", function () {
        const parsed = parseCliArgs(argv("--test-pattern", "focused/**"));
        expect(parsed.testPattern).to.equal("focused/**");
        expect(parsed.mochaTestPattern).to.equal(undefined);
        expect(parsed.forgeTestPattern).to.equal(undefined);
    });

    it("parses independent Mocha and forge test patterns", function () {
        const parsed = parseCliArgs(
            argv(
                "--mocha-test-pattern=unit/**",
                "--forge-test-pattern",
                "V1/**/*.sol"
            )
        );
        expect(parsed.mochaTestPattern).to.equal("unit/**");
        expect(parsed.forgeTestPattern).to.equal("V1/**/*.sol");
    });

    it("keeps a shared filename pattern inside each tier's file boundary", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "shared-pattern-"));
        try {
            fs.writeFileSync(
                path.join(root, "Chosen.test.ts"),
                'it("chosen", function () {});'
            );
            fs.writeFileSync(
                path.join(root, "Other.test.ts"),
                'it("other", function () {});'
            );
            fs.writeFileSync(
                path.join(root, "Chosen.t.sol"),
                TEST_CONTRACT_SOURCE
            );
            fs.writeFileSync(
                path.join(root, "Other.t.sol"),
                TEST_CONTRACT_SOURCE.split("SampleTest").join("OtherTest")
            );
            const parsed = parseCliArgs(argv("--test-pattern", "Chosen.*"));
            const mocha = discoverTasks(
                root,
                undefined,
                undefined,
                parsed.mochaTestPattern ?? parsed.testPattern
            );
            const forge = discoverForgeTasks(root, undefined, {
                testPattern: parsed.forgeTestPattern ?? parsed.testPattern
            });
            expect(mocha.tasks.map((task) => task.fullTitle)).to.deep.equal([
                "chosen"
            ]);
            expect(forge.tasks.map((task) => task.fullTitle)).to.deep.equal([
                "SampleTest"
            ]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("keeps tier-specific filename patterns independent", function () {
        const parsed = parseCliArgs(
            argv(
                "--mocha-test-pattern",
                "unit/**/*.test.ts",
                "--forge-test-pattern=V1/**/*.sol"
            )
        );
        expect(parsed.mochaTestPattern).to.equal("unit/**/*.test.ts");
        expect(parsed.forgeTestPattern).to.equal("V1/**/*.sol");
    });

    it("forces zero distributed slots for a forge-only entry", function () {
        const parsed = parseCliArgs(argv("--distributed", "--forge-only"));
        expect(parsed.executionProfile).to.deep.equal({ slots: 0 });
        expect(
            resolveDistributedExecutionProfile(parsed.executionProfile, 0)
        ).to.deep.equal({ slots: 0 });
    });

    it("leaves distributed slots unset for Mocha-only entries", function () {
        const noForge = parseCliArgs(argv("--distributed", "--no-forge"));
        const e2eOnly = parseCliArgs(argv("--distributed", "--e2e-only"));
        expect(noForge.executionProfile).to.deep.equal({});
        expect(e2eOnly.executionProfile).to.deep.equal({});
        expect(resolveDiscoverySelection(noForge).includeForge).to.equal(false);
        expect(resolveDiscoverySelection(e2eOnly).includeForge).to.equal(false);
    });

    it("runs the distributed --no-forge entry without invoking Foundry", function () {
        const result = runParallelDryEntry([
            "--distributed",
            "--dry-run",
            "--no-forge",
            "--test-pattern",
            "scripts/e2eParallelForgeTasks.test.ts"
        ]);
        expect(result.status, result.stderr).to.equal(0);
        expect(result.stdout).to.include("0 forge");
        expect(result.stdout).to.include("slots=worker default");
    });

    it("runs the distributed --e2e-only entry without invoking Foundry", function () {
        const result = runParallelDryEntry([
            "--distributed",
            "--dry-run",
            "--e2e-only",
            "--test-pattern",
            "E2E-FirstBlockTimestampGrace.test.ts"
        ]);
        expect(result.status, result.stderr).to.equal(0);
        expect(result.stdout).to.include("0 forge");
    });

    it("runs the distributed --forge-only entry with zero slots", function () {
        const result = runParallelDryEntry([
            "--distributed",
            "--dry-run",
            "--forge-only",
            "--forge-test-pattern",
            "V1/StateChannelDiamondProxy/UtilityFacet.t.sol"
        ]);
        expect(result.status, result.stderr).to.equal(0);
        expect(result.stdout).to.include("1 forge");
        expect(result.stdout).to.include("slots=0");
    });
});

describe("parallel forge tier guards", function () {
    it("rejects an explicit Forge pattern with no runnable contracts", function () {
        const result = validateDiscoveryResults(
            {
                forgeTestPattern: "Empty.t.sol",
                forge: true,
                forgeOnly: false,
                e2eOnly: false
            },
            { includeMocha: true, includeForge: true },
            { tasks: [{ fullTitle: "mocha" }], preGrepTaskCount: 1 },
            { tasks: [], preGrepTaskCount: 0 }
        );
        expect(result).to.equal(
            'Forge tier selected by --forge-test-pattern "Empty.t.sol" contains no runnable tests'
        );
    });

    it("rejects an explicit Mocha pattern with no runnable declarations", function () {
        const result = validateDiscoveryResults(
            {
                mochaTestPattern: "Empty.test.ts",
                forge: true,
                forgeOnly: false,
                e2eOnly: false
            },
            { includeMocha: true, includeForge: true },
            { tasks: [], preGrepTaskCount: 0 },
            { tasks: [{ fullTitle: "ForgeTest" }], preGrepTaskCount: 1 }
        );
        expect(result).to.equal(
            'Mocha tier selected by --mocha-test-pattern "Empty.test.ts" contains no runnable tests'
        );
    });

    it("rejects a tier-specific pattern when that tier is disabled", function () {
        const result = validateDiscoveryResults(
            {
                forgeTestPattern: "V1/**/*.sol",
                forge: false,
                forgeOnly: false,
                e2eOnly: false
            },
            { includeMocha: true, includeForge: false },
            { tasks: [{ fullTitle: "mocha" }], preGrepTaskCount: 1 },
            { tasks: [], preGrepTaskCount: 0 }
        );
        expect(result).to.include("conflicts with the selected tiers");
    });

    it("rejects a Mocha pattern combined with --forge-only", function () {
        const result = validateDiscoveryResults(
            {
                mochaTestPattern: "unit/**/*.ts",
                forge: true,
                forgeOnly: true,
                e2eOnly: false
            },
            { includeMocha: false, includeForge: true },
            { tasks: [], preGrepTaskCount: 0 },
            { tasks: [{ fullTitle: "ForgeTest" }], preGrepTaskCount: 1 }
        );
        expect(result).to.include("conflicts with the selected tiers");
    });

    it("allows grep to empty one matched tier when another tier still has work", function () {
        const result = validateDiscoveryResults(
            {
                grep: "selected",
                forge: true,
                forgeOnly: false,
                e2eOnly: false
            },
            { includeMocha: true, includeForge: true },
            { tasks: [{ fullTitle: "selected" }], preGrepTaskCount: 1 },
            { tasks: [], preGrepTaskCount: 1 }
        );
        expect(result).to.equal(null);
    });

    it("reports an all-zero post-grep selection", function () {
        const result = validateDiscoveryResults(
            {
                grep: "absent",
                forge: true,
                forgeOnly: false,
                e2eOnly: false
            },
            { includeMocha: true, includeForge: true },
            { tasks: [], preGrepTaskCount: 1 },
            { tasks: [], preGrepTaskCount: 1 }
        );
        expect(result).to.equal('No selected tests matched --grep "absent"');
    });

    it("fails a dry run when an explicit Forge file contains no runnable contract", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "empty-forge-tier-")
        );
        try {
            fs.mkdirSync(path.join(root, "test"));
            fs.writeFileSync(
                path.join(root, "test", "Mocha.test.ts"),
                'it("runs", function () {});'
            );
            fs.writeFileSync(
                path.join(root, "test", "Empty.t.sol"),
                "contract EmptyHelper { function helper() public {} }"
            );
            const result = runParallelDryEntry(
                ["--dry-run", "--forge-test-pattern", "Empty.t.sol"],
                root
            );
            expect(result.status).to.equal(1);
            expect(result.stderr).to.include(
                "Forge tier selected by --forge-test-pattern"
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("fails a dry run when a Forge pattern is combined with --no-forge", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "disabled-forge-tier-")
        );
        try {
            fs.mkdirSync(path.join(root, "test"));
            fs.writeFileSync(
                path.join(root, "test", "Mocha.test.ts"),
                'it("runs", function () {});'
            );
            const result = runParallelDryEntry(
                [
                    "--distributed",
                    "--dry-run",
                    "--no-forge",
                    "--forge-test-pattern",
                    "V1/**/*.sol"
                ],
                root
            );
            expect(result.status).to.equal(1);
            expect(result.stderr).to.include(
                "conflicts with the selected tiers"
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("accepts a repository with only default Mocha tests", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "mocha-only-"));
        try {
            fs.mkdirSync(path.join(root, "test"));
            fs.writeFileSync(
                path.join(root, "test", "Plain.ts"),
                'it("runs", function () {});'
            );
            for (const args of [
                ["--dry-run"],
                ["--distributed", "--dry-run"]
            ]) {
                const result = runParallelDryEntry(args, root);
                expect(result.status, result.stderr).to.equal(0);
                expect(result.stdout).to.include("1 task(s)");
                expect(result.stdout).to.match(/0 forge|forge tasks\s+: 0/);
            }
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("accepts a repository with only default Forge tests", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-only-"));
        try {
            fs.mkdirSync(path.join(root, "test"));
            fs.writeFileSync(
                path.join(root, "test", "Sample.t.sol"),
                TEST_CONTRACT_SOURCE
            );
            for (const args of [
                ["--dry-run"],
                ["--distributed", "--dry-run"]
            ]) {
                const result = runParallelDryEntry(args, root);
                expect(result.status, result.stderr).to.equal(0);
                expect(result.stdout).to.match(/1 forge|forge tasks\s+: 1/);
            }
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("reports an uncompilable --grep as an invalid RegExp", function () {
        expect(
            discoveryFailureMessage("Forge", "(", new SyntaxError("bad group"))
        ).to.match(/Invalid --grep RegExp/);
    });

    it("reports a forge discovery throw as a forge failure even when --grep is set", function () {
        const message = discoveryFailureMessage(
            "Forge",
            "^UtilityFacetTest$",
            new Error("forge thread count must be a positive integer, got 0")
        );
        expect(message).to.equal(
            "Forge test discovery failed: forge thread count must be a positive integer, got 0"
        );
    });

    it("reports a Mocha discovery throw as a Mocha failure", function () {
        expect(
            discoveryFailureMessage(
                "Mocha",
                undefined,
                new Error("EACCES: permission denied")
            )
        ).to.equal("Mocha test discovery failed: EACCES: permission denied");
    });
});

describe("parallel forge attempt reduction", function () {
    it("reduces forge output to valid attempt metadata", function () {
        const stdout = [
            "Compiling 3 files with Solc 0.8.34",
            "Ran 4 tests for test/V1/StateChannelDiamondProxy/UtilityFacet.t.sol:UtilityFacetTest",
            "[PASS] testFuzz_subtractAddressArrays_selfIsEmpty(address[]) (runs: 1000, mu: 12345, ~: 12000)",
            "Suite result: ok. 4 passed; 0 failed; 0 skipped; finished in 1.20s"
        ].join("\n");
        const reduced = reduceAttemptOutput(stdout, "");
        expect(() => validateReducedAttempt(reduced)).to.not.throw();
        expect(reduced).to.deep.include({ oomCount: 0, starveCount: 0 });
    });

    it("reduces failing forge output to valid attempt metadata", function () {
        const stderr =
            "Error: test failed\n[FAIL: assertion failed] test_first() (gas: 12345)";
        const reduced = reduceAttemptOutput("", stderr);
        expect(() => validateReducedAttempt(reduced)).to.not.throw();
    });
});

describe("parallel slot provisioning", function () {
    it("provisions no slot for a run made only of forge tasks", function () {
        const tasks = [
            { runner: TASK_RUNNERS.FORGE },
            { runner: TASK_RUNNERS.FORGE }
        ];
        expect(resolveSlotCount(tasks, 1, 40)).to.equal(0);
    });

    it("provisions slots for a run that still holds a hardhat task", function () {
        const tasks = [
            { runner: TASK_RUNNERS.FORGE },
            { runner: TASK_RUNNERS.HARDHAT }
        ];
        expect(resolveSlotCount(tasks, 1, 40)).to.equal(1);
    });

    it("treats a task without a runner as needing a slot", function () {
        expect(resolveSlotCount([{}], 1, 40)).to.equal(1);
    });

    it("clamps the requested slot count to the account pool maximum", function () {
        const tasks = [{ runner: TASK_RUNNERS.HARDHAT }];
        expect(resolveSlotCount(tasks, 99, 40)).to.equal(40);
    });
});

// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import { expect } from "chai";
import { execFileSync } from "child_process";
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
        ) => { files: string[]; tasks: ParallelTask[] };
    };
const { DEFAULT_FORGE_THREADS } =
    require("../../scripts/e2e-parallel/shared/constants.js") as {
        DEFAULT_FORGE_THREADS: number;
    };
const { discoverTasks } =
    require("../../scripts/e2e-parallel/shared/taskDiscovery.js") as {
        discoverTasks: (
            testDir: string,
            grep?: string,
            e2eDir?: string,
            testPattern?: string
        ) => { files: string[]; tasks: ParallelTask[] };
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
                runner: string;
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
        };
        resolveDiscoverySelection: (options: {
            forge?: boolean;
            forgeOnly?: boolean;
            e2eOnly?: boolean;
        }) => { includeMocha: boolean; includeForge: boolean };
    };
const { discoveryFailureMessage, emptyForgeTierMessage, resolveSlotCount } =
    require("../../scripts/test-e2e-parallel.js") as {
        discoveryFailureMessage: (
            tier: string,
            grep: string | undefined,
            error: Error
        ) => string;
        emptyForgeTierMessage: (
            forgeTaskCount: number,
            grep?: string
        ) => string | null;
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
const FORGE_CACHE_FILE = path.join(
    REPO_ROOT,
    "cache_forge",
    "solidity-files-cache.json"
);

// `forge test --list` builds whenever artifacts are stale, so the parity check
// only runs where the build is already warm — a distributed worker (its prepare
// script runs `forge build`) or a local run that warmed the forge tier.
function forgeArtifactsAreWarm() {
    return (
        fs.existsSync(FORGE_CACHE_FILE) &&
        fs.existsSync(path.join(REPO_ROOT, "out"))
    );
}

/**
 * The forge tasks are Hardhat CLI arguments, so discovery and the Hardhat task
 * have to agree on the task and parameter names across the JS/TS boundary.
 */
function forgeTaskSource() {
    return fs.readFileSync(
        path.join(REPO_ROOT, "tasks", "forgeTest.ts"),
        "utf8"
    );
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

describe("parallel forge task discovery", function () {
    it("discovers one task per Foundry test contract in the repository test tree", function () {
        const { tasks } = discoverForgeTasks(REPO_TEST_DIR);
        expect(tasks.map((task) => task.fullTitle)).to.have.members([
            "DisputeVerificationFacetTest",
            "DisputeUtilsTest",
            "FraudProofFacetTest",
            "JoinChannelFacetTest",
            "StateChannelManagerProxyDepositTest",
            "StateChannelManagerProxyOpenTest",
            "UtilityFacetTest"
        ]);
        expect(tasks).to.have.lengthOf(7);
    });

    it("includes a test contract declared in a .test.sol file", function () {
        const { tasks } = discoverForgeTasks(REPO_TEST_DIR);
        const task = tasks.find(
            (candidate) =>
                candidate.fullTitle === "StateChannelManagerProxyOpenTest"
        );
        expect(task?.label).to.equal(
            "forge:StateChannelManagerProxyOpen.test.sol:StateChannelManagerProxyOpenTest"
        );
        expect(task?.logName).to.equal(
            "StateChannelManagerProxyOpen.test__StateChannelManagerProxyOpenTest"
        );
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
        if (!forgeArtifactsAreWarm()) this.skip();
        let listed: string[] = [];
        try {
            listed = forgeListedContracts();
        } catch {
            // No usable forge binary here; the forge tier cannot run anyway.
            this.skip();
        }
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
            "StateChannelManagerProxyOpenTest"
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

    it("uses the hardhat task name that tasks/forgeTest.ts registers", function () {
        expect(forgeTaskSource()).to.match(
            new RegExp(`task\\(\\s*"${FORGE_TEST_TASK}"`)
        );
    });

    it("declares the forge-test parameters the discovered arguments pass", function () {
        const source = forgeTaskSource();
        expect(source).to.match(/addParam\(\s*"matchContract"/);
        expect(source).to.match(/addOptionalParam\(\s*"threads"/);
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

describe("parallel task runner classification", function () {
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
            path.join(testDir, "logic.test.ts"),
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
                    runner: undefined as unknown as string,
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
});

describe("parallel forge tier guards", function () {
    it("fails a requested forge tier that discovered no test contract", function () {
        const message = emptyForgeTierMessage(0);
        expect(message).to.match(/No Foundry test contracts found/);
        expect(message).to.match(/forgeTaskDiscovery\.js/);
    });

    it("accepts an empty forge tier when --grep narrows the selection", function () {
        expect(emptyForgeTierMessage(0, "^NothingMatchesThis$")).to.equal(null);
    });

    it("accepts a forge tier that discovered test contracts", function () {
        expect(emptyForgeTierMessage(7)).to.equal(null);
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

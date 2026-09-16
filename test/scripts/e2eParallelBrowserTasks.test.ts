// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import { expect } from "chai";
import fs from "fs";
import path from "path";

type ParallelTask = {
    label: string;
    logName: string;
    args: string[];
    fullTitle: string;
    runner: string;
    isE2E: boolean;
};

const { BROWSER_TEST_TASK, discoverBrowserTasks } =
    require("../../scripts/e2e-parallel/shared/browserTaskDiscovery.js") as {
        BROWSER_TEST_TASK: string;
        discoverBrowserTasks: (
            testDir: string,
            grep?: string,
            options?: { testPattern?: string }
        ) => {
            files: string[];
            tasks: ParallelTask[];
            preGrepTaskCount: number;
        };
    };
const { BROWSER_BUILD_COMMAND, DEFAULT_BROWSER_TEST_PATTERN } =
    require("../../scripts/e2e-parallel/shared/browserConfig.js") as {
        BROWSER_BUILD_COMMAND: string[];
        DEFAULT_BROWSER_TEST_PATTERN: string;
    };
const { runBrowserGate } =
    require("../../scripts/e2e-parallel/shared/browserRunner.js") as {
        runBrowserGate: (
            scriptPath: string,
            cwd: string,
            options: {
                env?: NodeJS.ProcessEnv;
                stdio?: "ignore";
                stderr?: { write: (message: string) => void };
            }
        ) => Promise<number>;
    };
const { browserChromiumFailure } =
    require("../../scripts/e2e-parallel/shared/taskRunners.js") as {
        browserChromiumFailure: () => Error | null;
    };
const { TASK_RUNNERS, countTasksForRunner, requiresChainSlot } =
    require("../../scripts/e2e-parallel/shared/taskRunners.js") as {
        TASK_RUNNERS: { HARDHAT: string; FORGE: string; BROWSER: string };
        countTasksForRunner: (
            tasks: { runner?: string }[],
            runner?: string
        ) => number;
        requiresChainSlot: (task: { runner?: string }) => boolean;
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
        ) => {
            label: string;
            logName: string;
            runner: string;
            args: (string | { projectPath: string })[];
        };
        fromWireTask: (
            task: {
                label: string;
                logName: string;
                runner?: string;
                args: (string | { projectPath: string })[];
            },
            projectRoot: string
        ) => { runner: string; args: string[] };
    };
const { parseCliArgs, resolveDiscoverySelection } =
    require("../../scripts/e2e-parallel/shared/argParser.js") as {
        parseCliArgs: (argv: string[]) => {
            browser: boolean;
            browserOnly: boolean;
            browserTestPattern?: string;
            testPattern?: string;
            executionProfile?: { slots?: number };
        };
        resolveDiscoverySelection: (options: {
            forge?: boolean;
            forgeOnly?: boolean;
            browser?: boolean;
            browserOnly?: boolean;
            e2eOnly?: boolean;
        }) => {
            includeMocha: boolean;
            includeForge: boolean;
            includeBrowser: boolean;
        };
    };
const { runScheduler } =
    require("../../scripts/e2e-parallel/local/scheduler.js") as {
        runScheduler: (options: Record<string, unknown>) => Promise<{
            completed: number;
            failed: unknown[];
        }>;
    };
const { ENVIRONMENT_BROWSER_ENV, buildWorkerForkEnvironment } =
    require("../../scripts/e2e-parallel/distributed/remoteEnvironment.js") as {
        ENVIRONMENT_BROWSER_ENV: string[];
        buildWorkerForkEnvironment: (options: {
            source: NodeJS.ProcessEnv;
            home: string;
            nodePaths: string[];
        }) => NodeJS.ProcessEnv;
    };
const { chromiumLaunchOptions, launchChromium } =
    require("../browser/chromiumLaunch.js") as {
        chromiumLaunchOptions: (env: NodeJS.ProcessEnv) => {
            headless: boolean;
            chromiumSandbox?: boolean;
            args?: string[];
        };
        launchChromium: (
            chromium: {
                launch: (options: Record<string, unknown>) => Promise<string>;
            },
            env?: NodeJS.ProcessEnv
        ) => Promise<string>;
    };
const { validateDiscoveryResults, resolveSlotCount } =
    require("../../scripts/test-e2e-parallel.js") as {
        validateDiscoveryResults: (
            cli: Record<string, unknown>,
            selection: {
                includeMocha: boolean;
                includeForge: boolean;
                includeBrowser: boolean;
            },
            mocha: { tasks: unknown[]; preGrepTaskCount: number },
            forge: { tasks: unknown[]; preGrepTaskCount: number },
            browser?: { tasks: unknown[]; preGrepTaskCount: number }
        ) => string | null;
        resolveSlotCount: (
            tasks: { runner?: string }[],
            requestedSlotCount: number,
            maxSlots: number
        ) => number;
    };

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const REPO_TEST_DIR = path.resolve(__dirname, "..");
const RUNNER_IMAGE = path.join(
    REPO_ROOT,
    "scripts",
    "e2e-parallel",
    "distributed",
    "runner-image.Dockerfile"
);
const argv = (...args: string[]) => ["node", "runner", ...args];
const EMPTY_TIER = { tasks: [], preGrepTaskCount: 0 };

const BROWSER_TASK = {
    label: "browser:run-worker-contract-executor.mjs",
    logName: "run-worker-contract-executor",
    runner: "browser",
    args: [
        "browser-test",
        "--script",
        path.join(REPO_TEST_DIR, "browser", "run-worker-contract-executor.mjs")
    ]
};
const MOCHA_TASK = {
    label: "test:logic.test.ts:runs",
    logName: "logic__runs",
    runner: "hardhat",
    args: ["test", "--no-compile"]
};
const FORGE_TASK = {
    label: "forge:Sample.t.sol:SampleTest",
    logName: "Sample.t__SampleTest",
    runner: "forge",
    args: ["forge-test", "--match-contract", "^SampleTest$", "--threads", "1"]
};

// A resource gate that admits every task: this file schedules stub work, so
// host load must not decide what runs.
const STUB_RESOURCE_GATE = {
    cpuUtil: 0,
    occupiedGb: 0,
    allows: async () => true,
    stats: () => ({
        peakCpu: 0,
        avgCpu: 0,
        cpuSampleCount: 1,
        peakOccupiedGb: 0,
        avgPerTestGb: 0,
        memorySampleCount: 1,
        memBoundGb: 10
    })
};

// Throwaway trees this file created, removed when it is done with them.
const scratchRoots: string[] = [];
const scratchLogDirs: string[] = [];

function scratchRoot(prefix: string) {
    fs.mkdirSync(path.join(REPO_ROOT, "temp"), { recursive: true });
    const root = fs.mkdtempSync(path.join(REPO_ROOT, "temp", prefix));
    scratchRoots.push(root);
    return root;
}

after(function () {
    for (const root of [
        ...scratchRoots.splice(0),
        ...scratchLogDirs.splice(0)
    ]) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

/** A throwaway gate tree: `<root>/browser/<name>.mjs` for each given name. */
function writeGateTree(gateNames: string[], extraFiles: string[] = []) {
    const root = scratchRoot("browser-gates-");
    const browserDir = path.join(root, "browser");
    fs.mkdirSync(browserDir, { recursive: true });
    for (const name of [...gateNames, ...extraFiles]) {
        fs.writeFileSync(path.join(browserDir, name), "export default 1;\n");
    }
    return root;
}

/** A gate that exits the way the test asks for. */
function writeGate(body: string) {
    const root = scratchRoot("browser-gate-");
    const gate = path.join(root, "run-gate.mjs");
    fs.writeFileSync(gate, `${body}\n`);
    return { root, gate };
}

function dockerfileArg(name: string) {
    const source = fs.readFileSync(RUNNER_IMAGE, "utf8");
    return source.match(new RegExp(`^ARG ${name}=(.+)$`, "m"))?.[1];
}

/** The version yarn.lock resolves for a package, across its entry's key list. */
function lockfileVersion(packageName: string) {
    const lockfile = fs.readFileSync(path.join(REPO_ROOT, "yarn.lock"), "utf8");
    return lockfile.match(
        new RegExp(`^"?${packageName}@[^\\n]*:\\n  version "([^"]+)"`, "m")
    )?.[1];
}

describe("parallel browser task discovery", function () {
    it("discovers one task per browser gate in the repository test tree", function () {
        const { tasks } = discoverBrowserTasks(REPO_TEST_DIR);
        expect(tasks.map((task) => task.fullTitle)).to.deep.equal([
            "run-p2p-webrtc-e2e",
            "run-worker-contract-executor"
        ]);
    });

    it("keeps the browser gates out of the Mocha and forge file boundaries", function () {
        const { files } = discoverBrowserTasks(REPO_TEST_DIR);
        expect(files).to.have.length.greaterThan(0);
        expect(files.every((file) => path.extname(file) === ".mjs")).to.equal(
            true
        );
    });

    it("skips a helper module that is not a gate entry point", function () {
        const root = writeGateTree(
            ["run-first.mjs"],
            ["helperModule.mjs", "run-helper.js"]
        );
        const { tasks } = discoverBrowserTasks(root);
        expect(tasks.map((task) => task.fullTitle)).to.deep.equal([
            "run-first"
        ]);
    });

    it("names each task after its gate file", function () {
        const root = writeGateTree(["run-alpha.mjs", "run-beta.mjs"]);
        const { tasks } = discoverBrowserTasks(root);
        expect(tasks.map((task) => task.label)).to.deep.equal([
            "browser:run-alpha.mjs",
            "browser:run-beta.mjs"
        ]);
        expect(tasks.map((task) => task.logName)).to.deep.equal([
            "run-alpha",
            "run-beta"
        ]);
    });

    it("invokes the browser tier through the hardhat browser-test task", function () {
        const root = writeGateTree(["run-alpha.mjs"]);
        const [task] = discoverBrowserTasks(root).tasks;
        expect(task.args).to.deep.equal([
            BROWSER_TEST_TASK,
            "--script",
            path.join(root, "browser", "run-alpha.mjs")
        ]);
    });

    it("passes the gate path absolute so the wire can rebase it on a worker", function () {
        const root = writeGateTree(["run-alpha.mjs"]);
        const [task] = discoverBrowserTasks(root).tasks;
        expect(path.isAbsolute(task.args[2])).to.equal(true);
    });

    it("marks discovered gates as browser tasks that are not E2E Mocha tests", function () {
        const root = writeGateTree(["run-alpha.mjs"]);
        const [task] = discoverBrowserTasks(root).tasks;
        expect(task.runner).to.equal(TASK_RUNNERS.BROWSER);
        expect(task.isE2E).to.equal(false);
    });

    it("applies --grep to the gate title", function () {
        const root = writeGateTree(["run-alpha.mjs", "run-beta.mjs"]);
        const { tasks, preGrepTaskCount } = discoverBrowserTasks(root, "beta");
        expect(preGrepTaskCount).to.equal(2);
        expect(tasks.map((task) => task.fullTitle)).to.deep.equal(["run-beta"]);
    });

    it("fails discovery when two gates share a file name", function () {
        const root = scratchRoot("browser-gates-");
        for (const dir of ["browser", path.join("browser", "nested")]) {
            fs.mkdirSync(path.join(root, dir), { recursive: true });
            fs.writeFileSync(
                path.join(root, dir, "run-same.mjs"),
                "export default 1;\n"
            );
        }
        expect(() =>
            discoverBrowserTasks(root, undefined, {
                testPattern: "browser/**/run-*.mjs"
            })
        ).to.throw("Duplicate browser gate name(s): run-same.mjs");
    });

    it("explains that duplicate gate names would overwrite one another's log", function () {
        const root = scratchRoot("browser-gates-");
        for (const dir of ["browser", path.join("browser", "nested")]) {
            fs.mkdirSync(path.join(root, dir), { recursive: true });
            fs.writeFileSync(
                path.join(root, dir, "run-same.mjs"),
                "export default 1;\n"
            );
        }
        expect(() =>
            discoverBrowserTasks(root, undefined, {
                testPattern: "browser/**/run-*.mjs"
            })
        ).to.throw("one would overwrite the other");
    });

    it("reports an empty tier rather than throwing when no gate matches", function () {
        const root = writeGateTree(["run-alpha.mjs"]);
        const { tasks, preGrepTaskCount } = discoverBrowserTasks(root, "gamma");
        expect(tasks).to.deep.equal([]);
        expect(preGrepTaskCount).to.equal(1);
    });

    it("keeps a shared filename pattern inside the tier's file boundary", function () {
        const { tasks } = discoverBrowserTasks(REPO_TEST_DIR, undefined, {
            testPattern: "scripts/e2eParallelLogDir.test.ts"
        });
        expect(tasks).to.deep.equal([]);
    });

    it("accepts a tier-specific pattern that selects one gate", function () {
        const root = writeGateTree(["run-alpha.mjs", "run-beta.mjs"]);
        const { tasks } = discoverBrowserTasks(root, undefined, {
            testPattern: "browser/run-beta.mjs"
        });
        expect(tasks.map((task) => task.fullTitle)).to.deep.equal(["run-beta"]);
    });

    it("roots the default gate pattern at the test directory", function () {
        expect(DEFAULT_BROWSER_TEST_PATTERN).to.equal("browser/run-*.mjs");
    });
});

describe("browser gate runner", function () {
    it("runs the gate as a Node entry point and reports success", async function () {
        const { root, gate } = writeGate(
            "import fs from 'node:fs';fs.writeFileSync(process.env.GATE_MARKER,'ran');"
        );
        const marker = path.join(root, "marker.txt");
        const status = await runBrowserGate(gate, REPO_ROOT, {
            env: { ...process.env, GATE_MARKER: marker },
            stdio: "ignore"
        });
        expect(status).to.equal(0);
        expect(fs.readFileSync(marker, "utf8")).to.equal("ran");
    });

    it("runs the gate from the project root", async function () {
        const { root, gate } = writeGate(
            "import fs from 'node:fs';fs.writeFileSync(process.env.GATE_MARKER,process.cwd());"
        );
        const marker = path.join(root, "cwd.txt");
        await runBrowserGate(gate, REPO_ROOT, {
            env: { ...process.env, GATE_MARKER: marker },
            stdio: "ignore"
        });
        expect(fs.realpathSync(fs.readFileSync(marker, "utf8"))).to.equal(
            fs.realpathSync(REPO_ROOT)
        );
    });

    it("passes a nonzero gate exit through as a runner failure", async function () {
        const { gate } = writeGate("process.exit(3);");
        const status = await runBrowserGate(gate, REPO_ROOT, {
            stdio: "ignore"
        });
        expect(status).to.equal(3);
    });

    it("turns a gate signal exit into a runner failure", async function () {
        const { gate } = writeGate("process.kill(process.pid,'SIGKILL');");
        const status = await runBrowserGate(gate, REPO_ROOT, {
            stdio: "ignore"
        });
        expect(status).to.equal(1);
    });

    it("fails when the gate file does not exist", async function () {
        const status = await runBrowserGate(
            path.join(REPO_ROOT, "temp", "no-such-gate.mjs"),
            REPO_ROOT,
            { stdio: "ignore" }
        );
        expect(status).to.not.equal(0);
    });
});

describe("browser tier scheduling", function () {
    it("keeps browser gates off the hardhat slot and account pools", function () {
        expect(requiresChainSlot(BROWSER_TASK)).to.equal(false);
        expect(requiresChainSlot(MOCHA_TASK)).to.equal(true);
    });

    it("provisions no warm slot for a run made only of browser gates", function () {
        expect(resolveSlotCount([BROWSER_TASK], 4, 40)).to.equal(0);
    });

    it("still provisions slots when a browser gate runs beside a Mocha test", function () {
        expect(resolveSlotCount([BROWSER_TASK, MOCHA_TASK], 4, 40)).to.equal(4);
    });

    it("counts only the browser tasks in a mixed run", function () {
        expect(
            countTasksForRunner(
                [BROWSER_TASK, MOCHA_TASK, FORGE_TASK],
                TASK_RUNNERS.BROWSER
            )
        ).to.equal(1);
    });
});

describe("browser tier admission", function () {
    it("schedules a browser gate with no slot, no account partition and its own tier label", async function () {
        const logDir = path.join(
            REPO_ROOT,
            "logs",
            `browser-tier-test-${process.pid}`
        );
        scratchLogDirs.push(logDir);
        const calls: {
            label: string;
            env: Record<string, string | undefined>;
        }[] = [];
        const lines: string[] = [];
        const log = console.log;
        console.log = (...args: unknown[]) => lines.push(args.join(" "));
        try {
            const result = await runScheduler({
                tasks: [BROWSER_TASK],
                slots: [{ id: 1, nodeUrl: "node-1", discoveryUrl: "d-1" }],
                slotCount: 1,
                concurrencyCap: 1,
                targetLoad: 1,
                memBoundGb: 10,
                baseEnv: { BASE_ONLY: "yes" },
                logDir,
                infraPids: () => [],
                tickMs: 1,
                resourceGate: STUB_RESOURCE_GATE,
                runTaskImpl: async (
                    _cmd: string,
                    _args: string[],
                    env: Record<string, string | undefined>,
                    label: string
                ) => {
                    calls.push({ label, env });
                    return {
                        code: 0,
                        label,
                        stdout: "",
                        stderr: "",
                        durationMs: 1
                    };
                }
            });
            expect(result.completed).to.equal(1);
            expect(result.failed).to.deep.equal([]);
        } finally {
            console.log = log;
        }
        expect(calls).to.deep.equal([
            { label: BROWSER_TASK.label, env: { BASE_ONLY: "yes" } }
        ]);
        expect(
            lines.some(
                (line) => line.includes("[1/1]") && line.includes("browser")
            )
        ).to.equal(true);
    });
});

describe("browser task wire protocol", function () {
    it("carries the browser runner across the wire round trip", function () {
        const wire = toWireTask(BROWSER_TASK, REPO_ROOT);
        expect(wire.runner).to.equal(TASK_RUNNERS.BROWSER);
        expect(fromWireTask(wire, REPO_ROOT).runner).to.equal(
            TASK_RUNNERS.BROWSER
        );
    });

    it("rebases the gate path onto the worker's extracted project", function () {
        const wire = toWireTask(BROWSER_TASK, REPO_ROOT);
        expect(wire.args[2]).to.deep.equal({
            projectPath: "test/browser/run-worker-contract-executor.mjs"
        });
        const extracted = path.join(REPO_ROOT, "temp", "extracted-project");
        expect(fromWireTask(wire, extracted).args[2]).to.equal(
            path.join(
                extracted,
                "test",
                "browser",
                "run-worker-contract-executor.mjs"
            )
        );
    });
});

describe("browser tier selection", function () {
    it("discovers the Mocha, forge and browser tiers by default", function () {
        expect(resolveDiscoverySelection(parseCliArgs(argv()))).to.deep.equal({
            includeMocha: true,
            includeForge: true,
            includeBrowser: true
        });
    });

    it("drops every other tier for --browser-only", function () {
        expect(
            resolveDiscoverySelection(parseCliArgs(argv("--browser-only")))
        ).to.deep.equal({
            includeMocha: false,
            includeForge: false,
            includeBrowser: true
        });
    });

    it("drops the browser tier for --no-browser", function () {
        expect(
            resolveDiscoverySelection(parseCliArgs(argv("--no-browser")))
                .includeBrowser
        ).to.equal(false);
    });

    it("drops the browser tier for --e2e-only", function () {
        expect(
            resolveDiscoverySelection(parseCliArgs(argv("--e2e-only")))
                .includeBrowser
        ).to.equal(false);
    });

    it("drops the browser tier for --forge-only", function () {
        expect(
            resolveDiscoverySelection(parseCliArgs(argv("--forge-only")))
                .includeBrowser
        ).to.equal(false);
    });

    it("rejects --browser-only together with --no-browser", function () {
        expect(() =>
            parseCliArgs(argv("--browser-only", "--no-browser"))
        ).to.throw("--browser-only conflicts with --no-browser");
    });

    it("rejects --browser-only together with --e2e-only", function () {
        expect(() =>
            parseCliArgs(argv("--browser-only", "--e2e-only"))
        ).to.throw("--browser-only conflicts with --e2e-only");
    });

    it("rejects --browser-only together with --forge-only", function () {
        expect(() =>
            parseCliArgs(argv("--browser-only", "--forge-only"))
        ).to.throw("--browser-only conflicts with --forge-only");
    });

    it("parses a browser gate pattern independent of the shared one", function () {
        const cli = parseCliArgs(
            argv(
                "--test-pattern",
                "**/*.test.ts",
                "--browser-test-pattern",
                "browser/run-beta.mjs"
            )
        );
        expect(cli.testPattern).to.equal("**/*.test.ts");
        expect(cli.browserTestPattern).to.equal("browser/run-beta.mjs");
    });

    it("rejects a --browser-test-pattern without a value", function () {
        expect(() => parseCliArgs(argv("--browser-test-pattern"))).to.throw(
            "--browser-test-pattern requires a value"
        );
    });

    it("forces zero distributed slots for a browser-only entry", function () {
        const cli = parseCliArgs(argv("--distributed", "--browser-only"));
        expect(cli.executionProfile?.slots).to.equal(0);
    });

    it("reports a --browser-test-pattern that conflicts with the selected tiers", function () {
        expect(
            validateDiscoveryResults(
                { browserTestPattern: "browser/run-alpha.mjs", browser: false },
                {
                    includeMocha: true,
                    includeForge: true,
                    includeBrowser: false
                },
                { tasks: [MOCHA_TASK], preGrepTaskCount: 1 },
                EMPTY_TIER,
                EMPTY_TIER
            )
        ).to.contain("--browser-test-pattern");
    });

    it("reports a browser pattern that selects no runnable gate", function () {
        expect(
            validateDiscoveryResults(
                {
                    browserTestPattern: "browser/run-missing.mjs",
                    browser: true
                },
                {
                    includeMocha: true,
                    includeForge: true,
                    includeBrowser: true
                },
                { tasks: [MOCHA_TASK], preGrepTaskCount: 1 },
                EMPTY_TIER,
                EMPTY_TIER
            )
        ).to.contain("contains no runnable gates");
    });

    it("accepts a run whose only tasks are browser gates", function () {
        expect(
            validateDiscoveryResults(
                { browser: true, browserOnly: true },
                {
                    includeMocha: false,
                    includeForge: false,
                    includeBrowser: true
                },
                EMPTY_TIER,
                EMPTY_TIER,
                { tasks: [BROWSER_TASK], preGrepTaskCount: 1 }
            )
        ).to.equal(null);
    });
});

describe("browser tier environment", function () {
    it("builds the browser sources through the project's own build script", function () {
        expect(BROWSER_BUILD_COMMAND).to.deep.equal(["yarn", "build:browser"]);
    });

    it("checks the gates' Chromium before a run schedules them", function () {
        // The browser build is a typecheck and says nothing about the browser,
        // so without this the tier fails only after the whole run.
        expect(browserChromiumFailure()).to.equal(null);
    });

    it("keeps the worker prepare script building the browser sources", function () {
        const packageJson = JSON.parse(
            fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")
        ) as { scripts: Record<string, string> };
        expect(
            packageJson.scripts["test:parallel:prepare:cached-contracts"]
        ).to.contain("yarn build:browser");
    });

    it("pins the runner image to the Playwright version yarn.lock resolves", function () {
        expect(dockerfileArg("PLAYWRIGHT_VERSION")).to.equal(
            lockfileVersion("playwright")
        );
    });

    it("installs Chromium into the runner image at a shared browsers path", function () {
        const source = fs.readFileSync(RUNNER_IMAGE, "utf8");
        expect(source).to.contain(
            "ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright"
        );
        expect(source).to.contain(
            "playwright@${PLAYWRIGHT_VERSION} install --with-deps chromium"
        );
    });

    it("carries the image's browser names into the worker a guest forks", function () {
        const forked = buildWorkerForkEnvironment({
            source: {
                PATH: "/usr/bin",
                PLAYWRIGHT_BROWSERS_PATH: "/ms-playwright",
                SCP_BROWSER_CONTAINED: "1",
                SCP_TEST_POOL_SECRET: "must not cross"
            },
            home: "/environment/home",
            nodePaths: ["/environment/runner/node_modules"]
        });
        // A gate runs in a task child of that fork, so without these it would
        // look for Chromium under the fresh HOME and keep its own sandbox.
        expect(forked.PLAYWRIGHT_BROWSERS_PATH).to.equal("/ms-playwright");
        expect(forked.SCP_BROWSER_CONTAINED).to.equal("1");
        expect(forked.HOME).to.equal("/environment/home");
        expect(forked.SCP_TEST_POOL_SECRET).to.equal(undefined);
    });

    it("names both image-declared browser variables in one place", function () {
        expect(ENVIRONMENT_BROWSER_ENV).to.deep.equal([
            "PLAYWRIGHT_BROWSERS_PATH",
            "SCP_BROWSER_CONTAINED"
        ]);
    });

    it("keeps the launch policy loadable by the CommonJS suite and both gates", function () {
        // Node only unflagged require(esm) in 22.12 and CI pins Node 20, so a
        // gate helper this file requires has to stay CommonJS.
        expect(
            fs.existsSync(
                path.join(REPO_TEST_DIR, "browser", "chromiumLaunch.js")
            )
        ).to.equal(true);
        for (const gate of [
            "run-worker-contract-executor.mjs",
            "run-p2p-webrtc-e2e.mjs"
        ]) {
            expect(
                fs.readFileSync(
                    path.join(REPO_TEST_DIR, "browser", gate),
                    "utf8"
                )
            ).to.contain('from "./chromiumLaunch.js"');
        }
    });

    it("names PLAYWRIGHT_BROWSERS_PATH when the gate finds no Chromium", async function () {
        const missing = {
            launch: () =>
                Promise.reject(
                    new Error(
                        "browserType.launch: Executable doesn't exist at /home/.cache/ms-playwright/chromium-1223"
                    )
                )
        };
        // The environment hands its worker a fresh HOME and pnpm never
        // downloads browsers, so this is the failure a worker actually hits.
        const message = await launchChromium(missing, {}).catch(
            (caught: Error) => caught.message
        );
        expect(message).to.contain("PLAYWRIGHT_BROWSERS_PATH");
        expect(message).to.contain("unsafe-host");
    });

    it("passes an unrelated launch failure through untouched", async function () {
        const broken = {
            launch: () => Promise.reject(new Error("Target page crashed"))
        };
        const message = await launchChromium(broken, {}).catch(
            (caught: Error) => caught.message
        );
        expect(message).to.equal("Target page crashed");
    });

    it("launches with the options the environment asks for", async function () {
        const seen: Record<string, unknown>[] = [];
        const chromium = {
            launch: (options: Record<string, unknown>) => {
                seen.push(options);
                return Promise.resolve("browser");
            }
        };
        expect(
            await launchChromium(chromium, { SCP_BROWSER_CONTAINED: "1" })
        ).to.equal("browser");
        expect(seen).to.deep.equal([
            {
                headless: true,
                chromiumSandbox: false,
                args: ["--disable-dev-shm-usage"]
            }
        ]);
    });

    it("tells the gates that the runner image's container confines Chromium", function () {
        expect(fs.readFileSync(RUNNER_IMAGE, "utf8")).to.contain(
            "ENV SCP_BROWSER_CONTAINED=1"
        );
    });

    it("keeps Chromium's own sandbox outside that container", function () {
        expect(chromiumLaunchOptions({})).to.deep.equal({ headless: true });
    });

    it("drops Chromium's sandbox and /dev/shm use inside that container", function () {
        expect(
            chromiumLaunchOptions({ SCP_BROWSER_CONTAINED: "1" })
        ).to.deep.equal({
            headless: true,
            chromiumSandbox: false,
            args: ["--disable-dev-shm-usage"]
        });
    });
});

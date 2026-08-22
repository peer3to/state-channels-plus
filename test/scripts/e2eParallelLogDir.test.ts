// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import { expect } from "chai";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

// CommonJS dev scripts for the parallel e2e runner. We test the
// destructive-tooling guards: a mis-resolved / symlinked log dir must never
// wipe the working tree.
type ParsedCliArgs = {
    logDir: string;
    logDirProvided: boolean;
    keepInfraLogs: boolean;
    help: boolean;
    e2eOnly: boolean;
    testPattern?: string;
    schedulerTickMs?: number;
    distributed: boolean;
    discoveryTimeoutMs: number;
    forwardEnv: string[];
    executionProfile: Record<string, number>;
};
const argParser: {
    getHelpText: () => string;
    parseCliArgs: (argv: string[]) => ParsedCliArgs;
} = require("../../scripts/e2e-parallel/shared/argParser.js");
const { getHelpText, parseCliArgs } = argParser;
const {
    colorize,
    cleanupNonErrorLogs,
    countStarvation,
    getStarvationSummary,
    parseTimings,
    isDangerousPurgeTarget,
    isWithinDefaultLogDir,
    safeEmptyDir,
    nextRunDir,
    summary,
    summaryCounts
} = require("../../scripts/e2e-parallel/shared/logging.js") as {
    colorize: (color: string, text: string) => string;
    cleanupNonErrorLogs: (
        dirPath: string,
        allow: boolean,
        keepInfraLogs?: boolean
    ) => void;
    countStarvation: (text: string) => number;
    getStarvationSummary: (tasks: Array<Record<string, unknown>>) => {
        recovered: Array<Record<string, unknown>>;
        repeated: Array<Record<string, unknown>>;
    };
    parseTimings: (text: string) => {
        el: { main: number; sdk: number; vm: number; watchdog: number };
        maxEventLoopDelayMs: number;
    };
    isDangerousPurgeTarget: (resolved: string) => boolean;
    isWithinDefaultLogDir: (resolved: string) => boolean;
    safeEmptyDir: (dirPath: string, allow: boolean) => void;
    nextRunDir: (baseDir: string) => string;
    summary: (options: Record<string, unknown>) => void;
    summaryCounts: (
        total: number,
        failed: number,
        completed?: number
    ) => { passing: number; failing: number; notRun: number };
};
const { accountPartitionFor } =
    require("../../scripts/e2e-parallel/local/scheduler.js") as {
        accountPartitionFor: (
            slot: { id: number } | null,
            accountPartition: number
        ) => number;
    };
const { buildBaseEnv, main } =
    require("../../scripts/test-e2e-parallel.js") as {
        buildBaseEnv: (threadModes: {
            sdkThread: boolean;
            vmThread: boolean;
        }) => NodeJS.ProcessEnv;
        main: (options?: {
            testPattern?: string;
            dryRun?: boolean;
            distributed?: boolean;
        }) => Promise<void>;
    };

const argv = (...args: string[]) => ["node", "runner", ...args];

describe("e2e-parallel argParser - logDir validation", function () {
    it("does not count interrupted tasks as passing", function () {
        expect(summaryCounts(789, 32, 100)).to.deep.equal({
            passing: 68,
            failing: 32,
            notRun: 689
        });
        expect(summaryCounts(789, 32)).to.deep.equal({
            passing: 757,
            failing: 32,
            notRun: 0
        });
    });

    it("exports the runner entry point for package consumers", function () {
        expect(main).to.be.a("function");
    });

    it("supports standard help flags and documents every option", function () {
        expect(parseCliArgs(["node", "script", "--help"]).help).to.equal(true);
        expect(parseCliArgs(["node", "script", "-h"]).help).to.equal(true);

        const help = getHelpText();
        for (const option of [
            "--help",
            "--grep",
            "--test-pattern",
            "--mocha-test-pattern",
            "--forge-test-pattern",
            "--e2e-only",
            "--log-dir",
            "--allow-logdir-purge",
            "--keep-infra-logs",
            "--slots",
            "--workers",
            "--target-load",
            "--interval",
            "--mem-limit-gb",
            "--sdk-thread",
            "--no-sdk-thread",
            "--vm-thread",
            "--no-vm-thread",
            "--dry-run",
            "--distributed",
            "--discovery-timeout",
            "--forward-env",
            "--forge-only",
            "--no-forge",
            "--forge-threads"
        ]) {
            expect(help).to.include(option);
        }
    });

    it("runs the packed tools with production dependencies only", function () {
        const repoRoot = path.resolve(__dirname, "..", "..");
        fs.mkdirSync(path.join(repoRoot, "temp"), { recursive: true });
        const root = fs.mkdtempSync(
            path.join(repoRoot, "temp", "packed-runner-")
        );
        const archive = path.join(root, "state-channels-plus.tgz");
        const consumer = path.join(root, "consumer");
        fs.mkdirSync(consumer);
        fs.writeFileSync(
            path.join(consumer, "package.json"),
            JSON.stringify({
                private: true,
                dependencies: {
                    "@peer3/state-channels-plus": `file:${archive}`
                }
            })
        );

        try {
            const packed = spawnSync("yarn", ["pack", "--filename", archive], {
                cwd: repoRoot,
                encoding: "utf8"
            });
            expect(packed.status, packed.stderr || packed.stdout).to.equal(0);

            const installed = spawnSync(
                "pnpm",
                [
                    "install",
                    "--prod",
                    "--prefer-offline",
                    "--ignore-scripts",
                    "--package-import-method=hardlink"
                ],
                {
                    cwd: consumer,
                    encoding: "utf8"
                }
            );
            expect(
                installed.status,
                `${installed.stdout}\n${installed.stderr}`
            ).to.equal(0);

            const resolveTool = (name: string) => {
                const resolved = spawnSync(
                    process.execPath,
                    [
                        "-e",
                        `process.stdout.write(require.resolve(${JSON.stringify(name)}))`
                    ],
                    { cwd: consumer, encoding: "utf8" }
                );
                expect(
                    resolved.status,
                    resolved.stderr || resolved.stdout
                ).to.equal(0);
                return resolved.stdout;
            };

            const runner = spawnSync(
                process.execPath,
                [
                    resolveTool("@peer3/state-channels-plus/test-parallel"),
                    "--help"
                ],
                { cwd: consumer, encoding: "utf8" }
            );
            expect(runner.status, runner.stderr || runner.stdout).to.equal(0);
            expect(runner.stdout).to.include("Usage:");

            const server = spawnSync(
                process.execPath,
                [
                    resolveTool(
                        "@peer3/state-channels-plus/test-parallel-server"
                    ),
                    "--not-a-real-option"
                ],
                { cwd: consumer, encoding: "utf8" }
            );
            expect(server.status).to.not.equal(0);
            expect(`${server.stdout}\n${server.stderr}`).to.not.include(
                "MODULE_NOT_FOUND"
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("parses distributed options and rejects them in local mode", function () {
        const parsed = parseCliArgs(
            argv(
                "--distributed",
                "--discovery-timeout",
                "2500",
                "--forward-env",
                "CI"
            )
        );
        expect(parsed.distributed).to.equal(true);
        expect(parsed.discoveryTimeoutMs).to.equal(2500);
        expect(parsed.forwardEnv).to.deep.equal(["CI"]);

        const defaults = parseCliArgs(argv());
        expect(defaults.discoveryTimeoutMs).to.equal(30000);
        expect(() => parseCliArgs(argv("--forward-env", "CI"))).to.throw(
            /require --distributed/
        );
    });

    it("turns distributed capacity flags into an execution profile", function () {
        const parsed = parseCliArgs(
            argv(
                "--distributed",
                "--slots",
                "2",
                "--workers",
                "3",
                "--target-load",
                "0.5",
                "--interval",
                "250",
                "--mem-limit-gb",
                "4"
            )
        );
        expect(parsed.executionProfile).to.deep.equal({
            schedulerTickMs: 250,
            workers: 3,
            slots: 2,
            memoryBytes: 4 * 1024 ** 3,
            targetLoad: 0.5
        });
    });

    it("does not resolve local capacity for a distributed dry run", async function () {
        const lines: string[] = [];
        const original = console.log;
        const originalArgv = process.argv;
        console.log = (line: string) => lines.push(line);
        process.argv = ["node", "runner"];
        try {
            await main({
                dryRun: true,
                distributed: true,
                testPattern: "scripts/e2eParallelProtocol.test.ts"
            });
        } finally {
            console.log = original;
            process.argv = originalArgv;
        }
        expect(lines).to.have.length(1);
        expect(lines[0]).to.match(
            /^Distributed dry run: \d+ task\(s\) \(\d+ forge\); slots=worker default; remaining capacity is configured by test:parallel:server$/
        );
    });

    it("accepts a consumer test filename pattern", function () {
        expect(
            parseCliArgs(["node", "script", "--test-pattern", "**/*.spec.ts"])
                .testPattern
        ).to.equal("**/*.spec.ts");
        expect(
            parseCliArgs(["node", "script", "--test-pattern=**/*.ts"])
                .testPattern
        ).to.equal("**/*.ts");
    });

    it("runs all Mocha tests by default and supports --e2e-only", function () {
        expect(parseCliArgs(argv()).e2eOnly).to.equal(false);
        expect(parseCliArgs(argv("--e2e-only")).e2eOnly).to.equal(true);
    });

    it("keeps infrastructure logs only when requested", function () {
        expect(parseCliArgs(argv()).keepInfraLogs).to.equal(false);
        expect(parseCliArgs(argv("--keep-infra-logs")).keepInfraLogs).to.equal(
            true
        );
    });

    it("rejects an empty --logDir= value (falls back to default, not provided)", function () {
        const o = parseCliArgs(argv("--logDir="));
        expect(o.logDirProvided).to.equal(false);
        expect(o.logDir).to.not.equal("");
    });

    it("rejects '--logDir .' (resolves to CWD)", function () {
        const o = parseCliArgs(argv("--logDir", "."));
        expect(o.logDirProvided).to.equal(false);
    });

    it("does not swallow a following flag as the dir name", function () {
        const o = parseCliArgs(argv("--logDir", "--allow-logdir-purge"));
        expect(o.logDirProvided).to.equal(false);
        expect(o.logDir).to.not.equal("--allow-logdir-purge");
    });

    it("accepts a normal relative dir under logs/", function () {
        const o = parseCliArgs(argv("--logDir", "logs/run-x"));
        expect(o.logDirProvided).to.equal(true);
        expect(o.logDir).to.equal("logs/run-x");
    });
});

describe("e2e-parallel argParser - interval", function () {
    it("uses the scheduler default when no interval override is provided", function () {
        expect(parseCliArgs(argv()).schedulerTickMs).to.equal(undefined);
    });

    it("accepts long, short, separated, and equals interval values", function () {
        expect(
            parseCliArgs(argv("--interval", "250")).schedulerTickMs
        ).to.equal(250);
        expect(parseCliArgs(argv("--interval=125")).schedulerTickMs).to.equal(
            125
        );
        expect(parseCliArgs(argv("-i", "75")).schedulerTickMs).to.equal(75);
        expect(parseCliArgs(argv("-i=50")).schedulerTickMs).to.equal(50);
    });

    it("rejects zero and negative interval values", function () {
        expect(parseCliArgs(argv("--interval", "0")).schedulerTickMs).to.equal(
            undefined
        );
        expect(parseCliArgs(argv("-i=-1")).schedulerTickMs).to.equal(undefined);
    });
});

describe("e2e-parallel logging - purge guards", function () {
    it("flags the repo root / CWD as a dangerous purge target", function () {
        expect(isDangerousPurgeTarget(process.cwd())).to.equal(true);
        expect(isDangerousPurgeTarget(path.parse(process.cwd()).root)).to.equal(
            true
        );
    });

    it("safeEmptyDir refuses the repo root even with the allow flag", function () {
        const realRm = fs.rmSync;
        const removed: string[] = [];
        (fs as unknown as { rmSync: typeof fs.rmSync }).rmSync = ((
            p: string
        ) => {
            removed.push(p);
        }) as typeof fs.rmSync;
        try {
            safeEmptyDir(process.cwd(), true);
        } finally {
            (fs as unknown as { rmSync: typeof fs.rmSync }).rmSync = realRm;
        }
        expect(removed).to.have.lengthOf(0);
    });

    it("keeps failed infrastructure diagnostics while removing normal worker logs", function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "log-cleanup-"));
        const successfulRoot = fs.mkdtempSync(
            path.join(os.tmpdir(), "successful-log-cleanup-")
        );
        try {
            const infrastructure = path.join(root, "infra");
            const successfulInfrastructure = path.join(successfulRoot, "infra");
            fs.mkdirSync(path.join(infrastructure, "server-1"), {
                recursive: true
            });
            fs.mkdirSync(successfulInfrastructure, { recursive: true });
            fs.writeFileSync(
                path.join(infrastructure, "server-1", "worker.ansi"),
                "worker failure"
            );
            fs.writeFileSync(
                path.join(infrastructure, "isolated-runtime.ansi"),
                "runtime failure"
            );
            fs.writeFileSync(path.join(infrastructure, ".failure"), "");
            fs.writeFileSync(
                path.join(successfulInfrastructure, "worker.ansi"),
                "normal worker"
            );
            fs.writeFileSync(path.join(root, "passing.ansi"), "passing");
            fs.writeFileSync(path.join(root, "error_failed.ansi"), "failed");

            cleanupNonErrorLogs(root, true);
            cleanupNonErrorLogs(successfulRoot, true);

            expect(fs.existsSync(infrastructure)).to.equal(true);
            expect(fs.existsSync(successfulInfrastructure)).to.equal(false);
            expect(fs.existsSync(path.join(root, "passing.ansi"))).to.equal(
                false
            );
            expect(
                fs.existsSync(path.join(root, "error_failed.ansi"))
            ).to.equal(true);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
            fs.rmSync(successfulRoot, { recursive: true, force: true });
        }
    });

    it("keeps successful infrastructure logs when requested", function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "kept-infra-log-cleanup-")
        );
        try {
            const infrastructure = path.join(root, "infra");
            fs.mkdirSync(infrastructure, { recursive: true });
            fs.writeFileSync(
                path.join(infrastructure, "hardhat-node.ansi"),
                "normal infrastructure"
            );
            fs.writeFileSync(path.join(root, "passing.ansi"), "passing");
            fs.writeFileSync(path.join(root, "error_failed.ansi"), "failed");

            cleanupNonErrorLogs(root, true, true);

            expect(fs.existsSync(infrastructure)).to.equal(true);
            expect(fs.existsSync(path.join(root, "passing.ansi"))).to.equal(
                false
            );
            expect(
                fs.existsSync(path.join(root, "error_failed.ansi"))
            ).to.equal(true);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("a symlinked dir whose real target is a dangerous root is flagged, not treated as safe", function () {
        // temp/  <- a real dir we treat as the "root" to protect
        // temp/link -> temp   (a symlink whose real target is temp)
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "logdir-guard-"));
        const link = path.join(tmp, "link");
        try {
            fs.symlinkSync(tmp, link, "dir");
            const realTmp = fs.realpathSync(tmp);
            // The lexical path (tmp/link) isn't tmp, but its real target IS.
            // A guard that only looked at the lexical path would miss it; the
            // real-path-aware guard must catch it. We assert via the shared
            // helper that the symlink resolves to the protected real dir.
            expect(fs.realpathSync(link)).to.equal(realTmp);
            // isWithinDefaultLogDir must not consider a path that really points
            // outside the default logs tree as "safe".
            expect(isWithinDefaultLogDir(link)).to.equal(false);
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    it("nextRunDir refuses a './logs -> repo root' symlink (no run-* scattered at the root)", function () {
        // Reproduce the original escape shape: cwd is a "repo" whose ./logs is a
        // symlink to the repo root itself. Run allocation must refuse before any
        // mkdir, so run-N dirs are never created at the repo root.
        const repo = fs.mkdtempSync(path.join(os.tmpdir(), "fake-repo-"));
        const prevCwd = process.cwd();
        try {
            fs.symlinkSync(repo, path.join(repo, "logs"), "dir");
            process.chdir(repo);
            expect(() => nextRunDir("logs")).to.throw(/repo root|fs root/);
            const entries = fs.readdirSync(repo);
            expect(entries.some((e) => /^run-\d+$/.test(e))).to.equal(false);
        } finally {
            process.chdir(prevCwd);
            fs.rmSync(repo, { recursive: true, force: true });
        }
    });
});

describe("e2e-parallel logging - starvation diagnostics", function () {
    it("includes every failed task label in the shared final summary", function () {
        const lines: string[] = [];
        const original = console.log;
        console.log = (line = "") => lines.push(line);
        try {
            summary({
                tasks: [{ label: "passes" }, { label: "fails" }],
                failed: [{ label: "fails" }],
                wallMs: 1000,
                sumDurationMs: 1000,
                peakCpu: 0,
                avgCpu: 0,
                peakOccupiedGb: 0,
                avgPerTestGb: 0,
                memBoundGb: 1
            });
        } finally {
            console.log = original;
        }
        expect(lines.join("\n")).to.include("Failed tasks:");
        expect(lines.join("\n")).to.include("- fails");
    });

    it("uses account partitions only when tests share an infrastructure slot", function () {
        expect(accountPartitionFor({ id: 1 }, 23)).to.equal(23);
        expect(accountPartitionFor(null, 23)).to.equal(0);
    });

    it("uses light yellow for rescheduling and dark yellow for repeated starvation", function () {
        expect(colorize("lightYellow", "retry")).to.equal(
            "\u001b[93mretry\u001b[0m"
        );
        expect(colorize("darkYellow", "fail")).to.equal(
            "\u001b[33mfail\u001b[0m"
        );
        expect(colorize("lightGreen", "recovered")).to.equal(
            "\u001b[92mrecovered\u001b[0m"
        );
    });

    it("reports only successful retries as recovered and repeated starvation as yellow", function () {
        const recovered = { starvationRetrySucceeded: true };
        const repeated = { repeatedStarvation: true };
        const ordinary = { starveCount: 0 };

        expect(
            getStarvationSummary([recovered, repeated, ordinary])
        ).to.deep.equal({ recovered: [recovered], repeated: [repeated] });
    });

    it("deduplicates propagated watchdog errors and includes their real peak", function () {
        const repeatedError =
            "Event loop delay 1025.507327ms exceeded configured threshold 1000ms";
        const output = [
            '##E2E_TIMING## {"maxEventLoopDelayMs":649,"elThread":"vm"}',
            ...Array.from({ length: 7 }, () => repeatedError)
        ].join("\n");

        expect(countStarvation(output)).to.equal(1);
        const timing = parseTimings(output);
        expect(timing.el.vm).to.equal(649);
        expect(timing.el.watchdog).to.equal(1026);
        expect(timing.maxEventLoopDelayMs).to.equal(1026);
    });

    it("counts genuinely different watchdog delays separately", function () {
        const output = [
            "Event loop delay 1025.5ms exceeded configured threshold 1000ms",
            "Event loop delay 1100.25ms exceeded configured threshold 1000ms"
        ].join("\n");

        expect(countStarvation(output)).to.equal(2);
        expect(parseTimings(output).maxEventLoopDelayMs).to.equal(1100);
    });
});

describe("e2e-parallel child environment", function () {
    it("disables remote crash-log uploads because each child has a local run log", function () {
        const env = buildBaseEnv({ sdkThread: true, vmThread: true });

        expect(env.CRASH_LOG_UPLOAD_ENDPOINT).to.equal("");
    });
});

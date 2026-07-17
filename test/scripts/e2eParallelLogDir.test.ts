import { expect } from "chai";
import fs from "fs";
import os from "os";
import path from "path";

// CommonJS dev scripts for the parallel e2e runner. We test the
// destructive-tooling guards: a mis-resolved / symlinked log dir must never
// wipe the working tree.
const { getHelpText, parseCliArgs } =
    require("../../scripts/e2e-parallel/argParser.js") as {
        getHelpText: () => string;
        parseCliArgs: (argv: string[]) => {
            logDir: string;
            logDirProvided: boolean;
            help: boolean;
            e2eOnly: boolean;
            schedulerTickMs?: number;
        };
    };
const {
    countStarvation,
    parseTimings,
    isDangerousPurgeTarget,
    isWithinDefaultLogDir,
    safeEmptyDir,
    nextRunDir
} = require("../../scripts/e2e-parallel/logging.js") as {
    countStarvation: (text: string) => number;
    parseTimings: (text: string) => {
        el: { main: number; sdk: number; vm: number; watchdog: number };
        maxEventLoopDelayMs: number;
    };
    isDangerousPurgeTarget: (resolved: string) => boolean;
    isWithinDefaultLogDir: (resolved: string) => boolean;
    safeEmptyDir: (dirPath: string, allow: boolean) => void;
    nextRunDir: (baseDir: string) => string;
};

const argv = (...args: string[]) => ["node", "runner", ...args];

describe("e2e-parallel argParser - logDir validation", function () {
    it("supports standard help flags and documents every option", function () {
        expect(parseCliArgs(["node", "script", "--help"]).help).to.equal(true);
        expect(parseCliArgs(["node", "script", "-h"]).help).to.equal(true);

        const help = getHelpText();
        for (const option of [
            "--help",
            "--grep",
            "--e2e-only",
            "--log-dir",
            "--allow-logdir-purge",
            "--slots",
            "--workers",
            "--target-load",
            "--scheduler-tick-ms",
            "--mem-limit-gb",
            "--sdk-thread",
            "--no-sdk-thread",
            "--vm-thread",
            "--no-vm-thread",
            "--dry-run"
        ]) {
            expect(help).to.include(option);
        }
    });

    it("runs all Mocha tests by default and supports --e2e-only", function () {
        expect(parseCliArgs(argv()).e2eOnly).to.equal(false);
        expect(parseCliArgs(argv("--e2e-only")).e2eOnly).to.equal(true);
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

describe("e2e-parallel argParser - scheduler tick", function () {
    it("uses the scheduler default when no tick override is provided", function () {
        expect(parseCliArgs(argv()).schedulerTickMs).to.equal(undefined);
    });

    it("accepts separated and equals scheduler tick values", function () {
        expect(
            parseCliArgs(argv("--scheduler-tick-ms", "250")).schedulerTickMs
        ).to.equal(250);
        expect(
            parseCliArgs(argv("--scheduler-tick-ms=125")).schedulerTickMs
        ).to.equal(125);
    });

    it("rejects zero and negative scheduler tick values", function () {
        expect(
            parseCliArgs(argv("--scheduler-tick-ms", "0")).schedulerTickMs
        ).to.equal(undefined);
        expect(
            parseCliArgs(argv("--scheduler-tick-ms=-1")).schedulerTickMs
        ).to.equal(undefined);
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

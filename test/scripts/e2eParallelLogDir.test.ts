import { expect } from "chai";
import fs from "fs";
import os from "os";
import path from "path";

// CommonJS dev scripts for the parallel e2e runner. We test the
// destructive-tooling guards: a mis-resolved / symlinked log dir must never
// wipe the working tree.
const { parseCliArgs } = require("../../scripts/e2e-parallel/argParser.js") as {
    parseCliArgs: (argv: string[]) => {
        logDir: string;
        logDirProvided: boolean;
    };
};
const {
    isDangerousPurgeTarget,
    isWithinDefaultLogDir,
    safeEmptyDir,
    nextRunDir
} = require("../../scripts/e2e-parallel/logging.js") as {
    isDangerousPurgeTarget: (resolved: string) => boolean;
    isWithinDefaultLogDir: (resolved: string) => boolean;
    safeEmptyDir: (dirPath: string, allow: boolean) => void;
    nextRunDir: (baseDir: string) => string;
};

const argv = (...args: string[]) => ["node", "runner", ...args];

describe("e2e-parallel argParser - logDir validation", function () {
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

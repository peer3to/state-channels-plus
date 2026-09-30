// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
// @distributed-requires: browser
import {
    portIsOccupied,
    processesMatching,
    waitForPortFree,
    waitForProcessesGone,
    runGateLaunchProbe,
    runChromiumPreCheck,
    runBrowserOnlyRunner,
    browsersPathWith,
    waitForGateReady,
    writeGate,
    writeIdlingGate
} from "../fixtures/distributed/browserGateTrees";
import { expect } from "chai";
import path from "path";

// These tests launch a real Chromium or run a gate that does, so they need the
// browser runner's environment: the marker above keeps them on worker hosts
// that provide it, and the pure-logic browser tests stay in
// e2eParallelBrowserTasks.test.ts.

const { BROWSER_TEST_TASK } =
    require("../../scripts/e2e-parallel/shared/browserConfig.js") as {
        BROWSER_TEST_TASK: string;
    };
const { browserChromiumFailure } =
    require("../../scripts/e2e-parallel/shared/taskRunners.js") as {
        browserChromiumFailure: () => Promise<Error | null>;
    };
const { runTask } = require("../../scripts/e2e-parallel/shared/runTask.js") as {
    runTask: (
        cmd: string,
        args: string[],
        env: NodeJS.ProcessEnv,
        label: string,
        output: string | { write: () => void; close: () => Promise<void> },
        cancellationSignal?: AbortSignal
    ) => Promise<{ code: number; cancelled: boolean }>;
};
const { HARDHAT_CLI } =
    require("../../scripts/e2e-parallel/shared/constants.js") as {
        HARDHAT_CLI: string;
    };

describe("browser typecheck boundary", function () {
    it("admits the gate once the browser typecheck passes", function () {
        const run = runBrowserOnlyRunner("exit 0");
        expect(run.gateRan).to.equal(true);
    });

    it("stops the run before admitting any gate when the browser typecheck fails", function () {
        const run = runBrowserOnlyRunner("exit 3");
        expect(run.status).to.not.equal(0);
        expect(run.output).to.contain(
            "`yarn typecheck:browser` failed (exit 3)"
        );
        expect(run.gateRan).to.equal(false);
    });
});

describe("browser task cancellation", function () {
    it("reaps a cancelled gate's Chromium and releases its port", async function () {
        const { gate, marker, tag, root } = writeIdlingGate();
        const logPath = path.join(root, "gate.ansi");
        const cancellation = new AbortController();
        const running = runTask(
            process.execPath,
            [HARDHAT_CLI, BROWSER_TEST_TASK, "--script", gate],
            process.env,
            "browser:cancelled-gate",
            logPath,
            cancellation.signal
        );
        const ready = await waitForGateReady(marker);
        expect(processesMatching(tag)).to.have.length.greaterThan(0);
        expect(await portIsOccupied(ready.port)).to.equal(true);

        cancellation.abort();
        const result = await running;

        expect(result.cancelled).to.equal(true);
        // The gate owns a detached process group; cancelling has to take the
        // whole tree, not just the Hardhat process the runner spawned.
        expect(await waitForProcessesGone(tag)).to.deep.equal([]);
        expect(await waitForPortFree(ready.port)).to.equal(false);
    });

    it("runs a following gate after one was cancelled", async function () {
        const { gate: cancelled, marker, tag } = writeIdlingGate();
        const cancellation = new AbortController();
        const first = runTask(
            process.execPath,
            [HARDHAT_CLI, BROWSER_TEST_TASK, "--script", cancelled],
            process.env,
            "browser:cancelled-gate",
            path.join(path.dirname(cancelled), "first.ansi"),
            cancellation.signal
        );
        await waitForGateReady(marker);
        cancellation.abort();
        await first;
        expect(await waitForProcessesGone(tag)).to.deep.equal([]);

        const { gate: next, root } = writeGate("process.exit(0);");
        const second = await runTask(
            process.execPath,
            [HARDHAT_CLI, BROWSER_TEST_TASK, "--script", next],
            process.env,
            "browser:next-gate",
            path.join(root, "second.ansi")
        );
        expect(second.code).to.equal(0);
    });
});

describe("browser tier environment", function () {
    it("checks the gates' Chromium before a run schedules them", async function () {
        // The browser typecheck says nothing about the browser,
        // so without this the tier fails only after the whole run.
        expect(await browserChromiumFailure()).to.equal(null);
    });

    it("passes the Chromium pre-check when only the headless shell the gates launch is installed", function () {
        expect(
            runChromiumPreCheck(browsersPathWith(["headless-shell"]))
        ).to.equal("READY");
    });

    it("fails the Chromium pre-check when only the full Chromium is installed", function () {
        const output = runChromiumPreCheck(browsersPathWith(["chromium"]));
        expect(output).to.match(/^FAILED /);
        expect(output).to.contain("yarn playwright install chromium");
        expect(output).to.contain("--no-browser");
    });

    it("launches a real Chromium through the gates' own policy", function () {
        expect(runGateLaunchProbe("launch")).to.contain("LAUNCHED");
    });
});

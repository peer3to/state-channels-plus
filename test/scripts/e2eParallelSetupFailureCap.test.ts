// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import {
    MIXED_TIER_TASKS,
    runAgainstProtocolWorkers,
    sortedLabels,
    workerNamed
} from "@test/fixtures/distributed/protocolWorker";
import { expect } from "chai";
import { stripVTControlCharacters } from "util";

const {
    MAX_IDENTICAL_SETUP_FAILURES,
    allWorkersSetupCapped,
    normalizeFailureReason,
    recordSetupFailure,
    resetSetupFailures
} = require("../../scripts/e2e-parallel/distributed/orchestrator.js");

// Two hardhat tasks and one forge task: every protocol 14 host runs them.
const SETUP_CAP_TASKS = MIXED_TIER_TASKS.slice(0, 3);
const OUTSIDE_MANIFEST = "Worker requested a file outside the offered manifest";
const retiredLine = (name: string) =>
    `Retiring worker ${name} for this run after ${MAX_IDENTICAL_SETUP_FAILURES} identical setup failures`;
// Worker names are printed in their console colour.
const plain = (line: string) => stripVTControlCharacters(line);

describe("distributed setup failure cap", function () {
    it("fails the run fast with the repeated error when its only worker fails setup the same way three times", async function () {
        const run = await runAgainstProtocolWorkers(
            [
                {
                    name: "failing-host",
                    distributedProtocol: 14,
                    leaseSteps: Array(10).fill("outside-manifest")
                }
            ],
            // The cap ends the run on the third identical failure; the window
            // only has to outlast a redial under load so the lost-worker path
            // cannot win first.
            { tasks: SETUP_CAP_TASKS, discoveryTimeoutMs: 20_000 }
        );
        expect({
            failure: run.failure?.message,
            workspaceOffers: workerNamed(run.workers, "failing-host")
                .workspaceOffers,
            retired: run.warnings.some((line) =>
                plain(line).includes(retiredLine("failing-host"))
            )
        }).to.deep.equal({
            failure: `All distributed workers failed the same way ${MAX_IDENTICAL_SETUP_FAILURES} times: ${OUTSIDE_MANIFEST}`,
            workspaceOffers: MAX_IDENTICAL_SETUP_FAILURES,
            retired: true
        });
    });

    it("retires a worker that keeps failing setup while a healthy worker completes the run", async function () {
        const run = await runAgainstProtocolWorkers(
            [
                {
                    name: "failing-host",
                    distributedProtocol: 14,
                    leaseSteps: Array(10).fill("outside-manifest")
                },
                {
                    name: "healthy-host",
                    distributedProtocol: 14,
                    holdFirstResultUntil: {
                        worker: "failing-host",
                        workspaceOffers: MAX_IDENTICAL_SETUP_FAILURES
                    }
                }
            ],
            { tasks: SETUP_CAP_TASKS, discoveryTimeoutMs: 10_000 }
        );
        expect(run.failure).to.equal(null);
        expect({
            failingOffers: workerNamed(run.workers, "failing-host")
                .workspaceOffers,
            failingLabels: workerNamed(run.workers, "failing-host").labels,
            healthyLabels: sortedLabels(
                workerNamed(run.workers, "healthy-host").labels
            ),
            completed: run.result.completed,
            retired: run.warnings.some((line) =>
                plain(line).includes(retiredLine("failing-host"))
            )
        }).to.deep.equal({
            failingOffers: MAX_IDENTICAL_SETUP_FAILURES,
            failingLabels: [],
            healthyLabels: sortedLabels(
                SETUP_CAP_TASKS.map((task) => task.label)
            ),
            completed: 3,
            retired: true
        });
    });

    it("keeps retrying a worker whose setup fails once and then succeeds", async function () {
        const run = await runAgainstProtocolWorkers(
            [
                {
                    name: "flaky-host",
                    distributedProtocol: 14,
                    leaseSteps: ["outside-manifest"]
                }
            ],
            { tasks: SETUP_CAP_TASKS, discoveryTimeoutMs: 20_000 }
        );
        expect(run.failure).to.equal(null);
        expect({
            workspaceOffers: workerNamed(run.workers, "flaky-host")
                .workspaceOffers,
            completed: run.result.completed,
            retired: run.warnings.some((line) => line.includes("Retiring"))
        }).to.deep.equal({ workspaceOffers: 2, completed: 3, retired: false });
    });

    it("starts the identical-failure count again after the worker is admitted a task", async function () {
        // Two failures, a lease that runs one task and leaves, then one more
        // failure: without the reset that third failure would retire the host.
        const run = await runAgainstProtocolWorkers(
            [
                {
                    name: "recovering-host",
                    distributedProtocol: 14,
                    leaseSteps: [
                        "outside-manifest",
                        "outside-manifest",
                        "one-task-then-close",
                        "outside-manifest"
                    ]
                }
            ],
            { tasks: SETUP_CAP_TASKS, discoveryTimeoutMs: 20_000 }
        );
        expect(run.failure).to.equal(null);
        expect({
            workspaceOffers: workerNamed(run.workers, "recovering-host")
                .workspaceOffers,
            completed: run.result.completed,
            retired: run.warnings.some((line) => line.includes("Retiring"))
        }).to.deep.equal({ workspaceOffers: 5, completed: 3, retired: false });
    });

    it("does not retire a worker whose setup failures alternate between different errors", async function () {
        const run = await runAgainstProtocolWorkers(
            [
                {
                    name: "alternating-host",
                    distributedProtocol: 14,
                    leaseSteps: [
                        "outside-manifest",
                        "invalid-diff",
                        "outside-manifest",
                        "invalid-diff",
                        "outside-manifest"
                    ]
                }
            ],
            { tasks: SETUP_CAP_TASKS, discoveryTimeoutMs: 20_000 }
        );
        expect(run.failure).to.equal(null);
        expect({
            workspaceOffers: workerNamed(run.workers, "alternating-host")
                .workspaceOffers,
            completed: run.result.completed,
            retired: run.warnings.some((line) => line.includes("Retiring"))
        }).to.deep.equal({ workspaceOffers: 6, completed: 3, retired: false });
    });

    it("counts only consecutive failures with the same normalized reason and resets on admission", async function () {
        const states = new Map();
        const record = (reason: string) =>
            recordSetupFailure(states, "host", { label: "host", reason });
        record("Delta archive 12 bytes short");
        record("Delta archive 40 bytes short");
        // The returned state is live, so read each count as it is recorded.
        const afterDifferent = record(
            "Worker returned an invalid workspace diff"
        ).setupFailures;
        record("Worker returned an invalid workspace diff");
        resetSetupFailures(states, "host");
        const afterReset = record(
            "Worker returned an invalid workspace diff"
        ).setupFailures;
        record("Worker returned an invalid workspace diff");
        const capped = record("Worker returned an invalid workspace diff");
        expect({
            normalized: normalizeFailureReason(
                "sent 206060 bytes to 0a079c10a999"
            ),
            afterDifferent,
            afterReset,
            capped: capped.setupCapped === true && capped.quarantined === true,
            message: allWorkersSetupCapped(states)
        }).to.deep.equal({
            normalized: "sent # bytes to #",
            afterDifferent: 1,
            afterReset: 1,
            capped: true,
            message: `All distributed workers failed the same way ${MAX_IDENTICAL_SETUP_FAILURES} times: Worker returned an invalid workspace diff`
        });
    });
});

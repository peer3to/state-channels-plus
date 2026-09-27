// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import {
    CHROMIUM_MOCHA_TASKS,
    MIXED_TIER_TASKS,
    runAgainstProtocolWorkers,
    sortedLabels,
    workerNamed
} from "@test/fixtures/distributed/protocolWorker";
import { expect } from "chai";

const {
    assertCompatibleWorkerProtocol
} = require("../../scripts/e2e-parallel/distributed/orchestrator.js");
const {
    DISTRIBUTED_PROTOCOL_VERSION,
    MIN_COMPATIBLE_DISTRIBUTED_PROTOCOL,
    runnersForDistributedProtocol,
    workerCanRunTask
} = require("../../scripts/e2e-parallel/distributed/protocol.js");

describe("distributed mixed-protocol pool", function () {
    it("a pool of protocol 13 and 14 hosts runs browser tasks only on the 14 host and the rest on both", async function () {
        const run = await runAgainstProtocolWorkers([
            { name: "host-13", distributedProtocol: 13 },
            { name: "host-14", distributedProtocol: 14 }
        ]);
        expect(run.failure).to.equal(null);
        const host13 = workerNamed(run.workers, "host-13");
        const host14 = workerNamed(run.workers, "host-14");
        expect(host13.runners).to.not.include("browser");
        expect(
            host14.runners.filter((runner) => runner === "browser")
        ).to.have.length(2);
        expect(
            sortedLabels(
                [...host13.labels, ...host14.labels].filter(
                    (label, index, all) => all.indexOf(label) === index
                )
            )
        ).to.deep.equal(
            sortedLabels([
                "hardhat one",
                "hardhat two",
                "forge one",
                "browser gate one",
                "browser gate two"
            ])
        );
        expect({
            completed: run.result.completed,
            skipped: run.result.skipped.length,
            failed: run.result.failed.length
        }).to.deep.equal({ completed: 5, skipped: 0, failed: 0 });
        // Each host is offered the workspace under its own protocol.
        expect([host13.offeredProtocol, host14.offeredProtocol]).to.deep.equal([
            13, 14
        ]);
    });

    it("a pool of only protocol 13 hosts runs hardhat and forge and skips browser tasks with a notice, without failing", async function () {
        const run = await runAgainstProtocolWorkers([
            { name: "host-13", distributedProtocol: 13 }
        ]);
        expect(run.failure).to.equal(null);
        expect(
            sortedLabels(workerNamed(run.workers, "host-13").labels)
        ).to.deep.equal(
            sortedLabels(["hardhat one", "hardhat two", "forge one"])
        );
        expect({
            completed: run.result.completed,
            skipped: run.result.skipped.map(
                (task: { label: string }) => task.label
            ),
            failed: run.result.failed.length
        }).to.deep.equal({
            completed: 3,
            skipped: ["browser gate one", "browser gate two"],
            failed: 0
        });
        const notice = run.warnings.join("\n");
        expect(notice).to.include(
            "Skipping 2 browser task(s): no connected worker supports the browser runner; a worker host on distributed protocol 14 or newer runs them."
        );
        expect(notice).to.include("browser gate one");
        expect(run.summary).to.include("> [!WARNING]");
        expect(run.summary).to.include("Skipping 2 browser task(s)");
    });

    it("a pool of only protocol 14 hosts runs every tier and skips nothing", async function () {
        const run = await runAgainstProtocolWorkers([
            { name: "host-14", distributedProtocol: 14 }
        ]);
        expect(run.failure).to.equal(null);
        expect(
            sortedLabels(workerNamed(run.workers, "host-14").labels)
        ).to.deep.equal(
            sortedLabels([
                "hardhat one",
                "hardhat two",
                "forge one",
                "browser gate one",
                "browser gate two"
            ])
        );
        expect(run.result.skipped).to.deep.equal([]);
        expect(run.warnings.join("\n")).to.not.include("Skipping");
        expect(run.summary).to.equal("");
    });

    it("a pool of protocol 13 and 14 hosts hands Mocha tasks marked for the browser runner only to the 14 host", async function () {
        const run = await runAgainstProtocolWorkers(
            [
                { name: "host-13", distributedProtocol: 13 },
                { name: "host-14", distributedProtocol: 14 }
            ],
            { tasks: [...MIXED_TIER_TASKS, ...CHROMIUM_MOCHA_TASKS] }
        );
        expect(run.failure).to.equal(null);
        const marked = CHROMIUM_MOCHA_TASKS.map((task) => task.label);
        expect(
            workerNamed(run.workers, "host-13").labels.filter((label) =>
                marked.includes(label)
            )
        ).to.deep.equal([]);
        expect(
            sortedLabels(
                workerNamed(run.workers, "host-14").labels.filter((label) =>
                    marked.includes(label)
                )
            )
        ).to.deep.equal(sortedLabels(marked));
        expect({
            completed: run.result.completed,
            skipped: run.result.skipped.length,
            failed: run.result.failed.length
        }).to.deep.equal({ completed: 8, skipped: 0, failed: 0 });
    });

    it("a pool of only protocol 13 hosts skips Mocha tasks marked for the browser runner with a notice, without failing", async function () {
        const run = await runAgainstProtocolWorkers(
            [{ name: "host-13", distributedProtocol: 13 }],
            { tasks: [...MIXED_TIER_TASKS, ...CHROMIUM_MOCHA_TASKS] }
        );
        expect(run.failure).to.equal(null);
        expect(
            sortedLabels(workerNamed(run.workers, "host-13").labels)
        ).to.deep.equal(
            sortedLabels(["hardhat one", "hardhat two", "forge one"])
        );
        expect({
            completed: run.result.completed,
            skipped: sortedLabels(
                run.result.skipped.map((task: { label: string }) => task.label)
            ),
            failed: run.result.failed.length
        }).to.deep.equal({
            completed: 3,
            skipped: sortedLabels([
                "browser gate one",
                "browser gate two",
                ...CHROMIUM_MOCHA_TASKS.map((task) => task.label)
            ]),
            failed: 0
        });
        const notice = run.warnings.join("\n");
        expect(notice).to.include(
            "Skipping 3 hardhat task(s) that need browser: no connected worker supports the browser runner; a worker host on distributed protocol 14 or newer runs them."
        );
        expect(notice).to.include("chromium mocha 1");
        expect(run.summary).to.include(
            "Skipping 3 hardhat task(s) that need browser"
        );
    });

    it("lets a worker run a task only when its protocol lists the task's runner and every runner the task requires", function () {
        const runners13 = runnersForDistributedProtocol(13);
        const runners14 = runnersForDistributedProtocol(14);
        const marked = { runner: "hardhat", requires: ["browser"] };
        const plain = { label: "plain" };
        const gate = { runner: "browser" };
        expect({
            markedOn13: workerCanRunTask(runners13, marked),
            markedOn14: workerCanRunTask(runners14, marked),
            plainOn13: workerCanRunTask(runners13, plain),
            gateOn13: workerCanRunTask(runners13, gate),
            gateOn14: workerCanRunTask(runners14, gate)
        }).to.deep.equal({
            markedOn13: false,
            markedOn14: true,
            plainOn13: true,
            gateOn13: false,
            gateOn14: true
        });
    });

    it("rejects a worker host older than the minimum or newer than the orchestrator", function () {
        const accepted = `${MIN_COMPATIBLE_DISTRIBUTED_PROTOCOL}-${DISTRIBUTED_PROTOCOL_VERSION}`;
        expect(() =>
            assertCompatibleWorkerProtocol({
                distributedProtocol: MIN_COMPATIBLE_DISTRIBUTED_PROTOCOL - 1
            })
        ).to.throw(
            `Distributed worker protocol mismatch: orchestrator accepts ${accepted}, worker host provides ${MIN_COMPATIBLE_DISTRIBUTED_PROTOCOL - 1}`
        );
        expect(() =>
            assertCompatibleWorkerProtocol({
                distributedProtocol: DISTRIBUTED_PROTOCOL_VERSION + 1
            })
        ).to.throw(
            `Distributed worker protocol mismatch: orchestrator accepts ${accepted}, worker host provides ${DISTRIBUTED_PROTOCOL_VERSION + 1}`
        );
        expect(() => assertCompatibleWorkerProtocol({})).to.throw(
            "worker host provides none"
        );
        expect([
            ...assertCompatibleWorkerProtocol({ distributedProtocol: 13 })
        ]).to.deep.equal(["hardhat", "forge"]);
    });
});

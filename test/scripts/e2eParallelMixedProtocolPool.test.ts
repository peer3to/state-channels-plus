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
    runnersForDistributedProtocol
} = require("../../scripts/e2e-parallel/distributed/protocol.js");

describe("distributed worker protocol pool", function () {
    it("a pool of protocol 16 hosts runs every tier across the hosts and skips nothing", async function () {
        const run = await runAgainstProtocolWorkers([
            { name: "host-a", distributedProtocol: 16 },
            {
                name: "host-b",
                distributedProtocol: 16,
                // Keep the run open until host-a has run a task too.
                holdFirstResultUntil: { worker: "host-a", labels: 1 }
            }
        ]);
        expect(run.failure).to.equal(null);
        const hostA = workerNamed(run.workers, "host-a");
        const hostB = workerNamed(run.workers, "host-b");
        expect(hostA.labels).to.not.be.empty;
        expect(
            sortedLabels(
                [...hostA.labels, ...hostB.labels].filter(
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
            failed: run.result.failed.length
        }).to.deep.equal({ completed: 5, failed: 0 });
        // Each host is offered the workspace under the current protocol, yet
        // the manifest keeps the orchestrator's workspace root off the wire.
        expect([hostA.offeredProtocol, hostB.offeredProtocol]).to.deep.equal([
            DISTRIBUTED_PROTOCOL_VERSION,
            DISTRIBUTED_PROTOCOL_VERSION
        ]);
        expect({
            hasRoot: "localWorkspaceRoot" in hostA.offeredManifest!,
            leaksRoot: JSON.stringify(hostA.offeredManifest).includes(run.root)
        }).to.deep.equal({ hasRoot: false, leaksRoot: false });
    });

    it("a protocol 16 host runs Mocha tasks marked for the browser runner", async function () {
        const run = await runAgainstProtocolWorkers(
            [{ name: "host-16", distributedProtocol: 16 }],
            { tasks: [...MIXED_TIER_TASKS, ...CHROMIUM_MOCHA_TASKS] }
        );
        expect(run.failure).to.equal(null);
        expect(
            sortedLabels(workerNamed(run.workers, "host-16").labels)
        ).to.deep.equal(
            sortedLabels([
                ...MIXED_TIER_TASKS.map((task) => task.label),
                ...CHROMIUM_MOCHA_TASKS.map((task) => task.label)
            ])
        );
        expect({
            completed: run.result.completed,
            failed: run.result.failed.length
        }).to.deep.equal({ completed: 8, failed: 0 });
    });

    it("refuses a protocol 15 host in a pool and runs everything on the protocol 16 host", async function () {
        const run = await runAgainstProtocolWorkers([
            { name: "host-15", distributedProtocol: 15 },
            { name: "host-16", distributedProtocol: 16 }
        ]);
        expect(run.failure).to.equal(null);
        const host15 = workerNamed(run.workers, "host-15");
        expect({
            host15Labels: host15.labels,
            host15Offers: host15.workspaceOffers,
            host16: sortedLabels(workerNamed(run.workers, "host-16").labels),
            completed: run.result.completed,
            failed: run.result.failed.length
        }).to.deep.equal({
            host15Labels: [],
            host15Offers: 0,
            host16: sortedLabels(MIXED_TIER_TASKS.map((task) => task.label)),
            completed: 5,
            failed: 0
        });
        expect(run.warnings.join("\n")).to.include(
            "Ignoring worker host-15: Distributed worker protocol mismatch: orchestrator accepts 16-16, worker host provides 15"
        );
    });

    it("fails the run when the only host is on protocol 15", async function () {
        const run = await runAgainstProtocolWorkers(
            [{ name: "host-15", distributedProtocol: 15 }],
            { discoveryTimeoutMs: 1000 }
        );
        expect(run.failure?.message).to.equal(
            "No distributed workers discovered"
        );
        expect(workerNamed(run.workers, "host-15").labels).to.deep.equal([]);
        expect(run.warnings.join("\n")).to.include(
            "Ignoring worker host-15: Distributed worker protocol mismatch"
        );
    });

    it("leases only the current protocol, with every runner", function () {
        for (const version of [13, 14, 15, 17])
            expect(runnersForDistributedProtocol(version)).to.equal(null);
        expect([...runnersForDistributedProtocol(16)].sort()).to.deep.equal([
            "browser",
            "forge",
            "hardhat"
        ]);
    });

    it("rejects a worker host older than the minimum or newer than the orchestrator", function () {
        const accepted = `${MIN_COMPATIBLE_DISTRIBUTED_PROTOCOL}-${DISTRIBUTED_PROTOCOL_VERSION}`;
        for (const old of [13, 14, 15]) {
            expect(() =>
                assertCompatibleWorkerProtocol({ distributedProtocol: old })
            ).to.throw(
                `Distributed worker protocol mismatch: orchestrator accepts ${accepted}, worker host provides ${old}`
            );
        }
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
        expect(
            [
                ...assertCompatibleWorkerProtocol({ distributedProtocol: 16 })
            ].sort()
        ).to.deep.equal(["browser", "forge", "hardhat"]);
    });
});

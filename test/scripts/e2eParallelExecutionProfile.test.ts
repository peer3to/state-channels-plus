// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import { expect } from "chai";
import { LeasePoolHarness } from "../fixtures/distributed/leasePool";
import { TestIsolatedRuntimeBackend } from "../fixtures/distributed/isolatedRuntimeBackend";

const {
    resolveExecutionProfile
} = require("../../scripts/e2e-parallel/distributed/executionProfile.js");

const defaults = {
    schedulerTickMs: 1000,
    workers: 4,
    slots: 1,
    cpu: 4,
    memoryBytes: 8 * 1024 ** 3,
    diskBytes: 10 * 1024 ** 3,
    pidsLimit: 512,
    targetLoad: 0.8
};

describe("distributed execution profile", function () {
    it("uses worker defaults when the orchestrator requests no override", function () {
        expect(resolveExecutionProfile(defaults, defaults)).to.deep.equal(
            defaults
        );
    });

    it("passes a smaller valid override unchanged", function () {
        const resolved = resolveExecutionProfile(defaults, defaults, {
            workers: 2,
            cpu: 2,
            memoryBytes: 4 * 1024 ** 3
        });
        expect(resolved.workers).to.equal(2);
        expect(resolved.cpu).to.equal(2);
        expect(resolved.memoryBytes).to.equal(4 * 1024 ** 3);
    });

    it("rejects an oversized request without clamping it", function () {
        expect(() =>
            resolveExecutionProfile(defaults, defaults, {
                memoryBytes: 9 * 1024 ** 3
            })
        ).to.throw("exceeds the permitted allocation");
        try {
            resolveExecutionProfile(defaults, defaults, {
                memoryBytes: 9 * 1024 ** 3
            });
        } catch (error) {
            expect((error as { code: string }).code).to.equal(
                "RESOURCE_ALLOCATION_REJECTED"
            );
            expect((error as { resource: string }).resource).to.equal(
                "memoryBytes"
            );
        }
    });

    it("rejects unknown, missing, fractional integer, and zero limit values", function () {
        expect(() =>
            resolveExecutionProfile(defaults, defaults, { mystery: 1 })
        ).to.throw("Unknown execution profile field");
        expect(() =>
            resolveExecutionProfile(defaults, defaults, { workers: 1.5 })
        ).to.throw("Invalid execution profile value");
        expect(() =>
            resolveExecutionProfile(defaults, defaults, { pidsLimit: 0 })
        ).to.throw("Invalid execution profile value");
    });

    it("rejects an oversized lease before environment creation and accepts a later smaller request", async function () {
        const pool = await LeasePoolHarness.create();
        const backend = new TestIsolatedRuntimeBackend();
        try {
            const worker = await pool.startServer("worker-a", {
                environmentBackend: backend
            });
            const orchestrator = await pool.startOrchestrator("oversized", {
                executionProfile: { cpu: 1_000_000 }
            });
            await orchestrator.waitFor(
                worker.name,
                "RESOURCE_ALLOCATION_REJECTED"
            );
            expect(
                backend.calls.filter((entry) => entry.operation === "create")
            ).to.have.length(0);
            const checkpoint = orchestrator.checkpoint();
            await orchestrator.send(worker.name, "LEASE_REQUEST", {
                sessionId: "smaller",
                executionProfile: { cpu: 0.25 }
            });
            await orchestrator.waitFor(worker.name, "LEASE_GRANTED", {
                after: checkpoint
            });
            await orchestrator.send(worker.name, "RELEASE");
            await orchestrator.waitFor(worker.name, "LEASE_CLEAN", {
                after: checkpoint
            });
        } finally {
            await pool.close();
        }
    });
});

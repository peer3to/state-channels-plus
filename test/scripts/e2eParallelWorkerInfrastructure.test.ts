// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import { SlotWorkerProcess } from "../fixtures/distributed/SlotWorkerProcess";
import { expect } from "chai";

describe("e2e parallel worker infrastructure", function () {
    // Mutation: the worker does not monitor infra.services -> no failure report.
    it("a distributed worker whose slot storage diff service dies reports an infrastructure failure carrying the service's log", async function () {
        const worker = await SlotWorkerProcess.start();
        try {
            process.kill(worker.servicePid(), "SIGKILL");

            const report = await worker.waitFor(
                (message) =>
                    message.kind === "INFRA_PROCESS_DIAGNOSTIC" &&
                    message.processKind === "storage-diff"
            );
            const failure = await worker.waitFor(
                (message) => message.kind === "WORKER_ERROR"
            );

            expect(report.trigger).to.equal("storage-diff process exited");
            expect(report.processFailure).to.equal(
                "slot 0 storage diff service exited (signal SIGKILL)"
            );
            expect(report.slotId).to.equal(0);
            expect(failure.message).to.equal(report.processFailure);
            // the service's own output: its ready line
            expect(worker.uploadedLog("storage-diff")).to.include(
                '"event":"listening"'
            );
        } finally {
            await worker.close();
        }
    });

    // Mutation: reportInfrastructureLogs leaves out infra.services -> no service log.
    it("a distributed worker collecting infrastructure logs at the end of a run uploads its slot storage diff service's log", async function () {
        const worker = await SlotWorkerProcess.start();
        try {
            worker.send({ kind: "RUN_COMPLETE", collectInfraLogs: true });
            await worker.waitFor(
                (message) => message.kind === "WORKER_COMPLETE"
            );

            const report = await worker.waitFor(
                (message) =>
                    message.kind === "INFRA_PROCESS_DIAGNOSTIC" &&
                    message.processKind === "storage-diff"
            );
            expect(report.trigger).to.equal(
                "run completed; collecting infrastructure logs"
            );
            expect(report.processFailure).to.equal("");
            expect(worker.uploadedLog("storage-diff")).to.include(
                '"event":"listening"'
            );
            worker.send({ kind: "WORKER_COMPLETE_ACK" });
        } finally {
            await worker.close();
        }
    });
});

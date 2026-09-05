// @spec-test-coverage-ignore: shared watchdog runtime-port assertion exercised by the mapped test declarations
import { expect } from "chai";
import { randomUUID } from "node:crypto";
import { BroadcastChannel } from "node:worker_threads";

import { sleep } from "@/utils";
import { setupWatchdogP2pInstance } from "@test/fixtures/RuntimeTransportModesFixture";
import {
    WATCHDOG_WORKER_DELAY_ERROR_THRESHOLD_MS,
    WATCHDOG_WORKER_ORIGINAL_ERROR,
    WATCHDOG_WORKER_TRIPPED_DELAY_MS,
    type WatchdogWorkerMode
} from "@test/evm/workers/watchdogContractExecutorWorkerCore";
import { waitFor } from "@test/utils/waitFor";

const WATCHDOG_MESSAGE = `Event loop delay ${WATCHDOG_WORKER_TRIPPED_DELAY_MS}ms exceeded configured threshold ${WATCHDOG_WORKER_DELAY_ERROR_THRESHOLD_MS}ms`;

/**
 * The contract-executor worker reports an autonomous error through the real
 * runtime port as one `hostError` and keeps serving. Every case arms the trip
 * only after the runtime is ready and the host-error listener is subscribed,
 * so a report can never race readiness; the arm channel is one-shot and both
 * ends close on every exit.
 */
export async function assertReportedAndStillServing(options: {
    runSdkInThread: boolean;
    mode: WatchdogWorkerMode;
}): Promise<void> {
    const armChannel = `watchdog-arm-${randomUUID()}`;
    const p2pInstance = await setupWatchdogP2pInstance({
        runSdkInThread: options.runSdkInThread,
        mode: options.mode,
        armChannel
    });
    const reports: Error[] = [];
    const unsubscribe = p2pInstance.onHostError((error) => {
        reports.push(error);
    });
    const sender = new BroadcastChannel(armChannel);
    try {
        // Nothing may trip before the arm: the scripted source stays quiet
        // and no autonomous throw is scheduled.
        await sleep(400);
        expect(reports.length).to.equal(0);

        sender.postMessage({ type: "arm" });
        await waitFor(() => reports.length >= 1, 15_000, 50);
        expect(reports.length).to.equal(1);
        const [report] = reports;
        if (options.mode === "watchdog") {
            expect(report.message).to.equal(WATCHDOG_MESSAGE);
            expect(
                (report as Error & { eventLoopDelay?: unknown }).eventLoopDelay
            ).to.deep.include({
                dMax: WATCHDOG_WORKER_TRIPPED_DELAY_MS,
                delayErrorThresholdMs: WATCHDOG_WORKER_DELAY_ERROR_THRESHOLD_MS
            });
        } else {
            expect(report.message).to.equal(WATCHDOG_WORKER_ORIGINAL_ERROR);
        }

        // The worker kept its canonical EVM state and still serves requests.
        const participants =
            await p2pInstance.p2pContractInstance.getParticipants();
        expect(participants).to.be.an("array");
        await sleep(300);
        expect(reports.length).to.equal(1);
    } finally {
        sender.close();
        unsubscribe();
        // Disposal only resolves once the worker drained and exited.
        await p2pInstance.dispose();
    }
}

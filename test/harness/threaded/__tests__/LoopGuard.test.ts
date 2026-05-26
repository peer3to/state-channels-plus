// W6 - loop-delay guard acceptance. boots a worker with a 500ms threshold,
// drives a 1500ms busy loop via the test-only test.busyLoop rpc, asserts
// the orchestrator sees a "loop.stall" push that names the offending worker
// and yields a LoopDelayExceededError.
//
// W0 D-9 - guard policy is boss-shipped; this test consumes the wire.

import { expect } from "chai";
import { describe, it } from "mocha";
import { ethers } from "ethers";

import { PeerWorker } from "../PeerWorker";
import { LoopDelayExceededError } from "@test/harness/core/LoopDelayExceededError";
import { SMOKE_DEPLOYMENT_KEY } from "../worker/__tests__/smokeDeploymentFixture";

const SMOKE_BUNDLE =
    "@test/harness/threaded/worker/__tests__/smokeDeploymentFixture";

type LoopStallPayload = {
    workerIndex: number;
    observedMs: number;
    thresholdMs: number;
};

describe("W6 loop-delay guard", () => {
    it("worker busy-loop -> orchestrator sees loop.stall push naming worker", async function () {
        this.timeout(90_000);

        const wallet = ethers.Wallet.createRandom();
        const peer = await PeerWorker.spawn({
            index: 11,
            signerPk: wallet.privateKey,
            channelId: "loop-guard",
            discoveryRegistryPort: 0,
            channelManagerAddress: "0x0000000000000000000000000000000000000000",
            deploymentName: SMOKE_DEPLOYMENT_KEY,
            bundleManifest: [SMOKE_BUNDLE],
            harnessConfig: {
                timeConfig: {
                    p2pTime: 1,
                    agreementTime: 2,
                    chainFallbackTime: 2,
                    evidenceTime: 3
                },
                configOverrides: {},
                stateMachineGasLimit: 500_000,
                disputeExecutionGasLimit: 3_000_000,
                channelId: "loop-guard",
                initialBalance: 500
            },
            logConfig: { level: "error", peerIndex: 11 },
            testTitle: "W6 loop guard",
            // step 1 - 500ms threshold; busy-loop is 1500ms -> guard fires.
            loopDelayMaxMs: 500
        });

        // step 1 - subscribe to loop.stall and convert the first frame into
        // a LoopDelayExceededError. mirrors the orchestrator-side push handler
        // that W1's PeerTestHarness wiring installs once the harness-level
        // route lands (next agent's job).
        const stall = await new Promise<LoopDelayExceededError>(
            (resolve, reject) => {
                const timer = setTimeout(() => {
                    reject(new Error("loop.stall never arrived within 5s"));
                }, 5_000);
                peer.getRpcClient().on("loop.stall", (payload: unknown) => {
                    const p = payload as LoopStallPayload;
                    clearTimeout(timer);
                    resolve(
                        new LoopDelayExceededError(
                            p.workerIndex,
                            p.observedMs,
                            p.thresholdMs
                        )
                    );
                });
                // step 1 - drive the busy loop. don't await: the rpc round-trip
                // can't return while the event loop is blocked. fire-and-forget
                // and rely on the push (which the guard can deliver post-stall
                // once the loop frees up) to resolve us.
                void peer
                    .getRpcClient()
                    .call("test.busyLoop", { durationMs: 1500 })
                    .catch(() => undefined);
            }
        );

        expect(stall).to.be.instanceOf(LoopDelayExceededError);
        expect(stall.workerIndex).to.equal(11);
        expect(stall.observedMs).to.be.greaterThan(500);
        expect(stall.thresholdMs).to.equal(500);
        expect(stall.message).to.include("worker 11");
        expect(stall.message).to.include("> 500ms");

        await peer.dispose();
    });
});

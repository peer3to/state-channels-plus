import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

describe("E2E: Spectate stale-proof guard", function () {
    it("aborts sync when on-chain snapshot is more advanced than what participant proved", async function () {
        const h = TestSession.getHarness();

        await h.lifecycle.start(2, 0, {
            timeConfig: {
                p2pTime: 5,
                agreementTime: 2,
                chainFallbackTime: 2,
                evidenceTime: 10
            }
        });

        await h.transition.advanceState({
            count: 4,
            waitForFinalization: true
        });
        await h.transition.postSnapshotWait();

        const staleBlockHeight = 1;

        // step 1 - stub both participants to respond with a stale proof. handler
        // body lives in test/harness/worker-handlers/index.ts under
        // "spectate.respondWithStaleProof"; staleBlockHeight rides handlerArgs.
        for (const peerIndex of [0, 1]) {
            await h.rpcStub.installNamedStub({
                peerIndex,
                serviceName: "spectateService",
                methodName: "onSpectateRequest",
                handlerId: "spectate.respondWithStaleProof",
                handlerArgs: { staleBlockHeight }
            });
        }

        // addPeerWait throws if the spectator doesn't reach SYNCED within the timeout.
        // With stale proofs, the guard aborts every sync attempt, so SYNCED is never reached.
        let threwTimeout = false;
        try {
            await h.join.addSpectatorWait({ statusTimeoutMs: 5000 });
        } catch (e: any) {
            threwTimeout = true;
        }

        expect(threwTimeout).to.equal(
            true,
            "Spectator should not have reached SYNCED with stale proofs"
        );

        const spectator = h.getPeer(2);
        expect(
            spectator.stateManager.p2pManager.openConnections.length
        ).to.equal(0, "Spectator should have 0 open connections after abort");
    });
});

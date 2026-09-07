// @spec-test-coverage-ignore: authored-leave fallback staging for mapped runtime cases
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { id, ZeroHash } from "ethers";

export async function assertAuthoredLeaveFallback(
    slow: boolean,
    failure: "missing-marker" | "evidence-expired" | "success"
) {
    const h = TestSession.getHarness();
    await h.lifecycle.start(3, 0, { timeConfig: { evidenceTime: 20 } });
    const leaver = h.getPeer(1);
    const withheld = h.getPeer(2);
    const forkId = h.activeForkId!;
    if (!slow)
        await h.control(leaver).stub.failPostStateSnapshotWait().request();
    const recorder = await h.rpcStub.recordDisputeSubmissions(
        leaver.index,
        failure === "success"
            ? { forward: true }
            : {
                  failWith: {
                      customError:
                          failure === "evidence-expired"
                              ? "RaceConditionDisputeEvidencePeriodExpired"
                              : undefined,
                      message: "Dispute send failed",
                      at: "send"
                  }
              }
    );
    let restored = false;
    let authored: Promise<unknown> | undefined;
    leaver.p2pInstance.events.on("p2pEventHooks", "onLeaveTurn", () => {
        authored = (async () => {
            if (slow)
                await h
                    .control(withheld)
                    .stub.holdNextSignature({
                        forkId,
                        participant: leaver.address,
                        transactionSelector: id("leaveChannel()").slice(0, 10)
                    })
                    .request();
            return leaver.p2pInstance.p2pContractInstance.leaveChannel();
        })();
    });
    const leave = leaver.p2pInstance.leaveChannel();
    const outcome = leave.then(
        () => ({ error: null }),
        (error) => ({ error: String(error) })
    );
    try {
        // The exit can start before a generic tip wait observes the trigger block.
        // Wait for the explicit leave barriers below; one exit signature is held.
        await h.transition.advanceState({ waitForSync: false });
        await h.event.waitForPeers("onLeaveTurn", [leaver.index], 1);
        await authored;
        await h.event.waitUntilLeavePhase(leaver.index, "exit-authored");
        // A late task belonging to another fork cannot reject this operation.
        await h.execOnHost(
            leaver,
            async (sm, { oldFork }) => {
                sm.leaveChannelService.onExitFallbackFailed(
                    oldFork,
                    new Error("stale exit failure")
                );
            },
            { oldFork: ZeroHash }
        );
        await h.event.waitUntilLeavePhase(leaver.index, "exit-authored");
        if (slow)
            await waitFor(
                async () =>
                    (await h
                        .control(withheld)
                        .stub.getNextSignatureEntered()
                        .request()) === 1
            );
        await waitFor(async () => (await recorder.submissions()).length === 1);
        expect(await recorder.submissions()).to.have.length(1);
        if (failure === "success") {
            await recorder.restore();
            await h
                .control(leaver)
                .stub.restorePostStateSnapshotWait()
                .request();
            await h.control(withheld).stub.releaseNextSignature().request();
            restored = true;
            await h.dispute.resolveDisputeWait({
                forkId,
                honestPeerIndices: [0, 2],
                assertMaliciousRemoved: false
            });
            expect(await outcome).to.deep.equal({ error: null });
        } else {
            const result = await outcome;
            expect(result.error).to.include(
                failure === "evidence-expired"
                    ? "RaceConditionDisputeEvidencePeriodExpired"
                    : "Terminal channel leave failed to start a dispute"
            );
            expect(
                await h.control(leaver).query.didIDispute(forkId).request()
            ).to.equal(false);
        }
    } finally {
        if (!restored) {
            await recorder.restore();
            await h.control(withheld).stub.releaseNextSignature().request();
            await h
                .control(leaver)
                .stub.restorePostStateSnapshotWait()
                .request();
        }
    }
}

export async function assertExitFallbackFailureGuards() {
    const h = TestSession.getHarness();
    await h.lifecycle.start(3, 0);
    const peer = h.getPeer(1);
    const notify = () =>
        h.execOnHost(peer, async (sm) => {
            sm.leaveChannelService.onExitFallbackFailed(
                sm.forkId,
                new Error("irrelevant exit failure")
            );
        });
    await notify();
    const leave = peer.p2pInstance.leaveChannel();
    const outcome = leave.catch((error) => String(error));
    await h.event.waitUntilLeavePhase(peer.index, "awaiting-exit");
    await notify();
    await h.event.waitUntilLeavePhase(peer.index, "awaiting-exit");
    await peer.p2pInstance.dispose();
    expect(await outcome).to.include("disposed");
}

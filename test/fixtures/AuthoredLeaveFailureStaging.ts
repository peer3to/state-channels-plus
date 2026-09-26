// @spec-test-coverage-ignore: authored-leave fallback staging for mapped runtime cases
import { addressesEqual } from "@/utils";
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
        } else if (failure === "evidence-expired") {
            // the chain refuses the fallback when the fork's window already
            // holds commitments -> the leave waits for that window to settle
            await h.event.waitUntilLeavePhase(
                leaver.index,
                "awaiting-settlement"
            );
            expect(
                await h.control(leaver).query.didIDispute(forkId).request()
            ).to.equal(false);
            if (!slow) {
                await recorder.restore();
                await h
                    .control(leaver)
                    .stub.restorePostStateSnapshotWait()
                    .request();
                restored = true;
                // a committed self-removal stands in for that window; its
                // reduction drops the fully signed leaver
                await h.dispute.suppressDisputeInitiation([leaver.index]);
                await h.dispute.selfRemoveViaDisputeWait({
                    leaverIndex: leaver.index,
                    forkId
                });
                await h.dispute.resolveDisputeWait({
                    forkId,
                    honestPeerIndices: [0, 2],
                    assertMaliciousRemoved: false
                });
                expect(await outcome).to.deep.equal({ error: null });
                for (const peer of [h.getPeer(0), withheld]) {
                    const participants = await h
                        .control(peer)
                        .query.getParticipants()
                        .request();
                    expect(
                        participants.some((participant) =>
                            addressesEqual(participant, leaver.address)
                        )
                    ).to.equal(false);
                }
            }
        } else {
            const result = await outcome;
            expect(result.error).to.include(
                "Terminal channel leave failed to start a dispute"
            );
            expect(
                await h.control(leaver).query.didIDispute(forkId).request()
            ).to.equal(false);
            // A rejected leave leaves membership indeterminate, so the runtime
            // stays bound: a repeated leave reports the same failure instead
            // of departing twice, and another target is still refused.
            const repeated = await leaver.p2pInstance.leaveChannel().then(
                () => ({ error: null }),
                (error) => ({ error: String(error) })
            );
            await expect(
                leaver.p2pInstance.p2pSigner.connectToChannel(
                    id("target-after-rejected-leave")
                )
            ).to.be.rejectedWith("channel leave is pending");
            expect({
                repeated,
                channelId: await h
                    .control(leaver)
                    .query.getChannelId()
                    .request()
            }).to.deep.equal({ repeated: result, channelId: h.channelId });
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

// @spec-test-coverage-ignore: authored-leave fallback staging for mapped runtime cases
import { addressesEqual } from "@/utils";
import {
    releaseAfterEvidencePeriod,
    selfRemovalForks
} from "@test/fixtures/CoveredSelfRemovalStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { id, ZeroHash } from "ethers";

export async function assertAuthoredLeaveFallback(
    slow: boolean,
    failure: "missing-marker" | "evidence-expired" | "success"
) {
    const h = TestSession.getHarness();
    // The evidence-expired refusal is the contract's own: peer 0's voluntary
    // self-removal opens a real window on the fork, and a fourth participant
    // keeps the channel settleable once both have left.
    const covered = failure === "evidence-expired";
    await h.lifecycle.start(
        covered ? 4 : 3,
        0,
        covered
            ? { timeConfig: { agreementTime: 8, evidenceTime: 4 } }
            : { timeConfig: { evidenceTime: 20 } }
    );
    const coverer = h.getPeer(0);
    const leaver = h.getPeer(1);
    const withheld = h.getPeer(2);
    const forkId = h.activeForkId!;
    if (!slow)
        await h.control(leaver).stub.failPostStateSnapshotWait().request();
    // Held reductions keep the covering window unsettled until the leave has
    // been seen waiting for it.
    if (covered)
        for (const peer of h.peers)
            await h.control(peer).stub.stubHoldReductionTasks().request();
    // The covered case parks the leaver's real upload until the window stopped
    // taking evidence; the others refuse it at send or forward it.
    const recorder = await h.rpcStub.recordDisputeSubmissions(
        leaver.index,
        failure === "success"
            ? { forward: true }
            : covered
              ? { hold: true, forward: true }
              : {
                    failWith: {
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
        if (covered) {
            // Peer 0's self-removal opens the window covering the fork before
            // the fallback fires, as the other participants would. The
            // fallback's upload stays parked until that window stopped taking
            // evidence.
            await h.execOnHost(
                coverer,
                async (sm, args) => {
                    await sm.membershipService.startSelfRemovalDispute(
                        args.forkId
                    );
                },
                { forkId }
            );
            await releaseAfterEvidencePeriod(h, forkId, recorder);
        }
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
        } else if (covered) {
            // The fallback reached the chain only after the covering window
            // stopped taking evidence, so the chain refused it and the leave
            // waits for the window to settle.
            await h.event.waitUntilLeavePhase(
                leaver.index,
                "awaiting-settlement"
            );
            const [fallback] = await recorder.submissions();
            expect({
                fork: selfRemovalForks([fallback])[0],
                revert: fallback.revert?.name ?? null
            }).to.deep.equal({
                fork: String(forkId),
                revert: "RaceConditionDisputeEvidencePeriodExpired"
            });
            if (!slow) {
                // The window's settlement re-arms the leave on the settled
                // fork, where its one retried self-removal drops the leaver.
                // The leave disposes the leaver, so its stubs go back first.
                await recorder.restore();
                await h
                    .control(leaver)
                    .stub.restorePostStateSnapshotWait()
                    .request();
                restored = true;
                for (const peer of h.peers)
                    await h
                        .control(peer)
                        .stub.restoreReductionTasks(true)
                        .request();
                expect(await outcome).to.deep.equal({ error: null });
                for (const peer of [withheld, h.getPeer(3)]) {
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
            // No window covers the fork, so the refusal is not a lost race the
            // leave can wait out.
            expect(result.error).to.include(
                "Terminal channel leave failed to start a dispute"
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
            sm.leaveChannelService.onExitSelfRemovalNotStarted(sm.forkId);
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

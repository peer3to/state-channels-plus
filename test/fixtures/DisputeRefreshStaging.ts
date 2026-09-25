// @spec-test-coverage-ignore: real dispute attempts with controlled upload/read failures
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { runtimeEndpointFor } from "./RuntimeRootObservation";
import { BlockOrigin } from "@/storage/QueueStorage";
import { Codec, Type } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

export async function assertDisputeRefreshPolicy(
    h: MathPeerTestHarness,
    mode:
        | "empty"
        | "repeat"
        | "concurrent"
        | "read-failure"
        | "unrelated"
        | "disposed"
        | "ineligible"
): Promise<void> {
    if (mode === "disposed") {
        await h.lifecycle.start(3, 0, {
            configOverrides: { RUN_SDK_IN_THREAD: false }
        });
        const { host, sm, stub } = runtimeEndpointFor(h.getPeer(0).p2pInstance);
        stub.stubRecordDisputeSubmissions(
            true,
            {
                customError: "RaceConditionDisputeWindowNotOpen",
                at: "send"
            },
            false
        );
        stub.recordSlashRecoveries();
        try {
            const attempt = sm.disputeManager.dispute(sm.forkId);
            await waitFor(() => stub.getRecordedDisputeSubmissions().held > 0);
            sm.abort();
            stub.releaseDisputeSubmissions();
            await attempt;
            expect(sm.storage.disputes.didIDispute(sm.forkId)).to.equal(false);
            expect(stub.getSlashRecoveryCount()).to.equal(0);
            expect(
                stub.getRecordedDisputeSubmissions().submissions
            ).to.have.length(1);
        } finally {
            stub.releaseDisputeSubmissions();
            stub.restoreDisputeSubmissions();
            stub.restoreSlashRecoveries();
            await host.dispose();
        }
        return;
    }
    if (mode === "ineligible") {
        await h.lifecycle.start(4, 2);
        await h.scenario.disputeAndResolve({ maliciousPeerIndex: 1 });
        await h.transition.advanceState({ waitForPeers: [0, 2, 3] });
        const constructed = await h.dispute.fetchConstructedDispute(0);
        expect(await h.query.onChainSlashedParticipants(0)).to.include(
            h.getPeer(1).address
        );
        expect(constructed.dispute.input.onChainSlashes).to.not.include(
            h.getPeer(1).address
        );
        expect(constructed.dispute.input.requireExistingDisputeWindow).to.equal(
            true
        );
    } else {
        await h.lifecycle.start(3, 0);
    }
    const peer = h.getPeer(0);
    const recorder = await h.rpcStub.recordDisputeSubmissions(0, {
        hold: false,
        failWith: {
            customError:
                mode === "unrelated"
                    ? "RaceConditionDisputeEvidencePeriodExpired"
                    : "RaceConditionDisputeWindowNotOpen",
            at: "send"
        }
    });
    if (mode === "read-failure") {
        await h.control(peer).stub.stubFailOnChainSlashesRead().request();
    }
    await h.control(peer).stub.recordSlashRecoveries().request();
    const attempt = h.execOnHost(
        peer,
        async (sm, args) => {
            let error: string | null = null;
            try {
                if (args.mode === "concurrent") {
                    await Promise.all([
                        sm.disputeManager.dispute(sm.forkId),
                        sm.disputeManager.dispute(sm.forkId)
                    ]);
                } else {
                    await sm.disputeManager.dispute(sm.forkId);
                    if (args.mode === "repeat")
                        await sm.disputeManager.dispute(sm.forkId);
                }
            } catch (caught) {
                error =
                    caught instanceof Error ? caught.message : String(caught);
            }
            return {
                error,
                marker: sm.storage.disputes.didIDispute(sm.forkId)
            };
        },
        { mode }
    );
    try {
        const result = {
            ...(await attempt),
            recoveries: await h
                .control(peer)
                .stub.getSlashRecoveryCount()
                .request()
        };
        expect(result.marker).to.equal(false);
        expect(result.recoveries).to.equal(
            mode === "unrelated"
                ? 0
                : mode === "repeat" || mode === "concurrent"
                  ? 2
                  : 1
        );
        if (mode === "read-failure")
            expect(result.error).to.contain("authoritative slash read failed");
        else if (mode === "unrelated")
            expect(result.error).to.contain(
                "RaceConditionDisputeEvidencePeriodExpired"
            );
        else expect(result.error).to.equal(null);
        expect(await recorder.submissions()).to.have.length(
            mode === "repeat" || mode === "concurrent" ? 2 : 1
        );
    } finally {
        await recorder.release();
        await recorder.restore();
        await h.control(peer).stub.restoreSlashRecoveries().request();
        if (mode === "read-failure")
            await h.control(peer).stub.restoreOnChainSlashesRead().request();
    }
}

export async function assertBackgroundDisputeFailure(
    h: MathPeerTestHarness,
    runSdkInThread: boolean
): Promise<void> {
    await h.lifecycle.start(3, 2, {
        configOverrides: { RUN_SDK_IN_THREAD: runSdkInThread }
    });
    const peer = h.getPeer(0);
    const { offender, encodedBlock } =
        await h.byzantine.craftInvalidTransitionBlock(peer.index);
    const recorder = await h.rpcStub.recordDisputeSubmissions(peer.index, {
        hold: true,
        failWith: {
            customError: "RaceConditionDisputeWindowNotOpen",
            at: "send"
        }
    });
    await h.control(peer).stub.stubFailOnChainSlashesRead().request();
    let diagnostics: Promise<Error[]> | undefined;
    try {
        await h
            .control(peer)
            .transition.ingestBlockConfirmation(encodedBlock, {
                origin: BlockOrigin.PROOF
            })
            .request();
        await waitFor(async () => (await recorder.submissions()).length === 1);
        // Only the already-entered attempt is under test. Later timeout/event disputes
        // must not supply a different top-level error while this one is observed.
        await Promise.all(
            h.peers.map((other) =>
                h.dispute.suppressDisputeInitiation([other.index])
            )
        );
        // Attach the normal diagnostic drain while submission is held. The harness's
        // attribution wrapper must not be the source of the top-level report.
        diagnostics = peer.p2pInstance.quiesce();
        await waitFor(
            async () =>
                (await h
                    .control(peer)
                    .stub.getCollectedDetachedPromiseCount()
                    .request()) === 0
        );
        await recorder.release();
        expect(
            await h
                .control(peer)
                .query.getFraudProofType(offender.address)
                .request()
        ).to.not.equal(null);
        // The drain result has no TestSession observer; only the production route can report.
        await waitFor(
            () => TestSession.getFirstDetachedError() !== undefined,
            h.event.protocolEventTimeoutMs()
        );
    } finally {
        await recorder.restore();
        await h.control(peer).stub.restoreOnChainSlashesRead().request();
        await Promise.all(
            h.peers.map((other) =>
                h.control(other).stub.restoreDisputeInitiation().request()
            )
        );
        if (diagnostics) {
            const errors = await diagnostics;
            expect(errors.map((error) => error.message)).to.include(
                "authoritative slash read failed"
            );
        }
    }
}

export async function assertInboundHeadMovedDuringUpload(
    h: MathPeerTestHarness
): Promise<void> {
    await h.lifecycle.start(3, 3);
    const disputer = h.getPeer(0);
    const forkId = h.activeForkId!;
    // only the disputer uploads, and no reduction closes the window mid-test
    for (const peer of h.peers)
        await h.control(peer).stub.stubHoldReductionTasks().request();
    await h.dispute.suppressDisputeInitiation([1, 2]);
    // a stored fraud proof puts the upload in a multicall with applyFraudProofs,
    // so the refusal below reverts the whole batch, not just the upload
    await h.byzantine.storeInvalidTransitionFraudProof(disputer.index);
    // the disputer's own inbound event handler is held, so its local head
    // provably cannot advance while the join lands and the upload is checked
    const held = await h.rpcStub.holdInboundMessageEvents(disputer.index);
    const recorder = await h.rpcStub.recordDisputeSubmissions(disputer.index, {
        hold: true,
        forward: true
    });
    const attempt = h.execOnHost(
        disputer,
        async (sm, args) => {
            await sm.disputeManager.dispute(args.forkId);
            return sm.storage.disputes.didIDispute(args.forkId);
        },
        { forkId }
    );
    const localHead = () =>
        h.control(disputer).query.getLatestInboundMessageHash().request();
    try {
        // step 1 - the dispute is built and parked before its upload
        await recorder.waitUntilHeld();
        const stale = Codec.decode(
            (await recorder.submissions())[0].encodedDispute,
            Type.Dispute
        ).input;

        // step 2 - a join appends an inbound block above the parked anchor;
        // the disputer's held handler cannot apply it before the upload lands
        await h.join.forceInboundJoinWait({
            observePeerIndices: [1, 2]
        });
        await waitFor(
            async () => (await held.heldCount()) > 0,
            h.event.protocolEventTimeoutMs()
        );
        const chainHead = await h.channelManager.getChannelBalance(h.channelId);
        expect(chainHead.latestInboundMessageBlockHash).to.not.equal(
            stale.latestInboundMessageBlockHash
        );
        expect(await localHead()).to.equal(stale.latestInboundMessageBlockHash);

        // step 3 - the parked upload lands on the moved chain head and is refused;
        // local storage is assumed current by event sync, so a stale anchor is a
        // lost race, not retried
        await recorder.release();
        const disputed = await attempt;
        const submissions = await recorder.submissions();
        expect(submissions[0].revert).to.deep.equal({
            name: "RaceConditionDisputeInboundNotLatest",
            args: [
                chainHead.latestInboundMessageBlockHash,
                stale.latestInboundMessageBlockHash
            ]
        });
        expect(submissions).to.have.length(1);
        expect(disputed).to.equal(false);
        expect(await localHead()).to.equal(stale.latestInboundMessageBlockHash);
        const committed = [
            ...(await h.channelManager.queryFilter(
                h.channelManager.filters.DisputeCommitted(h.channelId)
            )),
            ...(await h.channelManager.queryFilter(
                h.channelManager.filters.DisputeCommittedWithAuditingData(
                    h.channelId
                )
            ))
        ];
        expect(committed).to.have.length(0);
        // the refused upload was multicalled with the fraud proof against the
        // offender, so the whole batch reverts and nobody is slashed either
        expect([
            ...(await h.channelManager.getOnChainSlashedParticipants(
                h.channelId
            ))
        ]).to.deep.equal([]);
    } finally {
        await recorder.release();
        await recorder.restore();
        await held.release({ replay: false });
    }
}

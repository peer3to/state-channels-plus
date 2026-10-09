// @spec-test-coverage-ignore: real dispute attempts with controlled upload/read failures
import {
    commitmentOf,
    holdReductions,
    killedDisputeLogs,
    postSpamDispute
} from "./DisputeWindowWorkflowStaging";
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { runtimeEndpointFor } from "./RuntimeRootObservation";
import { BlockOrigin } from "@/storage/QueueStorage";
import type { ForkId } from "@/types/types";
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

/**
 * A join lands between construction and upload, and the disputer's own
 * delivery of it is lost. `recoverable` loses only the delivery, so the retry
 * loads the run and lands at the new head. `unrecoverable` disables the
 * handler, so the load cannot recover the run and the dispute fails fatally.
 */
export async function assertInboundHeadMovedDuringUpload(
    h: MathPeerTestHarness,
    staging: "recoverable" | "unrecoverable"
): Promise<void> {
    await h.lifecycle.start(3, 3);
    const disputer = h.getPeer(0);
    const forkId = h.activeForkId!;
    // only the disputer uploads, and no reduction closes the window mid-test
    for (const peer of h.peers)
        await h.control(peer).stub.stubHoldReductionTasks().request();
    await h.dispute.suppressDisputeInitiation([1, 2]);
    // a stored fraud proof puts the upload last in a best-effort multicall
    // with applyFraudProofs: the refusal below is read from the receipt, and
    // the fraud proof lands anyway
    const offender = await h.byzantine.storeInvalidTransitionFraudProof(
        disputer.index
    );
    // the disputer loses that slash log, so no slash-driven dispute of its own
    // races the dispute under test
    const lost =
        staging === "recoverable"
            ? await h.rpcStub.dropEventLogs(disputer.index, [
                  "InboundMessagesProcessed",
                  "ChainSlashed"
              ])
            : await h.rpcStub.holdInboundMessageEvents(disputer.index);
    const lostSlashes =
        staging === "recoverable"
            ? undefined
            : await h.rpcStub.dropSlashLogs(disputer.index);
    const recorder = await h.rpcStub.recordDisputeSubmissions(disputer.index, {
        hold: true,
        forward: true
    });
    const attempt = h.execOnHost(
        disputer,
        async (sm, args) => {
            let error: string | null = null;
            try {
                await sm.disputeManager.dispute(args.forkId);
            } catch (caught) {
                error =
                    caught instanceof Error ? caught.message : String(caught);
            }
            return {
                error,
                disputed: sm.storage.disputes.didIDispute(args.forkId)
            };
        },
        { forkId }
    );
    const localHead = () =>
        h.control(disputer).query.getLatestInboundMessageHash().request();
    const committed = async () => [
        ...(await h.channelManager.queryFilter(
            h.channelManager.filters.DisputeCommitted(h.channelId)
        )),
        ...(await h.channelManager.queryFilter(
            h.channelManager.filters.DisputeCommittedWithAuditingData(
                h.channelId
            )
        ))
    ];
    try {
        // step 1 - the dispute is built and parked before its upload
        await recorder.waitUntilHeld();
        const stale = Codec.decode(
            (await recorder.submissions())[0].encodedDispute,
            Type.Dispute
        ).input;

        // step 2 - a join appends an inbound block above the parked anchor;
        // the disputer's own delivery of it is lost
        await h.join.forceInboundJoinWait({
            observePeerIndices: [1, 2]
        });
        await waitFor(
            async () =>
                ("droppedCount" in lost
                    ? await lost.droppedCount()
                    : await lost.heldCount()) > 0,
            h.event.protocolEventTimeoutMs()
        );
        const chainHead = await h.channelManager.getChannelBalance(h.channelId);
        expect(chainHead.latestInboundMessageBlockHash).to.not.equal(
            stale.latestInboundMessageBlockHash
        );
        expect(await localHead()).to.equal(stale.latestInboundMessageBlockHash);

        // step 3 - the parked upload lands on the moved chain head and is refused
        await recorder.release();
        const result = await attempt;
        const submissions = await recorder.submissions();
        expect(submissions[0].revert).to.deep.equal({
            name: "RaceConditionDisputeInboundNotLatest",
            args: [
                chainHead.latestInboundMessageBlockHash,
                stale.latestInboundMessageBlockHash
            ]
        });

        if (staging === "unrecoverable") {
            // the run cannot be applied -> a fatal error, no re-upload, and
            // the marker rolled back
            expect(result.error).to.equal(
                "dispute - the inbound run up to the chain's head is unavailable"
            );
            expect(submissions).to.have.length(1);
            expect(result.disputed).to.equal(false);
            expect(await localHead()).to.equal(
                stale.latestInboundMessageBlockHash
            );
            expect(await committed()).to.have.length(0);
            // only the upload was refused: the fraud proof in front of it landed
            expect([
                ...(await h.channelManager.getOnChainSlashedParticipants(
                    h.channelId
                ))
            ]).to.deep.equal([offender.address]);
            return;
        }

        // step 4 - the retry loaded the run and its upload lands, anchored at
        // the head the chain named, with the fraud proof in the same batch
        expect(result.error).to.equal(null);
        expect(result.disputed).to.equal(true);
        expect(submissions).to.have.length(2);
        expect(submissions[1].revert).to.equal(null);
        expect(submissions[1].waited).to.equal(true);
        const retried = Codec.decode(
            submissions[1].encodedDispute,
            Type.Dispute
        ).input;
        expect(retried.latestInboundMessageBlockHash).to.equal(
            chainHead.latestInboundMessageBlockHash
        );
        expect(Number(retried.lastInboundMessageBlockHeight)).to.equal(
            Number(chainHead.latestInboundMessageBlockHeight)
        );
        expect(await localHead()).to.equal(
            chainHead.latestInboundMessageBlockHash
        );
        expect(await committed()).to.have.length(1);
        expect([
            ...(await h.channelManager.getOnChainSlashedParticipants(
                h.channelId
            ))
        ]).to.deep.equal([offender.address]);
    } finally {
        await recorder.release();
        await recorder.restore();
        if ("droppedCount" in lost) await lost.release();
        else await lost.release({ replay: false });
        await lostSlashes?.release();
    }
}

const INBOUND_NOT_LATEST = "RaceConditionDisputeInboundNotLatest";

type MathPeer = ReturnType<MathPeerTestHarness["getPeer"]>;

/** `dispute(forkId)` on the host; its error and the marker after it. */
function disputeCapturingError(
    h: MathPeerTestHarness,
    peer: MathPeer,
    forkId: ForkId
): Promise<{ error: string | null; disputed: boolean }> {
    return h.execOnHost(
        peer,
        async (sm, args) => {
            let error: string | null = null;
            try {
                await sm.disputeManager.dispute(args.forkId);
            } catch (caught) {
                error =
                    caught instanceof Error ? caught.message : String(caught);
            }
            return {
                error,
                disputed: sm.storage.disputes.didIDispute(args.forkId)
            };
        },
        { forkId }
    );
}

function inboundAnchorOf(submission: { encodedDispute: string }): string {
    return Codec.decode(submission.encodedDispute, Type.Dispute).input
        .latestInboundMessageBlockHash as string;
}

function localInboundHead(h: MathPeerTestHarness, peer: MathPeer) {
    return h.control(peer).query.getLatestInboundMessageHash().request();
}

/**
 * A join moves the chain's inbound head while the disputer's own delivery of
 * it is lost, so the disputer's local head (its dispute anchor) stays below
 * the chain's head. The dropped log stays recoverable by query.
 */
async function moveInboundHeadPastDisputer(
    h: MathPeerTestHarness,
    disputer: MathPeer,
    observePeerIndices: number[]
) {
    const lost = await h.rpcStub.dropInboundMessageLogs(disputer.index);
    await h.join.forceInboundJoinWait({ observePeerIndices });
    await lost.waitUntilDropped();
    const { latestInboundMessageBlockHash: chainHead } =
        await h.channelManager.getChannelBalance(h.channelId);
    const anchor = await localInboundHead(h, disputer);
    expect(anchor).to.be.a("string").and.not.equal(chainHead);
    return { lost, chainHead, anchor: anchor! };
}

/**
 * The chain refuses the upload with the inbound head it holds, the retry
 * loads the run up to that head, and the chain refuses the retry again at the
 * same head: no progress, so the dispute fails fatally, rolls the marker back
 * and does not upload a third time.
 */
export async function assertInboundRetryRefusedAtSameHead(
    h: MathPeerTestHarness
): Promise<void> {
    await h.lifecycle.start(3, 3);
    const disputer = h.getPeer(0);
    const forkId = h.activeForkId!;
    for (const peer of h.peers)
        await h.control(peer).stub.stubHoldReductionTasks().request();
    await h.dispute.suppressDisputeInitiation([1, 2]);
    const { lost, chainHead, anchor } = await moveInboundHeadPastDisputer(
        h,
        disputer,
        [1, 2]
    );
    const recorder = await h.rpcStub.recordDisputeSubmissions(disputer.index, {
        failWith: {
            customError: INBOUND_NOT_LATEST,
            customErrorArgs: [chainHead, anchor],
            at: "send"
        }
    });
    try {
        const result = await disputeCapturingError(h, disputer, forkId);
        const submissions = await recorder.submissions();

        expect(result.error).to.equal(
            `${INBOUND_NOT_LATEST} (args: ${chainHead}, ${anchor})`
        );
        expect(result.disputed).to.equal(false);
        // the first upload anchors at the local head, the retry at the
        // chain's head it loaded; nothing after the second refusal
        expect(submissions.map(inboundAnchorOf)).to.deep.equal([
            anchor,
            chainHead
        ]);
        expect(await localInboundHead(h, disputer)).to.equal(chainHead);
    } finally {
        await recorder.restore();
        await lost.release();
    }
}

/**
 * The chain refuses the upload with an inbound head equal to the dispute's
 * own anchor: the anchor hash is the chain's head, so its height is wrong and
 * loading the run cannot fix it. The dispute fails fatally with no retry.
 */
export async function assertInboundRefusalAtOwnAnchor(
    h: MathPeerTestHarness
): Promise<void> {
    await h.lifecycle.start(3, 0);
    const disputer = h.getPeer(0);
    const anchor = await localInboundHead(h, disputer);
    expect(anchor).to.be.a("string");
    const recorder = await h.rpcStub.recordDisputeSubmissions(disputer.index, {
        failWith: {
            customError: INBOUND_NOT_LATEST,
            customErrorArgs: [anchor!, anchor!],
            at: "send"
        }
    });
    try {
        const result = await disputeCapturingError(
            h,
            disputer,
            h.activeForkId!
        );
        const submissions = await recorder.submissions();

        expect(result.error).to.equal(
            `${INBOUND_NOT_LATEST} (args: ${anchor}, ${anchor})`
        );
        expect(result.disputed).to.equal(false);
        expect(submissions.map(inboundAnchorOf)).to.deep.equal([anchor]);
    } finally {
        await recorder.restore();
    }
}

/**
 * Four peers. A consumed top-up join moves the inbound head from `older` to
 * `head`; then reductions are held. The auditor (peer 0) kills spammer 1's
 * invalid dispute with `dispute(forkId, { kill })`. The chain refuses joins
 * while the fork is disputed, so its inbound head cannot move under an open
 * window: the recorder refuses that multicall as a chain at `head` refuses an
 * upload anchored at `older`. The kill is then sent alone, and the retry
 * loads the run up to `head`, uploads without the kill and lands, counting
 * the killed spammer's slash.
 */
export async function assertInboundRefusalOfKillCarryingDispute(
    h: MathPeerTestHarness
): Promise<void> {
    await h.scenario.preDisputeSetup({ peerCount: 4 });
    const forkId = h.activeForkId!;
    const auditor = h.getPeer(0);
    const spammer = h.getPeer(1);
    const older = await localInboundHead(h, auditor);
    await h.join.forceInboundJoinWait({ participant: auditor.address });
    await h.transition.advanceState({ count: 2, waitForFinalization: true });
    await h.assert.sync.peersInSyncWait();
    const { latestInboundMessageBlockHash: head } =
        await h.channelManager.getChannelBalance(h.channelId);
    expect(await localInboundHead(h, auditor)).to.equal(head);
    expect(older).to.be.a("string").and.not.equal(head);

    for (const index of [1, 2, 3]) await h.rpcStub.suppressDisputeKill(index);
    await holdReductions(h);
    const uploads = await h.rpcStub.recordDisputeSubmissions(auditor.index, {
        forward: true,
        failWith: {
            customError: INBOUND_NOT_LATEST,
            customErrorArgs: [head, older!],
            times: 1,
            at: "send"
        }
    });
    const loneKills = await h.rpcStub.recordDisputeFraudProofApplies(
        auditor.index
    );
    try {
        const spam = await postSpamDispute(h, spammer.index);
        await waitFor(
            async () =>
                (await uploads.submissions()).some(
                    (submission) => submission.waited
                ),
            h.event.protocolEventTimeoutMs()
        );
        const submissions = await uploads.submissions();
        expect(submissions).to.have.length(2);
        const [refused, retried] = submissions;

        // the refused multicall carried the kill in front of the upload
        expect(refused.method).to.equal("multicallBestEffortLast");
        expect(refused.innerMethods[0]).to.equal("applyDisputeFraudProofs");
        expect(refused.waited).to.equal(false);

        // the kill went alone and landed
        const kills = await loneKills.applies();
        expect(kills).to.have.length(1);
        expect(kills[0].participants).to.deep.equal([spammer.address]);
        expect(kills[0].error).to.equal(null);
        expect(kills[0].waited).to.equal(true);
        const killed = await killedDisputeLogs(h);
        expect(killed.map((log) => log.disputer)).to.deep.equal([
            spammer.address
        ]);

        // the retry carries no kill, anchors at the chain's head, counts the
        // killed spammer's slash and lands
        expect([retried.method, ...retried.innerMethods]).to.not.include(
            "applyDisputeFraudProofs"
        );
        expect(retried.revert).to.equal(null);
        expect(retried.waited).to.equal(true);
        const own = Codec.decode(retried.encodedDispute, Type.Dispute);
        expect(own.input.latestInboundMessageBlockHash).to.equal(head);
        expect(own.input.onChainSlashes).to.include(spammer.address);
        const commitments = await h.channelManager.getWindowCommitments(
            h.channelId,
            forkId
        );
        expect(commitments).to.include(commitmentOf(own));
        expect(commitments).to.not.include(commitmentOf(spam));
        expect(
            await h.control(auditor).query.didIDispute(forkId).request()
        ).to.equal(true);
    } finally {
        await uploads.restore();
        await loneKills.restore();
    }
}

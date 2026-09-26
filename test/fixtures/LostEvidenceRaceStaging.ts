import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { BlockOrigin } from "@/storage/QueueStorage";
import { timeoutWaitTime } from "@/types";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { id } from "ethers";

/** Which observation-driven upload the case drives. */
export type LostRaceTrigger = "onChainSlashed" | "onDisputeKilled";

/** Which directly called upload the case drives. */
export type LostRaceCaller = "startSelfRemovalDispute" | "createTimeOutDispute";

const LOST_RACE_REFUSAL = {
    customError: "RaceConditionDisputeEvidencePeriodExpired",
    at: "send"
} as const;

/**
 * Every honest observer of the same trigger uploads replacement evidence and
 * all but the first are refused, so the loser's handler must still succeed.
 * The trigger is a real on-chain event: a kill that empties the window, or a
 * slash applied on its own to an undisputed fork. The observer's refusal is
 * staged at send; the handler resolved when the event pipeline completes the
 * trigger's block, since a handler that throws holds that block forever.
 */
export async function assertLostEvidenceRaceTolerated(
    h: MathPeerTestHarness,
    trigger: LostRaceTrigger
): Promise<void> {
    const { observerIndex, triggerBlock, recorder } =
        trigger === "onDisputeKilled"
            ? await stageRealKill(h)
            : await stageRealSlash(h);
    try {
        const observer = h.getPeer(observerIndex);
        await waitFor(
            async () =>
                ((await h
                    .control(observer)
                    .query.getLatestProcessedEventBlock()
                    .request()) ?? -1) >= triggerBlock,
            h.event.protocolEventTimeoutMs(),
            50
        );
        expect((await recorder.submissions()).length).to.equal(1);
    } finally {
        await recorder.restore();
    }
}

/**
 * A kill that empties the window: every other peer's dispute initiation is
 * suppressed, so the observer's replacement upload is the only one and the
 * refusal stands in for the peer that got there first.
 */
async function stageRealKill(h: MathPeerTestHarness) {
    // Four peers race one automatic kill against a window of one-second
    // blocks; the harness evidence floor gives that race room. Approved
    // timeConfig change (plan 30, decision 5).
    await h.scenario.preDisputeSetup({
        peerCount: 4,
        timeConfig: { evidenceTime: 6 }
    });
    const observer = h.getPeer(0);
    const forkId = h.activeForkId!;
    await h.dispute.suppressDisputeInitiation(
        h.peers.filter((p) => p !== observer).map((p) => p.index)
    );
    const recorder = await h.rpcStub.recordDisputeSubmissions(
        observer.index,
        { failWith: LOST_RACE_REFUSAL }
    );
    await h.tamper.postTamperedDispute(2, (dispute) => {
        dispute.outputSnapshotDataHash = id("lost-race-invalid-output");
    });
    await h.event.waitForPeers("onDisputeKilled", [observer.index], 1, {
        mode: "atLeast"
    });
    expect(
        await h.channelManager.getWindowCommitments(h.channelId, forkId)
    ).to.have.length(0);
    const [killedLog] = await h.channelManager.queryFilter(
        h.channelManager.filters.DisputeKilled(h.channelId)
    );
    if (!killedLog) throw new Error("The kill log is missing");
    return {
        observerIndex: observer.index,
        triggerBlock: killedLog.blockNumber,
        recorder
    };
}

/**
 * A slash on an undisputed fork: one participant holding a real
 * InvalidStateTransition fraud proof applies it on its own, without a
 * dispute. Dispute initiation stays suppressed everywhere except on the
 * observer, which reaches the upload through its `ChainSlashed` handler.
 */
async function stageRealSlash(h: MathPeerTestHarness) {
    await h.lifecycle.start(3, 2);
    const applier = h.getPeer(2);
    await h.dispute.suppressDisputeInitiation(h.peers.map((p) => p.index));
    const offender = await h.byzantine.storeInvalidTransitionFraudProof(
        applier.index
    );
    const observer = h.peers.find(
        (p) => p !== applier && p.address !== offender.address
    )!;
    await h.control(observer).stub.restoreDisputeInitiation().request();
    const recorder = await h.rpcStub.recordDisputeSubmissions(
        observer.index,
        { failWith: LOST_RACE_REFUSAL }
    );
    // Single-use: a participant applying a stored proof outside a dispute,
    // which the routed facet function allows but the SDK never does itself.
    const slashBlock = await h.execOnHost(
        applier,
        async (sm, args) => {
            const proof = sm.storage.fraudProofs.getFraudProofForParticipant(
                args.offender
            );
            if (!proof) throw new Error("The stored fraud proof is missing");
            const tx = await sm.stateChannelManagerContract.applyFraudProofs(
                [proof],
                { channelId: sm.channelId }
            );
            const receipt = await tx.wait();
            if (!receipt) throw new Error("The fraud proof was not mined");
            return receipt.blockNumber;
        },
        { offender: offender.address }
    );
    expect(await h.query.onChainSlashedParticipants(applier.index)).to.include(
        offender.address
    );
    expect(await h.channelManager.isForkDisputed(h.channelId, h.activeForkId!))
        .to.be.false;
    return { observerIndex: observer.index, triggerBlock: slashBlock, recorder };
}

/**
 * The direct callers of an upload lose the same race: a self-removal dispute
 * and a participant-timeout dispute, each refused as past the evidence
 * deadline. The caller must resolve after exactly one upload attempt, and a
 * self-removal reports that it did not dispute.
 */
export async function assertLostRaceCallerTolerated(
    h: MathPeerTestHarness,
    caller: LostRaceCaller
): Promise<void> {
    await h.lifecycle.start(3, 0);
    const peer = h.getPeer(1);
    const forkId = h.activeForkId!;
    const recorder = await h.rpcStub.recordDisputeSubmissions(peer.index, {
        failWith: LOST_RACE_REFUSAL
    });
    try {
        const outcome = await h.execOnHost(
            peer,
            async (sm, args) => {
                try {
                    if (args.caller === "startSelfRemovalDispute") {
                        return {
                            disputed:
                                await sm.membershipService.startSelfRemovalDispute(
                                    args.forkId
                                ),
                            rejected: ""
                        };
                    }
                    const snapshot = sm.storage.getPreviousBlockOrSnapshot({
                        forkId: args.forkId,
                        height: 0
                    }).stateSnapshot!;
                    // The real timeout constructor for the first writer's
                    // missed block, at the deadline it would compute.
                    await sm.participantTimeoutService["createTimeOutDispute"](
                        args.forkId,
                        0,
                        args.writer,
                        snapshot.timestamp + args.timeoutWait
                    );
                    return {
                        disputed: sm.storage.disputes.didIDispute(args.forkId),
                        rejected: ""
                    };
                } catch (error) {
                    return {
                        disputed: sm.storage.disputes.didIDispute(args.forkId),
                        rejected:
                            error instanceof Error
                                ? error.message
                                : String(error)
                    };
                }
            },
            {
                caller,
                forkId,
                writer: h.getPeer(0).address,
                timeoutWait: timeoutWaitTime(
                    await h.execOnHost(peer, (sm) => sm.timeConfig),
                    0
                )
            }
        );
        expect({
            ...outcome,
            uploads: (await recorder.submissions()).length
        }).to.deep.equal({ disputed: false, rejected: "", uploads: 1 });
    } finally {
        await recorder.restore();
    }
}

/**
 * Fraud found in the block pipeline requests a detached dispute. When that
 * upload loses the race, the detached attempt must settle without reaching
 * the top-level error funnel.
 */
export async function assertRequestDisputeLostRaceTolerated(
    h: MathPeerTestHarness
): Promise<void> {
    await h.lifecycle.start(3, 2);
    const peer = h.getPeer(0);
    await h.dispute.suppressDisputeInitiation(
        h.peers.filter((p) => p !== peer).map((p) => p.index)
    );
    const { encodedBlock } = await h.byzantine.craftInvalidTransitionBlock(
        peer.index
    );
    const recorder = await h.rpcStub.recordDisputeSubmissions(peer.index, {
        failWith: LOST_RACE_REFUSAL
    });
    try {
        await h
            .control(peer)
            .transition.ingestBlockConfirmation(encodedBlock, {
                origin: BlockOrigin.PROOF
            })
            .request();
        await waitFor(
            async () => (await recorder.submissions()).length === 1,
            h.event.protocolEventTimeoutMs(),
            50
        );
        // Drains every detached promise, the requested attempt included,
        // and throws on the first one that reached the error funnel.
        await TestSession.settleDetached();
        expect(await recorder.submissions()).to.have.length(1);
    } finally {
        await recorder.restore();
    }
}

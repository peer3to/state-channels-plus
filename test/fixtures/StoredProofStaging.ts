// @spec-test-coverage-ignore: stored proof staging exercised by explicit AgreementManagerStoredProof and E2E-StoredProof declarations
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import StateSnapshot from "@/models/StateSnapshot";
import type { SyncPayload } from "@/types";
import type { ForkId } from "@/types/types";
import { Codec, Type } from "@/utils";
import {
    evidenceBlockHashesAt,
    stageBlindPendingAuditor
} from "@test/fixtures/DisputeAuditStaging";
import {
    proofHeights,
    servedPayload,
    syncFromResponder
} from "@test/fixtures/MilestoneSyncStaging";
import {
    buildProofView,
    dropStoredBlock,
    localFinalizedView,
    stageFinalThenUnfinalizedTail
} from "@test/fixtures/ProofOwnerStaging";
import {
    conflictingBlock,
    installState,
    syncWithHeldInstall
} from "@test/fixtures/SyncInstallStaging";
import { stageSpectatorBehindUnfinalizedTail } from "@test/fixtures/SyncReplayBaseStaging";
import { expect } from "chai";

type Peer = ReturnType<MathPeerTestHarness["getPeer"]>;

type SnapshotPoint = { hash: string; height: number };

/** A peer's stored proof of one fork as plain values. */
export type StoredProofView = {
    anchor: SnapshotPoint;
    /** the block heights of each hop's milestone */
    hopHeights: number[][];
    finalized: SnapshotPoint;
    /** the stored state hashes to the final point's state hash */
    isStateHeld: boolean;
    /** the whole record, `Type.StoredProof`-encoded, to compare two reads */
    encoded: string;
};

/**
 * Peer `peerIndex`'s stored proof of `forkId` (default: its active fork)
 * once its queued stored-proof writes are done; null when none is stored.
 */
export async function storedProofView(
    h: MathPeerTestHarness,
    peerIndex: number,
    forkId?: ForkId
): Promise<StoredProofView | null> {
    return h.execOnHost(
        h.getPeer(peerIndex),
        async (sm, args, modules) => {
            const am = sm.agreementManager;
            const forkId = args.forkId ?? sm.forkId;
            // its read waits for the queued stored-proof writes
            await am.getLocalFinalizedSnapshot(forkId);
            const stored = sm.storage.storedProofs.get(forkId);
            const genesis =
                sm.storage.stateSnapshots.getGenesisSnapshotByForkId(forkId);
            if (!stored || !genesis) return null;
            const snapshotType = genesis.constructor as typeof StateSnapshot;
            const point = (struct: typeof stored.anchorSnapshot) => ({
                hash: String(snapshotType.from(struct).hash),
                height: Number(struct.blockHeight)
            });
            return {
                anchor: point(stored.anchorSnapshot),
                hopHeights: stored.hops.map((hop) =>
                    hop.milestone.blockConfirmations.map(
                        (confirmation) =>
                            am.getLastBlockFromMilestone({
                                blockConfirmations: [confirmation]
                            })!.height
                    )
                ),
                finalized: point(stored.finalizedSnapshot),
                isStateHeld:
                    modules.ethers.keccak256(stored.encodedFinalizedState) ===
                    stored.finalizedSnapshot.snapshotData.stateMachineStateHash,
                encoded: String(
                    modules.Codec.encode(stored, modules.Type.StoredProof)
                )
            };
        },
        { forkId: forkId ?? null }
    );
}

/**
 * The heights of the final points in peer `peerIndex`'s stored proof of
 * `forkId`, in hop order: each hop's first block. Empty when none is stored.
 */
export async function storedFinalPointHeights(
    h: MathPeerTestHarness,
    peerIndex: number,
    forkId?: ForkId
): Promise<number[]> {
    const view = await storedProofView(h, peerIndex, forkId);
    return (view?.hopHeights ?? []).map(([pointHeight]) => pointHeight);
}

/** The final point a sync payload proves: its last milestone's first block. */
function servedFinalPoint(payload: SyncPayload): SnapshotPoint {
    return {
        hash: String(
            StateSnapshot.from(payload.milestoneSnapshots.at(-1)!).hash
        ),
        height: proofHeights(payload).at(-1)![0]
    };
}

/**
 * The spectator stands below the served final point and syncs: the install
 * writes the served final point, with its state, as its stored proof.
 */
export async function assertSyncAdvancesStoredProof(
    h: MathPeerTestHarness
): Promise<void> {
    const { forkId, spectator, responder, tip } =
        await stageSpectatorBehindUnfinalizedTail(h, {
            finalBlocksWhileCutOff: 1
        });
    const served = servedFinalPoint(await servedPayload(h, responder, forkId));
    const before = await storedProofView(h, spectator.index, forkId);
    // premise - the spectator's own final point is below the served one
    expect(before, "the spectator's stored proof").to.not.equal(null);
    expect(before!.finalized.height).to.be.lessThan(served.height);

    const sync = await syncFromResponder(h, spectator, responder, forkId, tip);
    const after = await storedProofView(h, spectator.index, forkId);

    expect(sync.synced).to.equal(true);
    expect(after!.finalized).to.deep.equal(served);
    expect(after!.isStateHeld).to.equal(true);
}

/**
 * The spectator already holds the served final point as its own: the sync
 * keeps the local state and the stored proof is not written.
 */
export async function assertSyncKeepsNotNewerStoredProof(
    h: MathPeerTestHarness
): Promise<void> {
    const { forkId, spectator, responder, tip } =
        await stageSpectatorBehindUnfinalizedTail(h, {
            finalBlocksWhileCutOff: 0
        });
    const served = servedFinalPoint(await servedPayload(h, responder, forkId));
    const before = await storedProofView(h, spectator.index, forkId);
    // premise - the spectator's own final point is the served one
    expect(before, "the spectator's stored proof").to.not.equal(null);
    expect(before!.finalized).to.deep.equal(served);

    const sync = await syncFromResponder(h, spectator, responder, forkId, tip);
    const after = await storedProofView(h, spectator.index, forkId);

    expect(sync.synced).to.equal(true);
    expect(after).to.deep.equal(before);
}

/**
 * The spectator's sync stages the stored proof of the served final point,
 * then its install is held before the VM write. In that window, with
 * `"conflict"` a different block is stored at the served final point's
 * height (the commit then finds the conflict); with `"storedProofChanged"`
 * the stored proof is dropped, as another writer replacing it would. Either
 * way the install aborts: neither the state nor the stored proof the sync
 * staged is published.
 */
export async function assertAbortedInstallPublishesNoStoredProof(
    h: MathPeerTestHarness,
    duringHold: "conflict" | "storedProofChanged"
): Promise<void> {
    const { sync, before, after, installBefore, installAfter } =
        await syncWithInstallInterrupted(h, duringHold);

    expect(sync.synced).to.equal(false);
    expect(installAfter).to.deep.equal(installBefore);
    if (duringHold === "conflict") expect(after).to.deep.equal(before);
    else expect(after, "the dropped stored proof").to.equal(null);
}

/**
 * An install aborted because the stored proof changed after the sync staged
 * its own is no fault of the responder: no rejection, it is not
 * blacklisted.
 */
export async function assertStaleAbortKeepsResponder(
    h: MathPeerTestHarness
): Promise<void> {
    const { sync } = await syncWithInstallInterrupted(h, "storedProofChanged");

    expect(sync).to.deep.include({
        synced: false,
        rejections: [],
        blacklisted: false
    });
}

async function syncWithInstallInterrupted(
    h: MathPeerTestHarness,
    duringHold: "conflict" | "storedProofChanged"
) {
    const { forkId, spectator, responder, tip } =
        await stageSpectatorBehindUnfinalizedTail(h, {
            finalBlocksWhileCutOff: 1
        });
    const payload = await servedPayload(h, responder, forkId);
    const served = servedFinalPoint(payload);
    const before = await storedProofView(h, spectator.index, forkId);
    // premise - the spectator holds its own, earlier final point
    expect(before, "the spectator's stored proof").to.not.equal(null);
    expect(before!.finalized.height).to.be.lessThan(served.height);
    const installBefore = await installState(h, spectator, forkId);
    const block = await conflictingBlock(
        payload,
        served.height,
        spectator.signer
    );

    const sync = await syncWithHeldInstall(
        h,
        { requester: spectator, responder, forkId, tip },
        async () => {
            if (duringHold === "storedProofChanged") {
                await h.execOnHost(
                    spectator,
                    (sm, args) => sm.storage.storedProofs.delete(args.forkId),
                    { forkId }
                );
                return;
            }
            expect(
                await h
                    .control(spectator)
                    .spectate.storeBlockJustPersist(
                        Codec.encode(
                            block.signedBlock,
                            Type.SignedBlock
                        ) as string
                    )
                    .request()
            ).to.equal(block.hash);
        }
    );
    return {
        sync,
        before,
        after: await storedProofView(h, spectator.index, forkId),
        installBefore,
        installAfter: await installState(h, spectator, forkId)
    };
}

/**
 * A pending auditor below the head audits a dispute: the audit verifies the
 * head, a later final point than the auditor's own, and keeps it as proof
 * evidence. The stored proof is unchanged.
 */
export async function assertAuditKeepsStoredProof(
    h: MathPeerTestHarness
): Promise<void> {
    await h.scenario.preDisputeSetup();
    const forkId = h.activeForkId!;
    const { auditorIndex, headHeight } = await stageBlindPendingAuditor(
        h,
        [0, 1, 2]
    );
    await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
    const { dispute, auditingData } =
        await h.dispute.fetchConstructedDispute(0);
    const before = await storedProofView(h, auditorIndex, forkId);
    // premise - the auditor's own final point is below the head
    expect(before, "the auditor's stored proof").to.not.equal(null);
    expect(before!.finalized.height).to.be.lessThan(headHeight);

    await h.dispute.auditDispute(
        auditorIndex,
        dispute,
        dispute.postedAuditingData ? auditingData : undefined
    );
    const after = await storedProofView(h, auditorIndex, forkId);

    // premise - the audit verified the head and kept it as evidence
    expect(
        await evidenceBlockHashesAt(h, auditorIndex, forkId, headHeight),
        "the audit kept the verified head"
    ).to.have.length(1);
    expect(after).to.deep.equal(before);
}

/**
 * After a dispute moves the channel to a new fork, an advance of the old
 * fork's stored proof (queued before the change) runs: it writes nothing,
 * and the new fork's stored proof stays.
 */
export async function assertOldForkAdvanceKeepsActiveStoredProof(
    h: MathPeerTestHarness
): Promise<void> {
    const { originalForkId, newForkId, honestPeerIndices } =
        await h.scenario.fourPeersDisputeResolution();
    const peerIndex = honestPeerIndices[0];
    const before = await storedProofView(h, peerIndex, newForkId);
    // premise - the new fork's stored proof is the only one
    expect(before, "the new fork's stored proof").to.not.equal(null);
    expect(await storedProofView(h, peerIndex, originalForkId)).to.equal(null);

    await h.execOnHost(
        h.getPeer(peerIndex),
        (sm, args) => sm.agreementManager.advanceStoredProof(args.forkId),
        { forkId: originalForkId }
    );
    const after = await storedProofView(h, peerIndex, newForkId);

    expect(after, "the new fork's stored proof").to.not.equal(null);
    expect(after!.anchor).to.deep.equal(before!.anchor);
    expect(await storedProofView(h, peerIndex, originalForkId)).to.equal(null);
}

/**
 * Blocks 0..1 final, then an unfinalized tail. The observer drops its
 * stored final block: its stored final point and the proof it builds are
 * unchanged (the stored proof is never checked against storage).
 */
export async function assertHistoryEditKeepsStoredFinalPoint(
    h: MathPeerTestHarness
): Promise<void> {
    const { observerIndex } = await stageFinalThenUnfinalizedTail(h, {
        postAnchor: false
    });
    const finalized = await localFinalizedView(h, observerIndex);
    const proofBefore = await buildProofView(h, observerIndex);
    const storedBefore = await storedProofView(h, observerIndex);
    // premise - block 1 is the stored final point
    expect(finalized?.height).to.equal(1);
    expect(storedBefore!.finalized.hash).to.equal(finalized!.hash);

    await dropStoredBlock(h, observerIndex, finalized!.height);

    expect(await localFinalizedView(h, observerIndex)).to.deep.equal(finalized);
    expect(await storedProofView(h, observerIndex)).to.deep.equal(storedBefore);
    const proofAfter = await buildProofView(h, observerIndex);
    expect(proofAfter.milestoneHeights).to.deep.equal(
        proofBefore.milestoneHeights
    );
    expect(proofAfter.finalized.hash).to.equal(finalized!.hash);
}

/**
 * Three peers, blocks 0..1 final, then a snapshot update: every peer's
 * stored proof is re-rooted at the posted snapshot. A later final block then
 * advances it above that anchor.
 */
export async function assertSnapshotUpdateReRootsStoredProof(
    h: MathPeerTestHarness
): Promise<void> {
    await h.lifecycle.start(3, 0);
    const peerIndices = h.peers.map((peer) => peer.index);
    await h.transition.advanceState({
        count: 2,
        waitForPeers: peerIndices,
        waitForFinalization: true
    });
    await h.assert.sync.peersInSyncWait({ peerIndices });
    h.event.resetEventSpies();

    const posted = await h.transition.postSnapshot();
    expect(posted, "the posted snapshot").to.not.equal(undefined);
    // the event is published once the handler, and so the re-root's
    // enqueue, is done
    await h.event.waitForEventCounts(
        "onStateSnapshotUpdated",
        peerIndices.map((peerId) => ({ peerId, expectedCount: 1 })),
        h.event.protocolEventTimeoutMs(),
        { mode: "atLeast" }
    );
    for (const peerIndex of peerIndices) {
        const view = await storedProofView(h, peerIndex);
        expect(view, `peer ${peerIndex}'s stored proof`).to.not.equal(null);
        expect(view!.anchor).to.deep.equal({
            hash: String(posted!.hash),
            height: Number(posted!.blockHeight)
        });
        expect(view!.isStateHeld).to.equal(true);
    }

    await h.transition.advanceState({
        count: 1,
        waitForPeers: peerIndices,
        waitForFinalization: true
    });
    for (const peerIndex of peerIndices) {
        const view = await storedProofView(h, peerIndex);
        expect(view!.anchor.hash).to.equal(String(posted!.hash));
        expect(view!.finalized.height).to.be.greaterThan(
            Number(posted!.blockHeight)
        );
    }
}

/**
 * Four peers; a dispute resolves onto a reduced fork. Each honest peer's
 * stored proof is on the new fork, rooted at its installed genesis (or at
 * the chain snapshot a later update posted), with the state; the old fork
 * has none. A final block on the new fork then advances it.
 */
export async function assertForkChangeResetsStoredProof(
    h: MathPeerTestHarness
): Promise<void> {
    const { originalForkId, newForkId, honestPeerIndices } =
        await h.scenario.fourPeersDisputeResolution();
    const anchorsBefore: SnapshotPoint[] = [];
    for (const peerIndex of honestPeerIndices) {
        const view = await storedProofView(h, peerIndex, newForkId);
        const peer = h.getPeer(peerIndex);
        const roots = [
            await genesisHash(h, peer, newForkId),
            String((await h.query.getLocalStateSnapshot(peer)).hash)
        ];
        expect(view, `peer ${peerIndex}'s stored proof`).to.not.equal(null);
        expect(roots).to.include(view!.anchor.hash);
        expect(view!.isStateHeld).to.equal(true);
        expect(await storedProofView(h, peerIndex, originalForkId)).to.equal(
            null
        );
        anchorsBefore.push(view!.anchor);
    }

    await h.transition.fromHonestPeersOnly((c) => c.add(1), {
        waitForFinalization: true
    });
    for (const [i, peerIndex] of honestPeerIndices.entries()) {
        const view = await storedProofView(h, peerIndex, newForkId);
        // block 0 of the new fork is at the genesis height: compare hashes
        expect(view!.hopHeights, "the proven hops").to.not.be.empty;
        expect(view!.finalized.hash).to.not.equal(anchorsBefore[i].hash);
    }
}

async function genesisHash(
    h: MathPeerTestHarness,
    peer: Peer,
    forkId: ForkId
): Promise<string> {
    return h.execOnHost(
        peer,
        (sm, args) =>
            String(
                sm.storage.stateSnapshots.getGenesisSnapshotByForkId(
                    args.forkId
                )!.hash
            ),
        { forkId }
    );
}

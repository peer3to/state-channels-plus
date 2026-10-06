import StateSnapshot from "@/models/StateSnapshot";
import { stageAnchoredSyncPayload } from "@test/fixtures/HistoricSyncStaging";
import {
    chainSnapshot,
    servedPayload
} from "@test/fixtures/MilestoneSyncStaging";
import {
    applyOnFreshRequester,
    constructProof,
    craftProofBlock,
    postSnapshotAt,
    proofHeights,
    servedBlock,
    servedProjections,
    servedRunPayload,
    servingProof,
    servedState,
    snapshotWithout,
    stageAnchoredHistory,
    stageConflictingOverlapPayload,
    stageMergedSignaturePayload,
    stageUnpostedLeave,
    stageSeparatedEvidencePayload,
    storedBlocks,
    syncSpectatorOnServedPayload
} from "@test/fixtures/SyncProofStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

// A fresh requester (a held spectator with no history of its own) applies
// served payloads through the real `applySyncResponse`, then rebuilds its
// own proof with `AgreementManager.buildStateProof` and walks it on chain.
describe("Unit: SpectateService sync persistence and reconstruction", function () {
    describe("proof start below the receiver's finalized state", function () {
        it("U54/U56: a proof from the anchor reaching the receiver's own finalized head → accepted again without installing its state again or re-running a block, stored blocks, signers and state unchanged", async function () {
            const h = TestSession.getHarness();
            const { forkId, anchor, payload, latestHeight } =
                await stageAnchoredHistory(h, { blocksAfter: 2 });
            const heights = proofHeights(payload).flat();
            const tipStateHash = await h
                .control(h.getPeer(0))
                .query.getLatestStateMachineStateHash(forkId)
                .request();
            const outcome = await applyOnFreshRequester(
                h,
                forkId,
                [payload, payload],
                { inspect: { heights }, readLocalFinality: true }
            );
            expect(outcome.outcomes).to.deep.equal([
                { accepted: true, threw: "", head: latestHeight },
                { accepted: true, threw: "", head: latestHeight }
            ]);
            // premise: the receiver's finality is above the proof start
            expect(outcome.localFinalizedHeights[0]).to.be.greaterThan(
                anchor.blockHeight
            );
            // the second apply keeps what the receiver already holds
            expect(outcome.stateWrites).to.deep.equal([1, 0]);
            expect(outcome.replays[1]).to.equal(0);
            expect(outcome.rejections).to.deep.equal([]);
            expect(outcome.blacklisted).to.equal(false);
            expect(outcome.installedStateHash).to.equal(tipStateHash);
            expect(outcome.blocks).to.deep.equal(
                servedProjections(payload, heights)
            );
        });

        it("U54/U56: a proof from the anchor reaching past the receiver's finalized head → accepted, the newer state installed and blocks persisted, the earlier blocks and signers unchanged", async function () {
            const h = TestSession.getHarness();
            const staged = await stageAnchoredHistory(h, { blocksAfter: 2 });
            const older = staged.payload;
            await h.transition.advanceState({
                count: 2,
                waitForPeers: [0, 1, 2],
                waitForFinalization: true
            });
            const newer = await servedPayload(h, h.getPeer(0), staged.forkId);
            const tip = staged.latestHeight + 2;
            const newerHeights = proofHeights(newer).flat();
            const olderOnly = proofHeights(older)
                .flat()
                .filter((height) => !newerHeights.includes(height));
            const tipStateHash = await h
                .control(h.getPeer(0))
                .query.getLatestStateMachineStateHash(staged.forkId)
                .request();
            const outcome = await applyOnFreshRequester(
                h,
                staged.forkId,
                [older, newer],
                {
                    inspect: { heights: [...olderOnly, ...newerHeights] },
                    readLocalFinality: true
                }
            );
            expect(outcome.outcomes).to.deep.equal([
                { accepted: true, threw: "", head: staged.latestHeight },
                { accepted: true, threw: "", head: tip }
            ]);
            // premise: the receiver's finality is above the newer proof's start
            expect(outcome.localFinalizedHeights[0]).to.be.greaterThan(
                staged.anchor.blockHeight
            );
            expect(outcome.stateWrites).to.deep.equal([1, 1]);
            expect(outcome.rejections).to.deep.equal([]);
            expect(outcome.blacklisted).to.equal(false);
            expect(outcome.installedStateHash).to.equal(tipStateHash);
            expect(outcome.blocks.slice(0, olderOnly.length)).to.deep.equal(
                servedProjections(older, olderOnly)
            );
            expect(
                outcome.blocks
                    .slice(olderOnly.length)
                    .map((block) => block?.hash)
            ).to.deep.equal(
                servedProjections(newer, newerHeights).map(
                    (block) => block?.hash
                )
            );
        });

        it("U56/E08: an honest responder's valid proof ending below the receiver's finalized state → rejected, proof ends below the finalized state, responder blacklisted, receiver head unchanged", async function () {
            const h = TestSession.getHarness();
            // the older proof is what an honest responder that restarted
            // before the newer blocks would still serve
            const staged = await stageAnchoredHistory(h, { blocksAfter: 2 });
            const older = staged.payload;
            await h.transition.advanceState({
                count: 2,
                waitForPeers: [0, 1, 2],
                waitForFinalization: true
            });
            const newer = await servedPayload(h, h.getPeer(0), staged.forkId);
            const tip = staged.latestHeight + 2;
            const outcome = await applyOnFreshRequester(h, staged.forkId, [
                newer,
                older
            ]);
            expect(outcome.outcomes).to.deep.equal([
                { accepted: true, threw: "", head: tip },
                { accepted: false, threw: "", head: tip }
            ]);
            expect(outcome.rejections).to.deep.equal([
                "proof ends below the finalized state"
            ]);
            expect(outcome.blacklisted).to.equal(true);
        });

        it("U55: a receiver holding the anchor state is served an earlier genuine state with the run through the tip → its own state replays the run, accepted, not blacklisted", async function () {
            const h = TestSession.getHarness();
            // peer 2 is cut off: the run above the anchor stays unfinal
            const { forkId, anchor, latestHeight, payload } =
                await stageAnchoredHistory(h, {
                    blocksAfter: 2,
                    cutPeer: true
                });
            const a = anchor.blockHeight;
            const anchorBlock = await servedBlock(h, forkId, a);
            const ownAnchor = servingProof(
                payload,
                [[anchorBlock.confirmation]],
                [anchor.toStruct()],
                await servedState(h, anchor.toStruct())
            );
            // the run a..tip served with the state before the anchor
            const earlier = await servedBlock(h, forkId, a - 1);
            const { payload: earlierState } = await servedRunPayload(
                h,
                forkId,
                payload,
                { from: a, to: latestHeight },
                earlier.snapshot
            );
            const tipStateHash = await h
                .control(h.getPeer(0))
                .query.getLatestStateMachineStateHash(forkId)
                .request();
            const outcome = await applyOnFreshRequester(h, forkId, [
                ownAnchor,
                earlierState
            ]);
            expect(outcome.outcomes).to.deep.equal([
                { accepted: true, threw: "", head: a },
                { accepted: true, threw: "", head: latestHeight }
            ]);
            expect(outcome.rejections).to.deep.equal([]);
            expect(outcome.blacklisted).to.equal(false);
            expect(outcome.installedStateHash).to.equal(tipStateHash);
        });
    });

    describe("persistence from the observed anchor", function () {
        it("U57: a run served from an older anchor while the chain anchor moved into it → accepted, the material from the new anchor on is kept, the rebuilt proof starts at the new anchor and verifies on chain", async function () {
            const h = TestSession.getHarness();
            const { forkId, anchor, latestHeight, payload } =
                await stageAnchoredHistory(h, { blocksAfter: 2 });
            const a = anchor.blockHeight;
            const moved = await postSnapshotAt(h, 0, latestHeight);
            await h.transition.advanceState({
                count: 2,
                waitForPeers: [0, 1, 2],
                waitForFinalization: true
            });
            const tip = latestHeight + 2;
            // what a responder whose local diamond still holds anchor a serves
            const { payload: lagging } = await servedRunPayload(
                h,
                forkId,
                payload,
                { from: a, to: tip },
                anchor.toStruct()
            );
            const kept = [moved.blockHeight, moved.blockHeight + 1, tip];
            const served = await storedBlocks(h, h.getPeer(0), forkId, kept);
            const outcome = await applyOnFreshRequester(h, forkId, [lagging], {
                inspect: { heights: kept },
                reconstruct: true
            });
            expect(outcome.outcomes).to.deep.equal([
                { accepted: true, threw: "", head: tip }
            ]);
            expect(outcome.rejections).to.deep.equal([]);
            expect(outcome.blacklisted).to.equal(false);
            expect(outcome.blocks.map((block) => block?.hash)).to.deep.equal(
                served.map((block) => block?.hash)
            );
            expect(outcome.rebuilt).to.deep.include({
                chainValid: true,
                startHeight: moved.blockHeight
            });
            expect(
                outcome
                    .rebuilt!.milestones.flat()
                    .every((height) => height >= moved.blockHeight)
            ).to.equal(true);
        });

        it("U58: a proof carrying a finalized participant change above the construction anchor → the change point is stored and the rebuilt proof proves that hop and verifies on chain", async function () {
            const h = TestSession.getHarness();
            const { forkId, changeHeight, remaining, release } =
                await stageUnpostedLeave(h);
            try {
                expect(
                    (await chainSnapshot(h)).isGenesis,
                    "exit unposted"
                ).to.equal(true);
                const responderIndex = remaining[0];
                const payload = await servedPayload(
                    h,
                    h.getPeer(responderIndex),
                    forkId
                );
                const outcome = await applyOnFreshRequester(
                    h,
                    forkId,
                    [payload],
                    {
                        responderIndex,
                        reconstruct: true
                    }
                );
                expect(outcome.outcomes[0]).to.deep.include({
                    accepted: true,
                    threw: ""
                });
                expect(outcome.rejections).to.deep.equal([]);
                expect(outcome.changeHeights).to.include(changeHeight);
                expect(outcome.rebuilt!.chainValid).to.equal(true);
                expect(
                    outcome.rebuilt!.milestones.map((milestone) => milestone[0])
                ).to.include(changeHeight);
                expect(outcome.rebuilt!.milestones.length).to.be.greaterThan(1);
            } finally {
                await release();
            }
        });

        it("U59: a second proof verified from the receiver's local finalized state, ahead of the chain anchor → the rebuilt proof still starts at the local diamond anchor and verifies on chain", async function () {
            const h = TestSession.getHarness();
            const staged = await stageAnchoredHistory(h, { blocksAfter: 2 });
            await h.transition.advanceState({
                count: 2,
                waitForPeers: [0, 1, 2],
                waitForFinalization: true
            });
            const newer = await servedPayload(h, h.getPeer(0), staged.forkId);
            const tip = staged.latestHeight + 2;
            const outcome = await applyOnFreshRequester(
                h,
                staged.forkId,
                [staged.payload, newer],
                { observeWalks: true, reconstruct: true }
            );
            expect(outcome.outcomes).to.deep.equal([
                { accepted: true, threw: "", head: staged.latestHeight },
                { accepted: true, threw: "", head: tip }
            ]);
            // the first proof meets no local final point (the local diamond
            // decides); the second is accepted from the local finalized state
            expect(outcome.walks!.storage.local.answers).to.deep.equal([true]);
            expect(outcome.walks!.storage.chain.reads).to.equal(0);
            expect(outcome.walks!.trustedStart.local.answers).to.include(true);
            expect(outcome.rebuilt).to.deep.include({
                chainValid: true,
                startHeight: staged.anchor.blockHeight,
                latestProofHeight: tip
            });
        });

        it("U60: already-known verified data applied again, then a proof adding later data → the view is kept without a state install or block re-run, then the additions persist without changing earlier blocks or signers", async function () {
            const h = TestSession.getHarness();
            const staged = await stageAnchoredHistory(h, { blocksAfter: 2 });
            await h.transition.advanceState({
                count: 2,
                waitForPeers: [0, 1, 2],
                waitForFinalization: true
            });
            const newer = await servedPayload(h, h.getPeer(0), staged.forkId);
            const tip = staged.latestHeight + 2;
            const olderHeights = proofHeights(staged.payload).flat();
            const tipStateHash = await h
                .control(h.getPeer(0))
                .query.getLatestStateMachineStateHash(staged.forkId)
                .request();
            const outcome = await applyOnFreshRequester(
                h,
                staged.forkId,
                [staged.payload, staged.payload, newer],
                { inspect: { heights: olderHeights }, reconstruct: true }
            );
            expect(outcome.outcomes).to.deep.equal([
                { accepted: true, threw: "", head: staged.latestHeight },
                { accepted: true, threw: "", head: staged.latestHeight },
                { accepted: true, threw: "", head: tip }
            ]);
            expect(outcome.stateWrites).to.deep.equal([1, 0, 1]);
            expect(outcome.replays[1]).to.equal(0);
            expect(outcome.rejections).to.deep.equal([]);
            expect(outcome.blacklisted).to.equal(false);
            expect(outcome.installedStateHash).to.equal(tipStateHash);
            // the newer proof starts above the older blocks or repeats them
            // with the signatures the payload carries
            expect(outcome.blocks.map((block) => block?.hash)).to.deep.equal(
                servedProjections(staged.payload, olderHeights).map(
                    (block) => block?.hash
                )
            );
            expect(outcome.rebuilt!.chainValid).to.equal(true);
        });

        it("U61: a valid unfinal replay tail at the spectating entry → its blocks, snapshots and states persist and the view advances to the tail end", async function () {
            const h = TestSession.getHarness();
            // peer 2 is cut off: the run above the anchor stays unfinal
            const { forkId, anchor, latestHeight, payload } =
                await stageAnchoredHistory(h, {
                    blocksAfter: 2,
                    cutPeer: true
                });
            const a = anchor.blockHeight;
            expect(proofHeights(payload)).to.deep.equal([[a, a + 1, a + 2]]);
            const tail = [
                await servedBlock(h, forkId, a + 1),
                await servedBlock(h, forkId, a + 2)
            ];
            const snapshots = tail.map((block) =>
                StateSnapshot.from(block.snapshot)
            );
            const outcome = await applyOnFreshRequester(h, forkId, [payload], {
                inspect: {
                    heights: [a + 1, a + 2],
                    snapshotHashes: snapshots.map((snapshot) =>
                        String(snapshot.hash)
                    ),
                    stateHashes: snapshots.map((snapshot) =>
                        String(snapshot.stateMachineStateHash)
                    )
                }
            });
            expect(outcome.outcomes).to.deep.equal([
                { accepted: true, threw: "", head: latestHeight }
            ]);
            expect(outcome.blocks.map((block) => block?.hash)).to.deep.equal(
                tail.map((block) => block.hash)
            );
            expect(outcome.snapshotsStored).to.deep.equal([true, true]);
            expect(outcome.statesStored).to.deep.equal([true, true]);
        });
    });

    describe("skipped material", function () {
        it("U81: a milestone wholly below the anchor whose snapshot drops a participant → accepted, its block, snapshot and change point are not stored, the rebuilt proof verifies from the anchor", async function () {
            const h = TestSession.getHarness();
            const { forkId, onChainSnapshot, payload, latestHeight } =
                await stageAnchoredSyncPayload(h);
            const height = onChainSnapshot.blockHeight - 1;
            const changed = snapshotWithout(
                payload.milestoneSnapshots[0],
                height,
                h.getPeer(2).address
            );
            const forged = await craftProofBlock(h, {
                authorIndex: 0,
                forkId: String(forkId),
                height,
                stateSnapshotHash: changed.hash
            });
            payload.stateProof.milestones.unshift({
                blockConfirmations: [forged.confirmation]
            });
            payload.milestoneSnapshots.unshift(changed.toStruct());
            const outcome = await applyOnFreshRequester(
                h,
                String(forkId),
                [payload],
                {
                    inspect: {
                        heights: [height],
                        snapshotHashes: [String(changed.hash)]
                    },
                    reconstruct: true
                }
            );
            expect(outcome.outcomes).to.deep.equal([
                { accepted: true, threw: "", head: latestHeight }
            ]);
            expect(outcome.rejections).to.deep.equal([]);
            expect(outcome.blacklisted).to.equal(false);
            expect(outcome.blocks).to.deep.equal([null]);
            expect(outcome.snapshotsStored).to.deep.equal([false]);
            expect(outcome.changeHeights).to.not.include(height);
            expect(outcome.rebuilt).to.deep.include({
                chainValid: true,
                startHeight: onChainSnapshot.blockHeight
            });
        });

        it("U81: a forged block before the anchor inside the run holding the anchor, its snapshot dropping a participant → accepted from the anchor, its block, snapshot and change point are not stored, the rebuilt proof verifies", async function () {
            const h = TestSession.getHarness();
            const { forkId, anchor, latestHeight, payload } =
                await stageAnchoredHistory(h, { blocksAfter: 2 });
            const a = anchor.blockHeight;
            const { payload: run } = await servedRunPayload(
                h,
                forkId,
                payload,
                { from: a, to: latestHeight },
                anchor.toStruct()
            );
            const height = a - 1;
            const changed = snapshotWithout(
                anchor.toStruct(),
                height,
                h.getPeer(2).address
            );
            const forged = await craftProofBlock(h, {
                authorIndex: 0,
                forkId,
                height,
                stateSnapshotHash: changed.hash
            });
            run.stateProof.milestones[0].blockConfirmations.unshift(
                forged.confirmation
            );
            run.milestoneSnapshots[0] = changed.toStruct();
            const outcome = await applyOnFreshRequester(h, forkId, [run], {
                inspect: {
                    heights: [height],
                    snapshotHashes: [String(changed.hash)]
                },
                reconstruct: true
            });
            expect(outcome.outcomes).to.deep.equal([
                { accepted: true, threw: "", head: latestHeight }
            ]);
            expect(outcome.rejections).to.deep.equal([]);
            expect(outcome.blacklisted).to.equal(false);
            expect(outcome.blocks).to.deep.equal([null]);
            expect(outcome.snapshotsStored).to.deep.equal([false]);
            expect(outcome.changeHeights).to.deep.equal([]);
            expect(outcome.rebuilt).to.deep.include({
                chainValid: true,
                startHeight: a
            });
        });
    });

    describe("retained evidence", function () {
        it("U82: a milestone whose threshold needs a signature on its later linked block → the support block keeps that signature, the gap block is never stored, the proof rebuilt through the support block proves that hop with it and verifies", async function () {
            const h = TestSession.getHarness();
            const { forkId, latestHeight, payload, first, support, gapHeight } =
                await stageSeparatedEvidencePayload(h);
            // rebuilt through the support block: only its retained signature
            // completes the first block's threshold
            const outcome = await applyOnFreshRequester(h, forkId, [payload], {
                inspect: {
                    heights: [first.height, support.height, gapHeight]
                },
                reconstruct: true,
                reconstructHeight: support.height
            });
            expect(outcome.outcomes).to.deep.equal([
                { accepted: true, threw: "", head: latestHeight }
            ]);
            expect(outcome.rejections).to.deep.equal([]);
            expect(outcome.blacklisted).to.equal(false);
            expect(outcome.blocks).to.deep.equal([
                first.block,
                support.block,
                null
            ]);
            expect(outcome.rebuilt).to.deep.include({
                chainValid: true,
                latestProofHeight: support.height
            });
            expect(outcome.rebuilt!.milestones).to.deep.equal([
                [first.height, support.height]
            ]);
        });

        it("U82: verified support blocks are stored at once without their own replay → neither their resulting snapshot nor their state is stored", async function () {
            const h = TestSession.getHarness();
            const { forkId, payload, support } =
                await stageSeparatedEvidencePayload(h);
            const outcome = await applyOnFreshRequester(h, forkId, [payload], {
                inspect: {
                    heights: [support.height],
                    snapshotHashes: [String(support.snapshot.hash)],
                    stateHashes: [
                        String(support.snapshot.stateMachineStateHash)
                    ]
                }
            });
            expect(outcome.outcomes[0]).to.deep.include({
                accepted: true,
                threw: ""
            });
            expect(outcome.blocks).to.deep.equal([support.block]);
            expect(outcome.snapshotsStored).to.deep.equal([false]);
            expect(outcome.statesStored).to.deep.equal([false]);
        });

        it("U83: two occurrences of one block carry different signatures the threshold needs → stored merged, the tail replays, the proof rebuilt through that block proves it final on its own merged signatures and verifies", async function () {
            const h = TestSession.getHarness();
            const { forkId, payload, first, support, tail } =
                await stageMergedSignaturePayload(h);
            // rebuilt through the merged block: neither occurrence alone
            // makes it a one-block milestone
            const outcome = await applyOnFreshRequester(h, forkId, [payload], {
                inspect: {
                    heights: [first.height, support.height, tail.height]
                },
                reconstruct: true,
                reconstructHeight: support.height
            });
            expect(outcome.outcomes).to.deep.equal([
                { accepted: true, threw: "", head: tail.height }
            ]);
            expect(outcome.rejections).to.deep.equal([]);
            expect(outcome.blacklisted).to.equal(false);
            expect(outcome.blocks[0]).to.deep.equal(first.block);
            expect(outcome.blocks[1]).to.deep.equal(support.block);
            expect(outcome.blocks[2]?.hash).to.equal(tail.hash);
            expect(outcome.rebuilt).to.deep.include({
                chainValid: true,
                latestProofHeight: support.height
            });
            expect(outcome.rebuilt!.milestones).to.deep.equal([
                [support.height]
            ]);
        });

        it("U123: the second occurrence of the overlapping block carries other contents under the same height and author → not the same authenticated block: rejected, milestones invalid, nothing of the proof stored", async function () {
            const h = TestSession.getHarness();
            const { forkId, payload, first, support, tail } =
                await stageConflictingOverlapPayload(h);
            const outcome = await applyOnFreshRequester(h, forkId, [payload], {
                inspect: {
                    heights: [first.height, support.height, tail.height]
                }
            });
            expect(outcome.outcomes).to.deep.equal([
                { accepted: false, threw: "", head: -1 }
            ]);
            expect(outcome.rejections).to.deep.equal(["milestones invalid"]);
            expect(outcome.blacklisted).to.equal(true);
            expect(outcome.blocks).to.deep.equal([null, null, null]);
        });

        it("U84: a threshold hop above the anchor with no run back to it → accepted, the gap history is never stored, the rebuilt proof verifies from the anchor", async function () {
            const h = TestSession.getHarness();
            const { forkId, onChainSnapshot, payload, latestHeight } =
                await stageAnchoredSyncPayload(h);
            const firstHeight = proofHeights(payload)[0][0];
            const gap: number[] = [];
            for (
                let height = onChainSnapshot.blockHeight;
                height < firstHeight;
                height++
            )
                gap.push(height);
            expect(gap.length).to.be.greaterThan(0);
            const outcome = await applyOnFreshRequester(
                h,
                String(forkId),
                [payload],
                { inspect: { heights: gap }, reconstruct: true }
            );
            expect(outcome.outcomes).to.deep.equal([
                { accepted: true, threw: "", head: latestHeight }
            ]);
            expect(outcome.blocks).to.deep.equal(gap.map(() => null));
            expect(outcome.rebuilt).to.deep.include({
                chainValid: true,
                startHeight: onChainSnapshot.blockHeight
            });
        });

        it("U85: a synced spectator follows two more final blocks → its rebuilt proof reaches the new head and verifies, the synced evidence is still stored", async function () {
            const h = TestSession.getHarness();
            const { forkId, latestHeight, payload, first, support } =
                await stageSeparatedEvidencePayload(h);
            const spectator = await syncSpectatorOnServedPayload(h, payload);
            await h.transition.advanceState({
                count: 2,
                waitForPeers: [0, 1, 2],
                waitForFinalization: true
            });
            await h.assert.sync.peersInSyncWait({
                peerIndices: [0, 1, 2, spectator.index]
            });
            const rebuilt = await constructProof(h, spectator.index);
            expect(rebuilt.chainValid).to.equal(true);
            expect(rebuilt.latestProofHeight).to.equal(latestHeight + 2);
            expect(
                await storedBlocks(h, spectator, forkId, [
                    first.height,
                    support.height
                ])
            ).to.deep.equal([first.block, support.block]);
        });

        it("U85: the chain adopts a newer anchor after the sync and local progress → the rebuilt proof starts at it and needs none of the older evidence, which stays stored", async function () {
            const h = TestSession.getHarness();
            const { forkId, latestHeight, payload, first, support } =
                await stageSeparatedEvidencePayload(h);
            const spectator = await syncSpectatorOnServedPayload(h, payload);
            await h.transition.advanceState({
                count: 1,
                waitForPeers: [0, 1, 2],
                waitForFinalization: true
            });
            await h.assert.sync.peersInSyncWait({
                peerIndices: [0, 1, 2, spectator.index]
            });
            const later = await postSnapshotAt(h, 0, latestHeight + 1);
            const rebuilt = await constructProof(h, spectator.index);
            expect(rebuilt).to.deep.include({
                chainValid: true,
                startHeight: later.blockHeight
            });
            expect(
                rebuilt.milestones
                    .flat()
                    .every((height) => height >= later.blockHeight)
            ).to.equal(true);
            expect(
                await storedBlocks(h, spectator, forkId, [
                    first.height,
                    support.height
                ])
            ).to.deep.equal([first.block, support.block]);
        });
    });
});

import Block from "@/models/Block";
import StateSnapshot from "@/models/StateSnapshot";
import { chainAcceptsDisputeProof } from "@test/fixtures/ChainProofVerdict";
import {
    forgedOutboundBlock,
    stageAnchoredSyncPayload,
    stageOutboundAroundAnchor
} from "@test/fixtures/HistoricSyncStaging";
import { servedPayload } from "@test/fixtures/MilestoneSyncStaging";
import { proofHeights } from "@test/fixtures/MilestoneSyncStaging";
import {
    localFinalizedView,
    stageFinalBlocks,
    postSnapshotFrom,
    storedConfirmations
} from "@test/fixtures/ProofOwnerStaging";
import {
    applyAfterMissedTopUp,
    withHeldFreshRequester,
    holdCanonicalProofWalk,
    applyOnFreshRequester,
    applyPayloads,
    craftProofBlock,
    servedBlock,
    servingConflictAt,
    stageAnchoredHistory,
    syncAboveHeldQueuedBlock
} from "@test/fixtures/SyncProofStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";

// The spectating entry point verifies a served proof from the latest
// trusted start: the local finalized state, then the local diamond's
// anchor, then the chain's. The walks are observed record-only: the
// trusted-start walk on the local diamond, and `verifyMilestones` on the
// local diamond (local) and on the chain (chain).
describe("Unit: SpectateService sync proof verification order", function () {
    it("RR1: sync persists only the checked region when the chain anchor advances across malformed skipped history", async function () {
        const h = TestSession.getHarness();
        const { forkId } = await stageFinalBlocks(h, {
            postAnchor: true,
            finalBlocks: 2
        });
        const payload = await servedPayload(h, h.getPeer(0), forkId);
        payload.stateProof.milestones.unshift({
            blockConfirmations: [
                {
                    signedBlock: { encodedBlock: "0x", signature: "0x" },
                    signatures: []
                },
                (await storedConfirmations(h, 0, [2]))[0]
            ]
        });
        payload.milestoneSnapshots.unshift(payload.milestoneSnapshots[0]);
        await withHeldFreshRequester(h, async (requester) => {
            const hold = await holdCanonicalProofWalk(h, requester);
            const applying = applyPayloads(
                h,
                requester,
                String(forkId),
                [payload],
                { inspect: { heights: [0, 1, 2, 3] }, reconstruct: true }
            );
            applying.catch(() => undefined);
            try {
                await waitFor(hold.entered);
                expect(await postSnapshotFrom(h, 0)).to.equal(true);
                await hold.release();
                const outcome = await applying;
                expect(outcome.outcomes).to.deep.equal([
                    { accepted: true, threw: "", head: 3 }
                ]);
                expect(outcome.blocks.slice(0, 3)).to.deep.equal([
                    null,
                    null,
                    null
                ]);
                expect(outcome.blocks[3]).to.not.equal(null);
                expect(outcome.blacklisted).to.equal(false);
                expect(outcome.rejections).to.deep.equal([]);
            } finally {
                await hold.release();
                await Promise.allSettled([applying]);
            }
        });
    });

    it("U26: a participant requester whose local finalized state verifies the proof → accepted at that tier, the local diamond and chain walks never run", async function () {
        const h = TestSession.getHarness();
        const { forkId, requester, payload, latestHeight } =
            await stageAnchoredSyncPayload(h);
        const outcome = await applyPayloads(
            h,
            h.getPeer(requester.index),
            String(forkId),
            [payload],
            { observeWalks: true }
        );
        expect(outcome.outcomes).to.deep.equal([
            { accepted: true, threw: "", head: latestHeight }
        ]);
        expect(outcome.rejections).to.deep.equal([]);
        expect(outcome.blacklisted).to.equal(false);
        expect(outcome.walks!.trustedStart.local.answers).to.include(true);
        expect(outcome.walks!.storage.local.reads).to.equal(0);
        expect(outcome.walks!.storage.chain.reads).to.equal(0);
    });

    it("U26: the local finalized tier accepts the proof but a forged latest-fork outbound block still fails its independent check → rejected, latest-fork outbound blocks invalid", async function () {
        const h = TestSession.getHarness();
        const { forkId, requester, payload } =
            await stageAnchoredSyncPayload(h);
        payload.outboundMessageBlocksOfTheLatestFork.push(
            forgedOutboundBlock(payload)
        );
        const outcome = await applyPayloads(
            h,
            h.getPeer(requester.index),
            String(forkId),
            [payload],
            { observeWalks: true }
        );
        expect(outcome.outcomes[0].accepted).to.equal(false);
        expect(outcome.outcomes[0].threw).to.equal("");
        expect(outcome.rejections).to.deep.equal([
            "latest-fork outbound blocks invalid"
        ]);
        expect(outcome.walks!.trustedStart.local.answers).to.include(true);
        expect(outcome.walks!.storage.local.reads).to.equal(0);
        expect(outcome.walks!.storage.chain.reads).to.equal(0);
    });

    it("U27: a fresh requester with no local finalized state → the tier is skipped, the local diamond walk accepts, the chain walk never runs", async function () {
        const h = TestSession.getHarness();
        const { forkId, payload, latestHeight } =
            await stageAnchoredSyncPayload(h);
        const outcome = await applyOnFreshRequester(
            h,
            String(forkId),
            [payload],
            { observeWalks: true }
        );
        expect(outcome.outcomes).to.deep.equal([
            { accepted: true, threw: "", head: latestHeight }
        ]);
        expect(outcome.rejections).to.deep.equal([]);
        expect(outcome.blacklisted).to.equal(false);
        expect(outcome.walks!.trustedStart.local.reads).to.equal(0);
        expect(outcome.walks!.storage.local.answers).to.deep.equal([true]);
        expect(outcome.walks!.storage.chain.reads).to.equal(0);
    });

    it("U27: a fresh requester whose chain anchor holds the fork's first outbound block and a later exit sits above it → served and stored is only the block above the anchor; its dispute carries that block and the chain accepts it", async function () {
        const h = TestSession.getHarness();
        const { forkId, anchor, remaining } = await stageOutboundAroundAnchor(
            h,
            { finalBlocks: 2 }
        );
        const anchorHead = anchor.latestOutboundMessageBlockHash;
        expect(anchor.latestOutboundMessageBlockHeight).to.equal(1);
        await withHeldFreshRequester(h, async (requester) => {
            const outcome = await applyPayloads(
                h,
                requester,
                String(forkId),
                ["served"],
                { observeWalks: true, responderIndex: remaining[0] }
            );
            expect(outcome.outcomes[0]).to.deep.include({
                accepted: true,
                threw: ""
            });
            expect(outcome.rejections).to.deep.equal([]);
            expect(outcome.walks!.storage.local.answers).to.deep.equal([true]);
            const served = outcome.served!.outboundMessageBlocksOfTheLatestFork;
            expect(served).to.have.length(1);
            expect(served[0].previousBlockHash).to.equal(anchorHead);
            expect(Number(served[0].blockHeight)).to.equal(2);
            const stored = await h.execOnHost(
                requester,
                (sm, a) => ({
                    anchorBlock: !!sm.storage.outboundMessages.getMessageBlock(
                        a.anchorHead
                    ),
                    aboveAnchor: sm.storage.outboundMessages
                        .getLatestMessageBlocks()
                        .map((block) => String(block.previousBlockHash))
                }),
                { anchorHead }
            );
            expect(stored).to.deep.equal({
                anchorBlock: false,
                aboveAnchor: [anchorHead]
            });
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(
                    requester.index,
                    forkId
                );
            expect(auditingData.outboundMessageBlocks).to.deep.equal(served);
            expect(
                await chainAcceptsDisputeProof(
                    h.channelManager,
                    dispute,
                    auditingData
                )
            ).to.equal(true);
        });
    });

    it("U28: a fresh requester whose local diamond missed a consumed top-up → the local diamond walk is false, the chain walk accepts, the sync completes", async function () {
        const h = TestSession.getHarness();
        const outcome = await applyAfterMissedTopUp(h, {
            observeWalks: true
        });
        expect(outcome.outcomes[0]).to.deep.include({
            accepted: true,
            threw: ""
        });
        expect(outcome.rejections).to.deep.equal([]);
        expect(outcome.blacklisted).to.equal(false);
        expect(outcome.walks!.trustedStart.local.reads).to.equal(0);
        expect(outcome.walks!.storage.local.answers).to.deep.equal([false]);
        expect(outcome.walks!.storage.chain.answers).to.deep.equal([true]);
    });

    it("U27: a participant requester whose local finalized walk returns false (an authentic block conflicting with its local final point) → the local diamond walk accepts the proof, the chain walk never runs; replaying the conflicting block then rejects the sync", async function () {
        const h = TestSession.getHarness();
        const { forkId, anchor, payload, latestHeight } =
            await stageAnchoredHistory(h, { blocksAfter: 2 });
        const requester = h.getPeer(2);
        const localFinalized = await localFinalizedView(h, requester.index);
        expect(localFinalized!.height).to.be.greaterThan(anchor.blockHeight);
        const conflicting = await servingConflictAt(
            h,
            payload,
            anchor,
            localFinalized!.height
        );
        const outcome = await applyPayloads(
            h,
            requester,
            forkId,
            [conflicting],
            { observeWalks: true }
        );
        expect(outcome.walks!.trustedStart.local.answers).to.include(false);
        expect(outcome.walks!.storage.local.answers).to.deep.equal([true]);
        expect(outcome.walks!.storage.chain.reads).to.equal(0);
        expect(outcome.outcomes).to.deep.equal([
            { accepted: false, threw: "", head: latestHeight }
        ]);
        expect(outcome.rejections).to.deep.equal([
            "block confirmation rejected"
        ]);
        expect(outcome.blacklisted).to.equal(true);
    });

    it("U28: a requester whose local diamond holds no anchor (the chain's anchor follows a top-up its mirror missed) → the local diamond walks from the genesis and fails, the chain's anchor walk accepts, the sync completes", async function () {
        const h = TestSession.getHarness();
        const outcome = await applyAfterMissedTopUp(h, {
            anchor: "afterTopUp",
            observeWalks: true
        });
        expect(outcome.outcomes[0]).to.deep.include({
            accepted: true,
            threw: ""
        });
        expect(outcome.rejections).to.deep.equal([]);
        expect(outcome.blacklisted).to.equal(false);
        expect(outcome.walks!.trustedStart.local.reads).to.equal(0);
        expect(outcome.walks!.storage.local.answers).to.deep.equal([false]);
        expect(outcome.walks!.storage.chain.answers).to.deep.equal([true]);
    });

    it("U28: a requester whose local diamond anchor walk returns false (it missed a top-up consumed after the anchor) → the chain's anchor walk accepts, the sync completes", async function () {
        const h = TestSession.getHarness();
        const outcome = await applyAfterMissedTopUp(h, {
            anchor: "beforeTopUp",
            observeWalks: true
        });
        expect(outcome.outcomes[0]).to.deep.include({
            accepted: true,
            threw: ""
        });
        expect(outcome.rejections).to.deep.equal([]);
        expect(outcome.blacklisted).to.equal(false);
        expect(outcome.walks!.trustedStart.local.reads).to.equal(0);
        expect(outcome.walks!.storage.local.answers).to.deep.equal([false]);
        expect(outcome.walks!.storage.chain.answers).to.deep.equal([true]);
    });

    it("U29: every tier walks a proof whose last block does not decode as false → rejected, milestones invalid, responder blacklisted", async function () {
        const h = TestSession.getHarness();
        const { forkId, requester, payload } =
            await stageAnchoredSyncPayload(h);
        const lastRun =
            payload.stateProof.milestones.at(-1)!.blockConfirmations;
        lastRun.at(-1)!.signedBlock.encodedBlock = ethers.id(
            "bytes that do not decode as a block"
        );
        const outcome = await applyPayloads(
            h,
            h.getPeer(requester.index),
            String(forkId),
            [payload],
            { observeWalks: true }
        );
        expect(outcome.outcomes[0].accepted).to.equal(false);
        expect(outcome.outcomes[0].threw).to.equal("");
        expect(outcome.rejections).to.deep.equal(["milestones invalid"]);
        expect(outcome.blacklisted).to.equal(true);
        expect(outcome.walks!.trustedStart.local.answers).to.include(false);
        expect(outcome.walks!.storage.local.answers).to.deep.equal([false]);
        expect(outcome.walks!.storage.chain.answers).to.deep.equal([false]);
    });

    it("U30: the local finalized tier's walk fails at the executor connection → the sync throws it, no later tier walks, nobody is rejected or blacklisted", async function () {
        const h = TestSession.getHarness();
        const { forkId, requester, payload } =
            await stageAnchoredSyncPayload(h);
        const outcome = await applyPayloads(
            h,
            h.getPeer(requester.index),
            String(forkId),
            [payload],
            { walkFault: "localFinalized" }
        );
        expect(outcome.outcomes[0].accepted).to.equal(false);
        expect(outcome.outcomes[0].threw).to.contain("Malformed RPC request");
        expect(outcome.walks!.trustedStart.local.failures).to.have.length(1);
        expect(outcome.walks!.storage.local.reads).to.equal(0);
        expect(outcome.walks!.storage.chain.reads).to.equal(0);
        expect(outcome.rejections).to.deep.equal([]);
        expect(outcome.blacklisted).to.equal(false);
    });

    it("U30: the local diamond tier's walk fails at the executor connection → the sync throws it, the chain never walks, nothing is installed, nobody is rejected or blacklisted", async function () {
        const h = TestSession.getHarness();
        const { forkId, payload } = await stageAnchoredSyncPayload(h);
        const outcome = await applyOnFreshRequester(
            h,
            String(forkId),
            [payload],
            { walkFault: "localDiamond" }
        );
        expect(outcome.outcomes[0].accepted).to.equal(false);
        expect(outcome.outcomes[0].threw).to.contain("Malformed RPC request");
        expect(outcome.walks!.storage.local.failures).to.have.length(1);
        expect(outcome.walks!.storage.chain.reads).to.equal(0);
        expect(outcome.head).to.equal(-1);
        expect(outcome.rejections).to.deep.equal([]);
        expect(outcome.blacklisted).to.equal(false);
    });

    it("U30: the chain tier's walk meets a refused RPC connection → the sync throws it, nothing is installed, nobody is rejected or blacklisted", async function () {
        const h = TestSession.getHarness();
        const outcome = await applyAfterMissedTopUp(h, {
            walkFault: "chain"
        });
        expect(outcome.outcomes[0].accepted).to.equal(false);
        expect(outcome.outcomes[0].threw).to.contain("ECONNREFUSED");
        expect(outcome.walks!.storage.local.answers).to.deep.equal([false]);
        expect(outcome.walks!.storage.chain.failures).to.have.length(1);
        expect(outcome.head).to.equal(-1);
        expect(outcome.rejections).to.deep.equal([]);
        expect(outcome.blacklisted).to.equal(false);
    });

    it("U96: a checked block whose author signature is another participant's real signature over it → rejected, milestones invalid, responder blacklisted, nothing of the proof stored", async function () {
        const h = TestSession.getHarness();
        const { forkId, payload } = await stageAnchoredSyncPayload(h);
        const heights = proofHeights(payload).flat();
        const target = payload.stateProof.milestones
            .at(-1)!
            .blockConfirmations.at(-1)!;
        const block = Block.fromBlockConfirmation(target);
        // a real signature over this block by a participant that is not its author
        const other = target.signatures.find(
            (signature) =>
                block.signatureToAddress(signature as string) !== block.author
        );
        expect(other, "a non-author confirmation signature").to.not.equal(
            undefined
        );
        target.signedBlock.signature = other!;
        const outcome = await applyOnFreshRequester(
            h,
            String(forkId),
            [payload],
            { inspect: { heights } }
        );
        expect(outcome.outcomes).to.deep.equal([
            { accepted: false, threw: "", head: -1 }
        ]);
        expect(outcome.rejections).to.deep.equal(["milestones invalid"]);
        expect(outcome.blacklisted).to.equal(true);
        expect(outcome.blocks).to.deep.equal(heights.map(() => null));
    });

    it("U96: a checked block's confirmation signature that recovers no signer → rejected, milestones invalid, the sync does not throw, nothing of the proof stored", async function () {
        const h = TestSession.getHarness();
        const { forkId, payload } = await stageAnchoredSyncPayload(h);
        const heights = proofHeights(payload).flat();
        const first =
            payload.stateProof.milestones.at(-1)!.blockConfirmations[0];
        expect(first.signatures.length).to.be.greaterThan(0);
        // 65 bytes that are no ECDSA signature
        first.signatures[0] = ethers.concat([
            ethers.id("not a signature"),
            ethers.id("not a signature either"),
            "0x05"
        ]);
        const outcome = await applyOnFreshRequester(
            h,
            String(forkId),
            [payload],
            { inspect: { heights } }
        );
        expect(outcome.outcomes).to.deep.equal([
            { accepted: false, threw: "", head: -1 }
        ]);
        expect(outcome.rejections).to.deep.equal(["milestones invalid"]);
        expect(outcome.blacklisted).to.equal(true);
        expect(outcome.blocks).to.deep.equal(heights.map(() => null));
    });

    it("U96/U116: a milestone wholly below the anchor with an undecodable inner block → skipped unchecked, accepted, none of its material stored", async function () {
        const h = TestSession.getHarness();
        const { forkId, onChainSnapshot, payload, latestHeight } =
            await stageAnchoredSyncPayload(h);
        const height = onChainSnapshot.blockHeight - 1;
        const plantedSnapshot = StateSnapshot.from({
            ...payload.milestoneSnapshots[0],
            blockHeight: height
        });
        const below = await craftProofBlock(h, {
            authorIndex: 0,
            forkId: String(forkId),
            height,
            stateSnapshotHash: plantedSnapshot.hash
        });
        const junk = {
            signedBlock: {
                encodedBlock: ethers.id("bytes that do not decode as a block"),
                signature: below.confirmation.signedBlock.signature
            },
            signatures: []
        };
        payload.stateProof.milestones.unshift({
            blockConfirmations: [junk, below.confirmation]
        });
        payload.milestoneSnapshots.unshift(plantedSnapshot.toStruct());
        expect(Block.tryFromBlockConfirmation(junk) ?? null).to.equal(null);
        const outcome = await applyOnFreshRequester(
            h,
            String(forkId),
            [payload],
            {
                inspect: {
                    heights: [height],
                    snapshotHashes: [String(plantedSnapshot.hash)]
                }
            }
        );
        expect(outcome.outcomes).to.deep.equal([
            { accepted: true, threw: "", head: latestHeight }
        ]);
        expect(outcome.rejections).to.deep.equal([]);
        expect(outcome.blacklisted).to.equal(false);
        expect(outcome.blocks).to.deep.equal([null]);
        expect(outcome.snapshotsStored).to.deep.equal([false]);
    });

    it("a spectator whose compact sync installs above a gossiped block still in its queue → that block is dropped: no abort, the honest sender is not blacklisted, it keeps following", async function () {
        const h = TestSession.getHarness();
        const { applied, queuedHeight, installed, afterDrop, followed } =
            await syncAboveHeldQueuedBlock(h);
        expect(applied.outcomes[0]).to.deep.include({
            accepted: true,
            threw: ""
        });
        expect(applied.rejections).to.deep.equal([]);
        expect(applied.blacklisted).to.equal(false);
        // premise: the compact proof installed the head above the queued
        // block without storing it, and the block still waits in the queue
        expect(applied.head).to.be.greaterThan(queuedHeight);
        expect(installed).to.deep.equal({
            queuedBlockStored: false,
            stillQueued: true
        });
        expect(afterDrop).to.deep.equal({
            queuedBlockStored: false,
            blacklisted: [false, false, false],
            closed: false
        });
        expect(followed).to.deep.equal({
            blacklisted: [false, false, false],
            closed: false
        });
    });

    describe("milestone snapshot envelope", function () {
        it("U120: a served proof with excess milestone snapshot entries → rejected, milestones invalid, responder blacklisted, nothing of the proof or the excess entries stored", async function () {
            const h = TestSession.getHarness();
            const { forkId, onChainSnapshot, payload } =
                await stageAnchoredSyncPayload(h);
            const proofBlockHeights = proofHeights(payload).flat();
            // real snapshots of blocks below the anchor that the proof never carries
            const excess = [
                await servedBlock(h, String(forkId), 0),
                await servedBlock(h, String(forkId), 1)
            ];
            expect(onChainSnapshot.blockHeight).to.be.greaterThan(1);
            const excessSnapshots = excess.map((block) =>
                StateSnapshot.from(block.snapshot)
            );
            payload.milestoneSnapshots.push(
                ...excess.map((block) => block.snapshot)
            );
            const outcome = await applyOnFreshRequester(
                h,
                String(forkId),
                [payload],
                {
                    observeWalks: true,
                    inspect: {
                        heights: [0, 1, ...proofBlockHeights],
                        snapshotHashes: excessSnapshots.map((snapshot) =>
                            String(snapshot.hash)
                        ),
                        stateHashes: excessSnapshots.map((snapshot) =>
                            String(snapshot.stateMachineStateHash)
                        )
                    }
                }
            );
            expect(outcome.outcomes).to.deep.equal([
                { accepted: false, threw: "", head: -1 }
            ]);
            expect(outcome.rejections).to.deep.equal(["milestones invalid"]);
            expect(outcome.blacklisted).to.equal(true);
            expect(outcome.walks!.storage.local.answers).to.deep.equal([false]);
            expect(outcome.walks!.storage.chain.answers).to.deep.equal([false]);
            expect(outcome.blocks).to.deep.equal(
                [0, 1, ...proofBlockHeights].map(() => null)
            );
            expect(outcome.snapshotsStored).to.deep.equal([false, false]);
            expect(outcome.statesStored).to.deep.equal([false, false]);
            expect(outcome.changeHeights).to.deep.equal([]);
        });

        it("U120: a served proof missing a milestone snapshot entry → rejected, milestones invalid, responder blacklisted, nothing of the proof stored", async function () {
            const h = TestSession.getHarness();
            const { forkId, payload } = await stageAnchoredSyncPayload(h);
            const proofBlockHeights = proofHeights(payload).flat();
            expect(payload.milestoneSnapshots.length).to.be.greaterThan(0);
            payload.milestoneSnapshots.pop();
            const outcome = await applyOnFreshRequester(
                h,
                String(forkId),
                [payload],
                { inspect: { heights: proofBlockHeights } }
            );
            expect(outcome.outcomes).to.deep.equal([
                { accepted: false, threw: "", head: -1 }
            ]);
            expect(outcome.rejections).to.deep.equal(["milestones invalid"]);
            expect(outcome.blacklisted).to.equal(true);
            expect(outcome.blocks).to.deep.equal(
                proofBlockHeights.map(() => null)
            );
            expect(outcome.changeHeights).to.deep.equal([]);
        });

        it("U120: a served proof with exactly one snapshot entry per milestone → accepted, its blocks stored, the rebuilt proof verifies", async function () {
            const h = TestSession.getHarness();
            const { forkId, payload, latestHeight } =
                await stageAnchoredSyncPayload(h);
            expect(payload.milestoneSnapshots.length).to.equal(
                payload.stateProof.milestones.length
            );
            const outcome = await applyOnFreshRequester(
                h,
                String(forkId),
                [payload],
                { inspect: { heights: [latestHeight] }, reconstruct: true }
            );
            expect(outcome.outcomes).to.deep.equal([
                { accepted: true, threw: "", head: latestHeight }
            ]);
            expect(outcome.rejections).to.deep.equal([]);
            expect(outcome.blacklisted).to.equal(false);
            expect(outcome.blocks[0]).to.not.equal(null);
            expect(outcome.rebuilt!.chainValid).to.equal(true);
        });

        it("U120: the valid empty genesis proof (no milestones, no snapshot entries) → accepted, the genesis state installed, no block stored", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            // block 0 is due from the genesis on: no timeout dispute meanwhile
            for (const index of [0, 1, 2])
                await h.rpcStub.suppressTimeoutCheck(index);
            const forkId = String(h.activeForkId!);
            const outcome = await applyOnFreshRequester(h, forkId, ["served"]);
            expect(outcome.served!.stateProof.milestones).to.deep.equal([]);
            expect(outcome.served!.milestoneSnapshots).to.deep.equal([]);
            expect(outcome.outcomes).to.deep.equal([
                { accepted: true, threw: "", head: -1 }
            ]);
            expect(outcome.rejections).to.deep.equal([]);
            expect(outcome.blacklisted).to.equal(false);
            expect(outcome.installedStateHash).to.equal(
                String(
                    StateSnapshot.from(
                        outcome.served!.latestForkGenesisSnapshot
                    ).stateMachineStateHash
                )
            );
        });
    });
});

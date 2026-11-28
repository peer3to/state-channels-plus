import Block from "@/models/Block";
import StateSnapshot from "@/models/StateSnapshot";
import { chainAcceptsDisputeProof } from "@test/fixtures/ChainProofVerdict";
import { doubleSignProofHashes } from "@test/fixtures/DoubleSignStaging";
import {
    forgedOutboundBlock,
    localDiamondOutboundHeight,
    stageAnchorAdvancedPastFirstExit,
    stageAnchoredSyncPayload,
    stageOutboundAroundAnchor
} from "@test/fixtures/HistoricSyncStaging";
import { servedPayload } from "@test/fixtures/MilestoneSyncStaging";
import { proofHeights } from "@test/fixtures/MilestoneSyncStaging";
import { stageSeatedJoinerHistory } from "@test/fixtures/OmittedInboundJoinerStaging";
import {
    localFinalizedView,
    stageFinalBlocks,
    postAnchor,
    postSnapshotFrom,
    storedConfirmations
} from "@test/fixtures/ProofOwnerStaging";
import {
    applyAfterMissedTopUp,
    withHeldFreshRequester,
    holdCanonicalProofWalk,
    lastServedBlock,
    applyOnFreshRequester,
    applyPayloads,
    craftProofBlock,
    evidenceFinalPointHeights,
    readSigningOn,
    servedBlock,
    servingConflictAt,
    servingJoinerBypass,
    servingSignedConflictAt,
    stageAnchoredHistory,
    stageLowerHopConflictServedByRelay,
    stageOwnFinalPointBehindMissedTopUp,
    stageOwnHistoryBehindServedInbound,
    stageRelinkedHistoryOverMissedTopUp,
    stageSigningStoppedBySync,
    syncAboveHeldQueuedBlock,
    syncEvidenceView
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
                expect(await postSnapshotFrom(h, 0)).to.equal("posted");
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
                (sm, a) => {
                    const fromTip =
                        sm.storage.outboundMessages.tryGetMessageBlocksInRange();
                    return {
                        anchorBlock:
                            !!sm.storage.outboundMessages.getMessageBlock(
                                a.anchorHead
                            ),
                        aboveAnchor: fromTip.blocks.map((block) =>
                            String(block.previousBlockHash)
                        ),
                        missingBlockHash: fromTip.missingBlockHash
                    };
                },
                { anchorHead }
            );
            expect(stored).to.deep.equal({
                anchorBlock: false,
                aboveAnchor: [anchorHead],
                missingBlockHash: anchorHead
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

    it("a fresh requester whose RPC node lags the second exit's snapshot that its local diamond already applied → the sync waits for the responder's chain block and ends with no verdict: no rejection, the responder not blacklisted, the local diamond keeps the newer anchor", async function () {
        const h = TestSession.getHarness();
        const { forkId, remaining, blockBeforePost } =
            await stageAnchorAdvancedPastFirstExit(h, { finalBlocks: 2 });
        await withHeldFreshRequester(h, async (requester) => {
            await waitFor(
                async () =>
                    (await localDiamondOutboundHeight(h, requester)) === 2,
                h.event.protocolEventTimeoutMs()
            );
            const lag = await h.rpcStub.lagChainView(requester.index, {
                holdLogs: false,
                atBlock: blockBeforePost
            });
            const outcome = await applyPayloads(
                h,
                requester,
                String(forkId),
                ["served"],
                { responderIndex: remaining[0] }
            ).finally(lag.release);
            expect(outcome.outcomes[0]).to.deep.include({
                accepted: false,
                threw: ""
            });
            expect(outcome.rejections).to.deep.equal([]);
            expect(outcome.blacklisted).to.equal(false);
            expect(await localDiamondOutboundHeight(h, requester)).to.equal(2);
        });
    });

    it("a peer whose RPC node lags the second exit's snapshot that its local diamond already applied refreshes its opened status → the lagged read does not move its local anchor back", async function () {
        const h = TestSession.getHarness();
        const { blockBeforePost } = await stageAnchorAdvancedPastFirstExit(h, {
            finalBlocks: 2
        });
        await withHeldFreshRequester(h, async (requester) => {
            await waitFor(
                async () =>
                    (await localDiamondOutboundHeight(h, requester)) === 2,
                h.event.protocolEventTimeoutMs()
            );
            const lag = await h.rpcStub.lagChainView(requester.index, {
                holdLogs: false,
                atBlock: blockBeforePost
            });
            await h
                .execOnHost(requester, async (sm) => {
                    await sm.refreshOpenedStatusFromChain();
                })
                .finally(lag.release);

            expect(await localDiamondOutboundHeight(h, requester)).to.equal(2);
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

    it("U27: a participant requester whose local finalized walk returns false (an authentic tail block conflicting with its local final point) → the local diamond walk accepts the proof, the chain walk never runs; the side chain is not installed, it is kept as sync evidence, and the relay is not rejected or blacklisted", async function () {
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
            { observeWalks: true, readLocalFinality: true }
        );
        expect(outcome.walks!.trustedStart.local.answers).to.include(false);
        expect(outcome.walks!.storage.local.answers).to.deep.equal([true]);
        expect(outcome.walks!.storage.chain.reads).to.equal(0);
        expect(outcome.outcomes).to.deep.equal([
            { accepted: false, threw: "", head: latestHeight }
        ]);
        expect(outcome.stateWrites).to.deep.equal([0]);
        expect(outcome.replays).to.deep.equal([0]);
        expect(outcome.localFinalizedHeights).to.deep.equal([
            localFinalized!.height
        ]);
        expect(outcome.rejections).to.deep.equal([]);
        expect(outcome.blacklisted).to.equal(false);
        // the walk from the anchor ends at the anchor: the conflicting block is in its tail
        expect(await syncEvidenceView(h, requester, anchor)).to.deep.equal({
            startHash: String(anchor.hash),
            hopHeights: [],
            finalizedHash: String(anchor.hash),
            isStateHeld: false
        });
    });

    describe("install decision below the own final point", function () {
        it("S1: seated Charlie is served the colluders' bypass proof, which never consumes his JOIN → it fails from his final point and passes from the anchor, the regression kill holds: not installed, kept as sync evidence that adds no final point for a counter, and a relay that signed neither history is not rejected or blacklisted", async function () {
            const h = TestSession.getHarness();
            const history = await stageSeatedJoinerHistory(h);
            const charlie = h.getPeer(history.charlieIndex);
            const relay = h.getPeer((await h.join.createSpectatorPeer()).index);
            const { payload, finalSnapshot } = await servingJoinerBypass(
                h,
                history
            );
            const headBefore = (await h
                .control(charlie)
                .query.getLatestBlockHeight(history.forkId)
                .request())!;
            expect(finalSnapshot.blockHeight).to.be.greaterThan(
                history.charlieFinal.blockHeight
            );
            const outcome = await applyPayloads(
                h,
                charlie,
                String(history.forkId),
                [payload],
                {
                    responderIndex: relay.index,
                    observeWalks: true,
                    readLocalFinality: true
                }
            );
            expect(outcome.walks!.trustedStart.local.answers).to.include(false);
            expect(outcome.walks!.storage.local.answers).to.deep.equal([true]);
            expect(outcome.outcomes).to.deep.equal([
                { accepted: false, threw: "", head: headBefore }
            ]);
            expect(outcome.stateWrites).to.deep.equal([0]);
            expect(outcome.localFinalizedHeights).to.deep.equal([
                history.charlieFinal.blockHeight
            ]);
            expect(outcome.rejections).to.deep.equal([]);
            expect(outcome.blacklisted).to.equal(false);
            expect(
                await syncEvidenceView(h, charlie, finalSnapshot)
            ).to.deep.equal({
                startHash: String(history.anchor.hash),
                hopHeights: [finalSnapshot.blockHeight],
                finalizedHash: String(finalSnapshot.hash),
                isStateHeld: true
            });
            // sync evidence is no final point source for a counter
            expect(await evidenceFinalPointHeights(h, charlie)).to.deep.equal(
                []
            );
        });

        it("S1: seated Charlie is served the colluders' bypass proof by Alice, who signed it and his final point → not installed, kept as sync evidence, and Alice is rejected and blacklisted", async function () {
            const h = TestSession.getHarness();
            const history = await stageSeatedJoinerHistory(h);
            const charlie = h.getPeer(history.charlieIndex);
            const { payload, finalSnapshot } = await servingJoinerBypass(
                h,
                history
            );
            const outcome = await applyPayloads(
                h,
                charlie,
                String(history.forkId),
                [payload],
                { responderIndex: history.aliceIndex }
            );
            expect(outcome.outcomes[0]).to.deep.include({
                accepted: false,
                threw: ""
            });
            expect(outcome.stateWrites).to.deep.equal([0]);
            expect(outcome.rejections).to.deep.equal([
                "side chain signed by the responder"
            ]);
            expect(outcome.blacklisted).to.equal(true);
            expect(
                (await syncEvidenceView(h, charlie, finalSnapshot))
                    ?.finalizedHash
            ).to.equal(String(finalSnapshot.hash));
        });

        it("a participant served a threshold-final block that conflicts with its own final point, signed by the responder → the conflict kill holds in both directions (equal inbound): not installed, kept as sync evidence, the responder is rejected and blacklisted; each other signer of both final blocks gets a double-sign proof and the participant disputes the fork at once, so the chain slashes them and not it", async function () {
            const h = TestSession.getHarness();
            const { forkId, anchor, payload, latestHeight } =
                await stageAnchoredHistory(h, { blocksAfter: 2 });
            const requester = h.getPeer(2);
            const localFinalized = await localFinalizedView(h, requester.index);
            expect(localFinalized!.height).to.be.greaterThan(
                anchor.blockHeight
            );
            const conflicting = await servingSignedConflictAt(
                h,
                payload,
                anchor,
                localFinalized!.height
            );
            const outcome = await applyPayloads(
                h,
                requester,
                forkId,
                [conflicting.payload],
                { observeWalks: true }
            );
            expect(outcome.walks!.trustedStart.local.answers).to.include(false);
            expect(outcome.walks!.storage.local.answers).to.deep.equal([true]);
            expect(outcome.outcomes).to.deep.equal([
                { accepted: false, threw: "", head: latestHeight }
            ]);
            expect(outcome.stateWrites).to.deep.equal([0]);
            expect(outcome.rejections).to.deep.equal([
                "side chain signed by the responder"
            ]);
            expect(outcome.blacklisted).to.equal(true);
            expect(
                await syncEvidenceView(h, requester, conflicting.finalSnapshot)
            ).to.deep.equal({
                startHash: String(anchor.hash),
                hopHeights: [localFinalized!.height],
                finalizedHash: String(conflicting.finalSnapshot.hash),
                isStateHeld: true
            });
            const [peer0, peer1] = [h.getPeer(0), h.getPeer(1)];
            const pair = [
                (await h
                    .control(requester)
                    .query.getBlockByHeight(forkId, localFinalized!.height)
                    .request())!.hash,
                String(lastServedBlock(conflicting.payload).hash)
            ];
            expect(
                await doubleSignProofHashes(h, requester, [
                    peer0.address,
                    peer1.address,
                    requester.address
                ])
            ).to.deep.equal({
                [peer0.address]: [pair],
                [peer1.address]: [pair],
                [requester.address]: []
            });
            await h.assert.dispute.committedWait({
                peersIndices: [requester.index],
                expectedCount: 1
            });
            const slashed = (
                await h.channelManager.getOnChainSlashedParticipants(
                    h.channelId
                )
            ).map(String);
            expect(slashed).to.include.members([peer0.address, peer1.address]);
            expect(slashed).to.not.include(requester.address);
            expect(await readSigningOn(h, requester, forkId)).to.deep.equal({
                stopped: true,
                stoppedBySync: false,
                signsLatestBlock: false,
                disputing: true
            });
        });

        it("a participant served a threshold-final block at its own final height that has consumed a joiner's JOIN more → only the reverse conflict kill holds, its own history is the side chain: not installed, kept as sync evidence, no rejection, no blacklist, no dispute, and it stops signing on the fork", async function () {
            const h = TestSession.getHarness();
            const staged = await stageSigningStoppedBySync(h);
            const { requester, forkId, localFinalized, outcome } = staged;

            expect(outcome.outcomes).to.deep.equal([
                { accepted: false, threw: "", head: staged.latestHeight }
            ]);
            expect(outcome.stateWrites).to.deep.equal([0]);
            expect(outcome.localFinalizedHeights).to.deep.equal([
                localFinalized.height
            ]);
            expect(outcome.rejections).to.deep.equal([]);
            expect(outcome.blacklisted).to.equal(false);
            expect(
                await syncEvidenceView(
                    h,
                    requester,
                    staged.served.finalSnapshot
                )
            ).to.deep.equal({
                startHash: String(staged.anchor.hash),
                hopHeights: [localFinalized.height],
                finalizedHash: String(staged.served.finalSnapshot.hash),
                isStateHeld: true
            });
            expect(await readSigningOn(h, requester, forkId)).to.deep.equal({
                stopped: true,
                stoppedBySync: true,
                signsLatestBlock: false,
                disputing: false
            });
            // the stop is the requester's own: the responder still signs
            expect(
                (await readSigningOn(h, staged.responder, forkId))
                    .signsLatestBlock
            ).to.equal(true);
        });

        it("a participant whose own history only the served final history kills → the other signers of both its final block and the served one get double-sign proofs, they are only stored: no dispute, and it stops signing on the fork", async function () {
            const h = TestSession.getHarness();
            const staged = await stageSigningStoppedBySync(h);
            const { requester, forkId, localFinalized } = staged;
            const pair = [
                (await h
                    .control(requester)
                    .query.getBlockByHeight(forkId, localFinalized.height)
                    .request())!.hash,
                String(lastServedBlock(staged.served.payload).hash)
            ];

            expect(
                await doubleSignProofHashes(h, requester, [
                    h.getPeer(0).address,
                    h.getPeer(1).address
                ])
            ).to.deep.equal({
                [h.getPeer(0).address]: [pair],
                [h.getPeer(1).address]: [pair]
            });
            expect(await readSigningOn(h, requester, forkId)).to.deep.include({
                stoppedBySync: true,
                disputing: false
            });
        });

        it("a participant whose own history only the served final history kills → the joiner that signed only the served block and the participant itself get no double-sign proof", async function () {
            const h = TestSession.getHarness();
            const staged = await stageSigningStoppedBySync(h);
            const { requester } = staged;
            const joiner = staged.served.joiner;

            expect(
                await doubleSignProofHashes(h, requester, [
                    joiner.address,
                    requester.address
                ])
            ).to.deep.equal({
                [joiner.address]: [],
                [requester.address]: []
            });
        });

        it("the double-sign proofs a synced side chain gave a participant outlive the fork's proof evidence: dropping the fork's records keeps them", async function () {
            const h = TestSession.getHarness();
            const staged = await stageSigningStoppedBySync(h);
            const { requester, forkId } = staged;
            const before = await doubleSignProofHashes(h, requester, [
                h.getPeer(0).address
            ]);
            expect(before[h.getPeer(0).address]).to.have.length(1);

            await h.execOnHost(
                requester,
                (sm, args) => sm.storage.proofEvidence.dropFork(args.forkId),
                { forkId }
            );

            expect(
                await syncEvidenceView(
                    h,
                    requester,
                    staged.served.finalSnapshot
                )
            ).to.equal(null);
            expect(
                await doubleSignProofHashes(h, requester, [
                    h.getPeer(0).address
                ])
            ).to.deep.equal(before);
        });

        it("a participant served a side chain whose sync evidence record does not fit a dispute upload → the record is refused, and the other signers of both conflicting final blocks still get double-sign proofs", async function () {
            const h = TestSession.getHarness();
            const { forkId, anchor, payload } = await stageAnchoredHistory(h, {
                blocksAfter: 2,
                maxDisputeUploadBytes: 256
            });
            const requester = h.getPeer(2);
            const localFinalized = await localFinalizedView(h, requester.index);
            const conflicting = await servingSignedConflictAt(
                h,
                payload,
                anchor,
                localFinalized!.height
            );

            const outcome = await applyPayloads(h, requester, forkId, [
                conflicting.payload
            ]);

            expect(outcome.outcomes[0]).to.deep.include({
                accepted: false,
                threw: ""
            });
            expect(
                await syncEvidenceView(h, requester, conflicting.finalSnapshot)
            ).to.equal(null);
            const pair = [
                (await h
                    .control(requester)
                    .query.getBlockByHeight(forkId, localFinalized!.height)
                    .request())!.hash,
                String(lastServedBlock(conflicting.payload).hash)
            ];
            expect(
                await doubleSignProofHashes(h, requester, [
                    h.getPeer(0).address,
                    h.getPeer(1).address
                ])
            ).to.deep.equal({
                [h.getPeer(0).address]: [pair],
                [h.getPeer(1).address]: [pair]
            });
        });

        it("a participant served a tail block at its own final height, by that height's author and confirmed by one more participant → the conflict kill holds: not installed, kept as sync evidence; each other signer of both blocks gets a double-sign proof and the participant disputes the fork at once", async function () {
            const h = TestSession.getHarness();
            const { forkId, anchor, payload } = await stageAnchoredHistory(h, {
                blocksAfter: 2
            });
            const requester = h.getPeer(2);
            const localFinalized = (await localFinalizedView(
                h,
                requester.index
            ))!;
            const stored = (await h
                .control(requester)
                .query.getBlockByHeight(forkId, localFinalized.height)
                .request())!;
            // the one participant that is neither the requester nor the author
            const coSigner = [0, 1].find(
                (index) => h.getPeer(index).address !== stored.author
            )!;
            const served = await servingConflictAt(
                h,
                payload,
                anchor,
                localFinalized.height,
                [coSigner]
            );
            const doubleSigners = [stored.author, h.getPeer(coSigner).address]
                .map(String)
                .filter((address) => address !== requester.address)
                .sort();

            const outcome = await applyPayloads(h, requester, forkId, [served]);

            expect(outcome.outcomes[0]).to.deep.include({
                accepted: false,
                threw: ""
            });
            expect(
                (await syncEvidenceView(h, requester, anchor))?.finalizedHash
            ).to.equal(String(anchor.hash));
            const pair = [
                String(stored.hash),
                String(lastServedBlock(served).hash)
            ];
            expect(
                await doubleSignProofHashes(h, requester, doubleSigners)
            ).to.deep.equal(
                Object.fromEntries(
                    doubleSigners.map((address) => [address, [pair]])
                )
            );
            await h.assert.dispute.committedWait({
                peersIndices: [requester.index],
                expectedCount: 1
            });
            expect(
                (await readSigningOn(h, requester, forkId)).disputing
            ).to.equal(true);
        });

        it("an observer whose local diamond missed a consumed top-up is served the channel's history with every block from height 1 signed a second time → no kill in either direction: not installed, no verdict and no blame, but each signer of both blocks at a height the observer holds gets a double-sign proof there; an observer opens no dispute", async function () {
            const h = TestSession.getHarness();
            const staged = await stageRelinkedHistoryOverMissedTopUp(h);
            const { requester, forkId } = staged;
            try {
                // premise: some served block is a second block at a held height
                expect(staged.conflicts).to.not.deep.equal([]);
                const outcome = await applyPayloads(
                    h,
                    requester,
                    forkId,
                    [staged.payload],
                    { observeWalks: true, readLocalFinality: true }
                );

                expect(outcome.walks!.storage.local.answers).to.deep.equal([
                    false
                ]);
                expect(outcome.walks!.storage.chain.answers).to.deep.equal([
                    true
                ]);
                expect(outcome.outcomes[0]).to.deep.include({
                    accepted: false,
                    threw: ""
                });
                expect(outcome.stateWrites).to.deep.equal([0]);
                expect(outcome.localFinalizedHeights).to.deep.equal([
                    staged.localFinalized.height
                ]);
                expect(outcome.rejections).to.deep.equal([]);
                expect(outcome.blacklisted).to.equal(false);
                const participants = [0, 1, 2].map(
                    (index) => h.getPeer(index).address
                );
                const expected = Object.fromEntries(
                    participants.map((address) => [
                        address,
                        staged.conflicts
                            .filter(({ stored }) =>
                                stored.signers.includes(address)
                            )
                            .map(({ stored, servedHash }) => [
                                stored.hash,
                                servedHash
                            ])
                    ])
                );
                expect(
                    await doubleSignProofHashes(h, requester, participants)
                ).to.deep.equal(expected);
                expect(
                    (await readSigningOn(h, requester, forkId)).disputing
                ).to.equal(false);
            } finally {
                await staged.hold.release();
                await staged.restoreGossip();
            }
        });

        it("a participant whose signing a synced proof stopped is then served its responder's honest proof, which verifies from its own final point → the stop is never lifted on that fork", async function () {
            const h = TestSession.getHarness();
            const staged = await stageSigningStoppedBySync(h);
            const { requester, forkId } = staged;
            expect(
                (await readSigningOn(h, requester, forkId)).stoppedBySync
            ).to.equal(true);

            const again = await applyPayloads(h, requester, forkId, ["served"]);

            expect(again.outcomes[0].threw).to.equal("");
            expect(again.rejections).to.deep.equal([]);
            expect(await readSigningOn(h, requester, forkId)).to.deep.equal({
                stopped: true,
                stoppedBySync: true,
                signsLatestBlock: false,
                disputing: false
            });
        });

        it("a participant served a proof that ends one below its own final point, whose threshold-final block there has consumed a joiner's JOIN it holds and its own final point lacks → walked from the anchor, only the reverse direction holds: not installed, kept as sync evidence, no rejection, no blacklist, no dispute, and it stops signing on the fork", async function () {
            const h = TestSession.getHarness();
            const staged = await stageOwnHistoryBehindServedInbound(h, {
                belowOwnFinalPoint: true
            });
            const { requester, forkId, localFinalized } = staged;
            // premise: the proof ends below the requester's own final point
            expect(staged.served.finalSnapshot.blockHeight).to.equal(
                localFinalized.height - 1
            );

            const outcome = await applyPayloads(
                h,
                requester,
                forkId,
                [staged.served.payload],
                { readLocalFinality: true }
            );

            expect(outcome.outcomes).to.deep.equal([
                { accepted: false, threw: "", head: staged.latestHeight }
            ]);
            expect(outcome.stateWrites).to.deep.equal([0]);
            expect(outcome.localFinalizedHeights).to.deep.equal([
                localFinalized.height
            ]);
            expect(outcome.rejections).to.deep.equal([]);
            expect(outcome.blacklisted).to.equal(false);
            expect(
                await syncEvidenceView(
                    h,
                    requester,
                    staged.served.finalSnapshot
                )
            ).to.deep.equal({
                startHash: String(staged.anchor.hash),
                hopHeights: [localFinalized.height - 1],
                finalizedHash: String(staged.served.finalSnapshot.hash),
                isStateHeld: true
            });
            expect(await readSigningOn(h, requester, forkId)).to.deep.equal({
                stopped: true,
                stoppedBySync: true,
                signsLatestBlock: false,
                disputing: false
            });
        });

        it("a relay serves a proof that ends below the participant's own final point, whose threshold-final block conflicts with a lower final point of its history (the hop that seated a joiner) → walked from the anchor, the conflict kill holds: not installed, kept as sync evidence, and the relay is not rejected or blacklisted", async function () {
            const h = TestSession.getHarness();
            const staged = await stageLowerHopConflictServedByRelay(h);
            const { requester, forkId, localFinalized, lowerHopHeight } =
                staged;
            const headBefore = (await h
                .control(requester)
                .query.getLatestBlockHeight(forkId)
                .request())!;

            const outcome = await applyPayloads(
                h,
                requester,
                forkId,
                [staged.served.payload],
                { responderIndex: staged.relay.index, readLocalFinality: true }
            );

            expect(outcome.outcomes).to.deep.equal([
                { accepted: false, threw: "", head: headBefore }
            ]);
            expect(outcome.stateWrites).to.deep.equal([0]);
            expect(outcome.localFinalizedHeights).to.deep.equal([
                localFinalized.height
            ]);
            expect(outcome.rejections).to.deep.equal([]);
            expect(outcome.blacklisted).to.equal(false);
            expect(
                await syncEvidenceView(
                    h,
                    requester,
                    staged.served.finalSnapshot
                )
            ).to.deep.equal({
                startHash: String(staged.anchor.hash),
                hopHeights: [lowerHopHeight],
                finalizedHash: String(staged.served.finalSnapshot.hash),
                isStateHeld: true
            });
            // the forward kill holds: the participant keeps signing
            expect(
                (await readSigningOn(h, requester, forkId)).stoppedBySync
            ).to.equal(false);
        });

        it("S2: an honest continuation fails from the observer's final point (its local diamond missed a consumed top-up) and passes at the chain tier → not installed, no rejection, no blacklist; once its local diamond holds the run the same peer's next answer verifies from that final point and installs", async function () {
            const h = TestSession.getHarness();
            const staged = await stageOwnFinalPointBehindMissedTopUp(h);
            try {
                const before = await applyPayloads(
                    h,
                    staged.requester,
                    staged.forkId,
                    ["served"],
                    { observeWalks: true, readLocalFinality: true }
                );
                // the second trusted-start walk is the build of the
                // observer's own proof, judged against the served history
                expect(before.walks!.trustedStart.local.answers).to.deep.equal([
                    false,
                    true
                ]);
                expect(before.walks!.storage.local.answers).to.deep.equal([
                    false
                ]);
                expect(before.walks!.storage.chain.answers).to.deep.equal([
                    true
                ]);
                expect(before.outcomes[0]).to.deep.include({
                    accepted: false,
                    threw: ""
                });
                expect(before.stateWrites).to.deep.equal([0]);
                expect(before.localFinalizedHeights).to.deep.equal([
                    staged.localFinalized.height
                ]);
                expect(before.rejections).to.deep.equal([]);
                expect(before.blacklisted).to.equal(false);

                expect(await staged.hold.release()).to.be.greaterThan(0);
                const after = await applyPayloads(
                    h,
                    staged.requester,
                    staged.forkId,
                    ["served"],
                    { observeWalks: true }
                );
                const servedHead = proofHeights(after.served!).at(-1)!.at(-1)!;
                // the first trusted-start walk is the verification's
                expect(after.walks!.trustedStart.local.answers[0]).to.equal(
                    true
                );
                expect(after.walks!.storage.local.reads).to.equal(0);
                expect(after.outcomes).to.deep.equal([
                    { accepted: true, threw: "", head: servedHead }
                ]);
                expect(after.rejections).to.deep.equal([]);
                expect(after.blacklisted).to.equal(false);
            } finally {
                await staged.restoreGossip();
            }
        });

        it("an observer that cannot check a continuation from its final point stays on its stored proof; once the chain anchor moves above that final point the next answer walks from the anchor, the observer's start, and installs", async function () {
            const h = TestSession.getHarness();
            const staged = await stageOwnFinalPointBehindMissedTopUp(h);
            try {
                const before = await applyPayloads(
                    h,
                    staged.requester,
                    staged.forkId,
                    ["served"],
                    { readLocalFinality: true }
                );
                expect(before.outcomes[0]).to.deep.include({
                    accepted: false,
                    threw: ""
                });
                expect(before.stateWrites).to.deep.equal([0]);
                expect(before.rejections).to.deep.equal([]);

                const anchor = await postAnchor(h);
                expect(anchor.height).to.be.greaterThan(
                    staged.localFinalized.height
                );
                const after = await applyPayloads(
                    h,
                    staged.requester,
                    staged.forkId,
                    ["served"],
                    { observeWalks: true }
                );
                const servedHead = proofHeights(after.served!).at(-1)!.at(-1)!;
                expect(after.walks!.storage.local.answers).to.deep.equal([
                    true
                ]);
                expect(after.outcomes).to.deep.equal([
                    { accepted: true, threw: "", head: servedHead }
                ]);
                expect(after.rejections).to.deep.equal([]);
                expect(after.blacklisted).to.equal(false);
            } finally {
                await staged.restoreGossip();
            }
        });
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

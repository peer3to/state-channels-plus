import { stageBlindPendingAuditor } from "@test/fixtures/DisputeAuditStaging";
import {
    chainSnapshot,
    freshSpectatorSyncedFrom,
    proofHeights,
    servedPayload
} from "@test/fixtures/MilestoneSyncStaging";
import {
    addStoredSignature,
    exactFinalProofView,
    stageExactJoinWithLaterVote,
    stageExactExitWithLaterVote,
    stageExactJoinAboveView,
    blockSnapshotHashAt,
    buildProofView,
    coversAll,
    dropStoredBlock,
    heightRange,
    hopUnion,
    localFinalizedView,
    restoreStoredBlocks,
    stageFinalBlocks,
    stageFinalJoinThenUnfinalizedTail,
    stageFinalThenUnfinalizedTail,
    stageFinalityFromNextBlock,
    stageJoinThenLeave,
    stageJoinHopWithLaterFinalPoint,
    stageMirrorMissingTopUp,
    stageTwoJoins,
    stageSuccessorBlockZero,
    stageUnpostedSuccessorFork,
    storedConfirmations,
    tryBuildProofView,
    verifyProofView,
    walkAllTiersView,
    walkEmptyProofWithGenesis,
    postSnapshotFrom,
    prepareSameForkView
} from "@test/fixtures/ProofOwnerStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers } from "ethers";

describe("Unit: AgreementManager proof construction", function () {
    it("FR1: an exact final proof keeps later virtual votes and rejects the unfinalized support height", async function () {
        const h = TestSession.getHarness();
        const { observerIndex } = await stageFinalityFromNextBlock(h);
        const result = await h.execOnHost(
            h.getPeer(observerIndex),
            async (sm) => {
                const am = sm.agreementManager;
                const before = sm.storage.blocks.getNextBlockHeight(sm.forkId);
                const proof = await am.tryBuildFinalProofAt(sm.forkId, 2);
                if (!proof)
                    throw new Error("The virtual final point was not proved");
                const walk =
                    await sm.stateChannelManagerContract.verifyMilestones.staticCall(
                        proof
                    );
                return {
                    valid: walk.valid,
                    final: Number(walk.finalizedSnapshot.blockHeight),
                    direct: am.didEveryoneSignBlock(
                        sm.storage.blocks.getBlock(sm.forkId, 2)!
                    ),
                    unfinalized:
                        (await am.tryBuildFinalProofAt(sm.forkId, 3)) ===
                        undefined,
                    unchanged:
                        sm.storage.blocks.getNextBlockHeight(sm.forkId) ===
                        before
                };
            }
        );
        expect(result).to.deep.equal({
            valid: true,
            final: 2,
            direct: false,
            unfinalized: true,
            unchanged: true
        });
    });

    it("TO1: exact join finality retains the later union vote and disappears when that sole vote is removed", async function () {
        const h = TestSession.getHarness();
        const {
            observerIndex,
            offlineIndex,
            forkId,
            joinHeight,
            latestHeight
        } = await stageExactJoinWithLaterVote(h);
        const result = await exactFinalProofView(h, observerIndex, joinHeight);
        expect(result.after).to.equal(result.before);
        expect(result.proof?.valid).to.equal(true);
        expect(result.proof?.usedNonGenesisStart).to.equal(false);
        expect(result.proof?.finalHeight).to.equal(joinHeight);
        expect(
            result.proof?.milestones.map((run) =>
                run.map((block) => block.height)
            )
        ).to.deep.equal([heightRange(joinHeight, latestHeight)]);
        expect(
            new Set(
                result.proof!.milestones[0].flatMap((block) => block.signers)
            )
        ).to.deep.equal(new Set(h.peers.map((peer) => peer.address)));
        const voter = h.getPeer(offlineIndex).address;
        expect(
            result
                .proof!.milestones[0].filter((block) =>
                    block.signers.includes(voter)
                )
                .map((block) => block.height)
        ).to.deep.equal([latestHeight]);
        await h
            .control(h.getPeer(observerIndex))
            .stub.stripStoredBlockSignature(forkId, latestHeight, voter)
            .request();
        const missing = await exactFinalProofView(h, observerIndex, joinHeight);
        expect(missing.proof).to.equal(null);
        expect(missing.after).to.equal(missing.before);
    });

    it("TO1: exact exit finality retains the old and new union and needs its sole later confirmation", async function () {
        const h = TestSession.getHarness();
        const {
            observerIndex,
            voterIndex,
            leaverIndex,
            forkId,
            finalHeight,
            supportHeight,
            releaseExitPost
        } = await stageExactExitWithLaterVote(h);
        try {
            const result = await exactFinalProofView(
                h,
                observerIndex,
                finalHeight
            );
            expect(result.after).to.equal(result.before);
            expect(result.proof?.valid).to.equal(true);
            expect(result.proof?.usedNonGenesisStart).to.equal(false);
            expect(result.proof?.finalHeight).to.equal(finalHeight);
            expect(
                result.proof?.milestones.map((run) =>
                    run.map((block) => block.height)
                )
            ).to.deep.equal([[finalHeight, supportHeight]]);
            expect(result.proof!.participants[0]).not.to.include(
                h.getPeer(leaverIndex).address
            );
            expect(
                new Set(
                    result.proof!.milestones[0].flatMap(
                        (block) => block.signers
                    )
                )
            ).to.deep.equal(new Set(h.peers.map((peer) => peer.address)));
            const voter = h.getPeer(voterIndex).address;
            expect(
                result
                    .proof!.milestones[0].filter((block) =>
                        block.signers.includes(voter)
                    )
                    .map((block) => block.height)
            ).to.deep.equal([supportHeight]);
            await h
                .control(h.getPeer(observerIndex))
                .stub.stripStoredBlockSignature(forkId, supportHeight, voter)
                .request();
            const missing = await exactFinalProofView(
                h,
                observerIndex,
                finalHeight
            );
            expect(missing.proof).to.equal(null);
            expect(missing.after).to.equal(missing.before);
        } finally {
            await releaseExitPost();
        }
    });

    it("TO1: an exact join point above the frozen view keeps later audit votes without advancing the view", async function () {
        const h = TestSession.getHarness();
        const { auditorIndex, joinHeight, latestHeight, frozenNextHeight } =
            await stageExactJoinAboveView(h);
        const result = await exactFinalProofView(h, auditorIndex, joinHeight);
        expect(result.before).to.equal(frozenNextHeight);
        expect(result.after).to.equal(frozenNextHeight);
        expect(result.proof?.valid).to.equal(true);
        expect(result.proof?.usedNonGenesisStart).to.equal(false);
        expect(result.proof?.finalHeight).to.equal(joinHeight);
        expect(
            result.proof?.milestones.map((run) =>
                run.map((block) => block.height)
            )
        ).to.deep.equal([heightRange(joinHeight, latestHeight)]);
        expect(
            new Set(
                result.proof!.milestones[0].flatMap((block) => block.signers)
            )
        ).to.deep.equal(
            new Set([0, 1, 2].map((index) => h.getPeer(index).address))
        );
    });

    it("TO1: an exact point after an earlier join builds both overlapping hops above the frozen view", async function () {
        const h = TestSession.getHarness();
        const { auditorIndex, joinHeight, latestHeight, frozenNextHeight } =
            await stageExactJoinAboveView(h);
        const target = latestHeight - 1;
        expect(target).to.be.greaterThan(joinHeight);
        const result = await exactFinalProofView(h, auditorIndex, target);
        expect(result.before).to.equal(frozenNextHeight);
        expect(result.after).to.equal(frozenNextHeight);
        expect(result.proof?.valid).to.equal(true);
        expect(result.proof?.usedNonGenesisStart).to.equal(false);
        expect(result.proof?.finalHeight).to.equal(target);
        expect(
            result.proof?.milestones.map((run) =>
                run.map((block) => block.height)
            )
        ).to.deep.equal([
            heightRange(joinHeight, latestHeight),
            [target, latestHeight]
        ]);
        for (const run of result.proof!.milestones)
            expect(
                new Set(run.flatMap((block) => block.signers))
            ).to.deep.equal(
                new Set([0, 1, 2].map((index) => h.getPeer(index).address))
            );
    });

    describe("backward search and milestone shape", function () {
        // U22, genesis case (no final point; the genesis-linked block-0 run):
        // "latest block missing a signature → one unfinalized genesis-linked
        // milestone, the chain walk accepts it" in AgreementManager.test.ts

        it("a threshold-final block an audit verified above the view → the final proof at its height proves it on chain; the view-bounded construction still ends at the view's final point", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            const forkId = h.activeForkId!;
            // the pending auditor never finalized the head
            const { auditorIndex, headHeight } = await stageBlindPendingAuditor(
                h,
                [0, 1, 2]
            );
            await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            // its audit verifies the head and stores it without moving the view
            await h.dispute.auditDispute(
                auditorIndex,
                dispute,
                dispute.postedAuditingData ? auditingData : undefined
            );
            expect(
                await h
                    .control(h.getPeer(auditorIndex))
                    .query.getBlockHashAt(forkId, headHeight)
                    .request(),
                "the audit stored the verified head"
            ).to.not.equal(null);

            const built = await h.execOnHost(
                h.getPeer(auditorIndex),
                async (sm, args) => {
                    const am = sm.agreementManager;
                    const above = await am.buildFinalProof(
                        args.forkId,
                        args.headHeight
                    );
                    const view = await am.buildFinalProof(args.forkId);
                    const chainWalk =
                        await sm.stateChannelManagerContract.verifyMilestones.staticCall(
                            above.finalProof
                        );
                    return {
                        viewHeight:
                            sm.storage.blocks.getNextBlockHeight(args.forkId) -
                            1,
                        aboveFinal: above.finalizedSnapshot.blockHeight,
                        viewFinal: view.finalizedSnapshot.blockHeight,
                        chainValid: chainWalk.valid,
                        chainFinal: Number(
                            chainWalk.finalizedSnapshot.blockHeight
                        )
                    };
                },
                { forkId, headHeight }
            );

            expect(built.viewHeight).to.be.lessThan(headHeight);
            expect(built.aboveFinal).to.equal(headHeight);
            expect(built.chainValid).to.equal(true);
            expect(built.chainFinal).to.equal(headHeight);
            expect(built.viewFinal).to.be.at.most(built.viewHeight);
        });

        it("U22: backward construction finds the latest final point and appends the unfinalized tail to its milestone", async function () {
            const h = TestSession.getHarness();
            const { observerIndex, latestHeight } =
                await stageFinalThenUnfinalizedTail(h, { postAnchor: false });

            const view = await buildProofView(h, observerIndex);

            // block 1 is the latest final point; 2..3 are its unfinalized tail
            expect(view.milestoneHeights).to.deep.equal([[1, 2, latestHeight]]);
            expect(view.start.hash).to.equal(view.genesisHash);
            expect(view.finalized.hash).to.equal(
                await blockSnapshotHashAt(h, observerIndex, 1)
            );
            expect(view.chainWalk.valid).to.equal(true);
            expect(view.chainWalk.finalized.hash).to.equal(view.finalized.hash);
            expect(view.chainWalk.replayBlockIndex).to.equal(1);
        });

        it("U23: a later final starting block whose run overlaps the join milestone stays a separate last milestone", async function () {
            const h = TestSession.getHarness();
            const {
                joinHeight: j,
                observerIndex,
                latestHeight: t
            } = await stageJoinHopWithLaterFinalPoint(h, { postAnchor: false });

            const view = await buildProofView(h, observerIndex);

            // the join hop needs j..t (the late signer signs only t); the
            // backward search proves t - 1 final with t - 1 and t
            expect(t - 1).to.be.greaterThan(j);
            expect(view.milestoneHeights).to.deep.equal([
                heightRange(j, t),
                [t - 1, t]
            ]);
            expect(view.finalized.hash).to.equal(
                await blockSnapshotHashAt(h, observerIndex, t - 1)
            );
            // both hops keep their evidence: the chain proves each of them
            expect(view.chainWalk.valid).to.equal(true);
            expect(view.chainWalk.finalized.hash).to.equal(view.finalized.hash);
        });

        it("D6: a hop whose JOIN is consumed and whose joiner exits within it, to the block after the exit → without the joiner's signature neither the SDK nor the walk proves it final; with it both do, and the SDK's set keeps that signature", async function () {
            const h = TestSession.getHarness();
            const {
                joinHeight: j,
                leaveHeight: k,
                joinerIndex,
                latestHeight
            } = await stageJoinThenLeave(h);
            const joiner = h.getPeer(joinerIndex).address;
            // peer 0 lost the joiner's signature on the join block and the
            // block after it: the join block's own hop cannot be proven from
            // its storage, so its one hop spans the join and the exit
            await h
                .control(h.getPeer(0))
                .stub.stripStoredBlockSignature(h.activeForkId!, j, joiner)
                .request();
            await dropStoredBlock(h, 0, j + 1);
            // the local diamond's walk of peer 0's stored run k + 1.. as one hop
            const localDiamondWalk = async () => {
                const blockConfirmations = await storedConfirmations(
                    h,
                    0,
                    heightRange(k + 1, latestHeight)
                );
                const tiers = await walkAllTiersView(h, 0, {
                    milestones: [{ blockConfirmations }]
                });
                return tiers.find((walk) => walk.tier === "localDiamond")!;
            };

            const without = await buildProofView(h, 0, { finalizedOnly: true });
            const walkWithout = await localDiamondWalk();
            await addStoredSignature(h, 0, k + 1, joinerIndex);
            const withJoiner = await buildProofView(h, 0, {
                finalizedOnly: true
            });
            const walkWith = await localDiamondWalk();

            // the hop starts at the genesis; the joiner is in neither snapshot
            expect(without.start.hash).to.equal(without.genesisHash);
            expect(walkWithout.start).to.equal(null);
            expect(without.startParticipants).to.not.include(joiner);
            expect(withJoiner.milestoneParticipants[0]).to.not.include(joiner);
            // without its signature: no final point above the exit, and the
            // walk of the hop to k + 1 rejects it
            expect(without.milestoneHeights).to.deep.equal([[k]]);
            expect(walkWithout.valid).to.equal(false);
            // with it: the same hop is a final point, the SDK kept the
            // joiner's signature as required, and the walk accepts it
            expect(withJoiner.milestoneHeights).to.deep.equal([[k + 1]]);
            expect(withJoiner.milestoneSigners[0][0]).to.include(joiner);
            expect(walkWith.valid).to.equal(true);
        });

        it("D6 control: an ordinary join hop → the SDK's set is the previous and resulting participants (the joiner is resulting), and the proof is unchanged", async function () {
            const h = TestSession.getHarness();
            const { joinHeight: j, observerIndex } =
                await stageFinalJoinThenUnfinalizedTail(h);
            const joiner = h.getPeer(2).address;

            const finalized = await buildProofView(h, observerIndex, {
                finalizedOnly: true
            });
            const view = await buildProofView(h, observerIndex);

            expect(finalized.startParticipants).to.not.include(joiner);
            expect(finalized.milestoneParticipants[0]).to.include(joiner);
            // the SDK keeps only the signatures its set requires
            expect(finalized.milestoneHeights).to.deep.equal([[j]]);
            expect([
                ...new Set(finalized.milestoneSigners[0].flat())
            ]).to.have.members(hopUnion(finalized, 0));
            expect(finalized.chainWalk.valid).to.equal(true);
            expect(view.milestoneHeights).to.deep.equal([[j, j + 1, j + 2]]);
            expect(view.chainWalk.valid).to.equal(true);
        });

        it("U104: two joins → each join milestone is the minimum forward run proving its hop, the last milestone is found backward from the latest block", async function () {
            const h = TestSession.getHarness();
            const { changeHeights, latestHeight } = await stageTwoJoins(h);
            expect(changeHeights).to.have.length(2);

            const view = await buildProofView(h, 0);

            expect(view.milestoneHeights).to.have.length(3);
            for (const i of [0, 1]) {
                const blocks = view.milestoneSigners[i];
                expect(view.milestoneHeights[i][0]).to.equal(changeHeights[i]);
                // the run proves its hop, and stops at the block completing it
                expect(coversAll(blocks, hopUnion(view, i))).to.equal(true);
                expect(
                    coversAll(blocks.slice(0, -1), hopUnion(view, i))
                ).to.equal(false);
            }
            // the latest block is fully signed: the backward search from it
            // stops at once, so the last milestone is that block alone and it
            // is the final point
            expect(view.milestoneHeights[2]).to.deep.equal([latestHeight]);
            expect(view.finalized.hash).to.equal(
                await blockSnapshotHashAt(h, 0, latestHeight)
            );
            expect(view.chainWalk.valid).to.equal(true);
        });

        it("U105: no later final point above the join milestone → the join milestone extends to the latest block, no second milestone at its start", async function () {
            const h = TestSession.getHarness();
            const { joinHeight: j, observerIndex } =
                await stageFinalJoinThenUnfinalizedTail(h);

            const view = await buildProofView(h, observerIndex);

            expect(view.milestoneHeights).to.deep.equal([[j, j + 1, j + 2]]);
            expect(view.finalized.hash).to.equal(
                await blockSnapshotHashAt(h, observerIndex, j)
            );
            expect(view.chainWalk.valid).to.equal(true);
            expect(view.chainWalk.replayBlockIndex).to.equal(1);
        });

        it("U103: block n+1 supplies the finality evidence of n → the proof ends at n+1 and its final point is n", async function () {
            const h = TestSession.getHarness();
            const { observerIndex } = await stageFinalityFromNextBlock(h);

            const view = await buildProofView(h, observerIndex);
            const finalizedOnly = await buildProofView(h, observerIndex, {
                finalizedOnly: true
            });
            const prepared = await prepareSameForkView(h, observerIndex);

            const finalPoint = await blockSnapshotHashAt(h, observerIndex, 2);
            expect(view.milestoneHeights).to.deep.equal([[2, 3]]);
            expect(view.finalized.hash).to.equal(finalPoint);
            expect(view.chainWalk.valid).to.equal(true);
            // block 3 is evidence, not an unfinalized tail to drop
            expect(finalizedOnly.milestoneHeights).to.deep.equal([[2, 3]]);
            // the snapshot update targets the proven final point
            expect(prepared.callDataCount).to.equal(1);
            expect(prepared.expectedSnapshotHash).to.equal(finalPoint);
        });
    });

    describe("construction start", function () {
        it("U24: a current local diamond → construction starts at its anchor, the chain anchor", async function () {
            const h = TestSession.getHarness();
            const { anchor } = await stageFinalBlocks(h, {
                postAnchor: true,
                finalBlocks: 2
            });

            const view = await buildProofView(h, 2);

            expect(view.start.hash).to.equal(anchor!.hash);
            expect(
                view.milestoneHeights
                    .flat()
                    .every((height) => height > anchor!.height)
            ).to.equal(true);
            expect(view.chainWalk.valid).to.equal(true);
            expect(view.chainWalk.start!.hash).to.equal(anchor!.hash);
        });

        it("U24: a local diamond lagging a newer chain anchor → construction starts at the fork genesis, the chain walk still accepts the proof", async function () {
            const h = TestSession.getHarness();
            const lagging = 1;
            const { anchor } = await stageFinalBlocks(h, {
                postAnchor: true,
                finalBlocks: 2,
                laggingIndices: [lagging]
            });
            expect(
                (await h.query.getLocalStateSnapshot(h.getPeer(lagging))).hash,
                "the lagging mirror keeps the older snapshot"
            ).to.not.equal(anchor!.hash);

            const view = await buildProofView(h, lagging);

            expect(view.start.hash).to.equal(view.genesisHash);
            expect(view.chainWalk.start!.hash).to.equal(anchor!.hash);
            expect(view.chainWalk.valid).to.equal(true);
        });

        it("U25: a local finalized state ahead of the local diamond anchor → verification starts there, construction still starts at the anchor", async function () {
            const h = TestSession.getHarness();
            const { latestHeight } = await stageFinalBlocks(h, {
                postAnchor: false,
                finalBlocks: 1
            });

            const localFinalized = await localFinalizedView(h, 0);
            const view = await buildProofView(h, 0);
            const verified = await verifyProofView(h, 0, view.stateProof);

            expect(localFinalized!.height).to.equal(latestHeight);
            expect(view.start.hash).to.equal(view.genesisHash);
            expect(verified.thrown).to.equal(null);
            expect(verified.walk!.tier).to.equal("localFinalized");
            expect(verified.walk!.start!.hash).to.equal(localFinalized!.hash);
            expect(verified.walk!.valid).to.equal(true);
        });

        it("U93: verifying from local finalized height 3 while the mirror and chain hold anchor 1 → neither moves; construction still starts at anchor 1 and the chain accepts it", async function () {
            const h = TestSession.getHarness();
            const { anchor, latestHeight } = await stageFinalBlocks(h, {
                postAnchor: true,
                finalBlocks: 2
            });
            const observer = h.getPeer(0);

            const localFinalized = await localFinalizedView(h, 0);
            const before = await buildProofView(h, 0);
            const verified = await verifyProofView(h, 0, before.stateProof);
            const after = await buildProofView(h, 0);

            expect(localFinalized!.height).to.equal(latestHeight);
            expect(verified.walk!.tier).to.equal("localFinalized");
            expect(verified.walk!.start!.height).to.equal(latestHeight);
            expect(verified.walk!.valid).to.equal(true);
            // the mirror and the chain keep the anchor
            expect(
                (await h.query.getLocalStateSnapshot(observer)).hash
            ).to.equal(anchor!.hash);
            expect((await chainSnapshot(h)).hash).to.equal(anchor!.hash);
            // construction is unchanged by the verification
            expect(after.start.hash).to.equal(anchor!.hash);
            expect(after.milestoneHeights).to.deep.equal(
                before.milestoneHeights
            );
            expect(after.chainWalk.valid).to.equal(true);
            expect(after.chainWalk.start!.hash).to.equal(anchor!.hash);
        });
    });

    describe("successor fork", function () {
        it("U101: successor fork while the chain anchor is on its ancestor → the empty proof starts at the successor genesis; every tier walks from that genesis", async function () {
            const h = TestSession.getHarness();
            const { successorForkId, ancestorAnchor, release } =
                await stageUnpostedSuccessorFork(h);
            try {
                const view = await buildProofView(h, 0, {
                    forkId: successorForkId,
                    height: -1
                });
                const tiers = await walkAllTiersView(
                    h,
                    0,
                    view.stateProof,
                    successorForkId
                );

                expect(view.milestoneHeights).to.deep.equal([]);
                expect(view.start.hash).to.equal(view.genesisHash);
                expect(view.start.forkId).to.equal(successorForkId);
                expect(view.finalized.hash).to.equal(view.genesisHash);
                // no local final state on a fork without blocks; the mirror
                // and the chain both walk from the successor genesis
                expect(tiers.map((walk) => walk.tier)).to.deep.equal([
                    "localDiamond",
                    "chain"
                ]);
                for (const walk of tiers) {
                    expect(walk.start, walk.tier).to.equal(null);
                    expect(walk.valid, walk.tier).to.equal(true);
                    expect(walk.finalized.forkId, walk.tier).to.equal(
                        successorForkId
                    );
                    expect(walk.finalized.hash, walk.tier).to.not.equal(
                        ancestorAnchor.hash
                    );
                    expect(walk.finalized.hash, walk.tier).to.equal(
                        view.genesisHash
                    );
                }
            } finally {
                await release();
            }
        });

        it("U101: successor fork while the chain anchor is on its ancestor → a genesis-linked unfinalized block 0 proof starts at the successor genesis; every tier walks from that genesis", async function () {
            const h = TestSession.getHarness();
            const { successorForkId, ancestorAnchor, writerIndex, release } =
                await stageSuccessorBlockZero(h);
            try {
                const view = await buildProofView(h, writerIndex, {
                    forkId: successorForkId,
                    height: 0
                });
                const tiers = await walkAllTiersView(
                    h,
                    writerIndex,
                    view.stateProof,
                    successorForkId
                );

                // block 0 alone, unfinalized: the whole run is the tail
                expect(view.milestoneHeights).to.deep.equal([[0]]);
                expect(view.start.hash).to.equal(view.genesisHash);
                expect(view.start.forkId).to.equal(successorForkId);
                expect(view.finalized.hash).to.equal(view.genesisHash);
                expect(view.chainWalk.valid).to.equal(true);
                expect(view.chainWalk.start).to.equal(null);
                expect(view.chainWalk.replayBlockIndex).to.equal(0);
                // nothing is final on the successor; the mirror and the chain
                // both walk from the successor genesis
                expect(tiers.map((walk) => walk.tier)).to.deep.equal([
                    "localDiamond",
                    "chain"
                ]);
                for (const walk of tiers) {
                    expect(walk.start, walk.tier).to.equal(null);
                    expect(walk.valid, walk.tier).to.equal(true);
                    expect(walk.replayBlockIndex, walk.tier).to.equal(0);
                    expect(walk.finalized.forkId, walk.tier).to.equal(
                        successorForkId
                    );
                    expect(walk.finalized.hash, walk.tier).to.not.equal(
                        ancestorAnchor.hash
                    );
                    expect(walk.finalized.hash, walk.tier).to.equal(
                        view.genesisHash
                    );
                }
            } finally {
                await release();
            }
        });

        it("U102: the ancestor fork's genesis data supplied for the successor fork → no tier establishes the successor genesis", async function () {
            const h = TestSession.getHarness();
            const { sourceForkId, successorForkId, release } =
                await stageUnpostedSuccessorFork(h);
            try {
                const tiers = await walkEmptyProofWithGenesis(h, {
                    forkId: successorForkId,
                    genesisForkId: sourceForkId
                });

                expect(tiers.map((walk) => walk.tier)).to.deep.equal([
                    "localDiamond",
                    "chain"
                ]);
                expect(tiers.every((walk) => !walk.valid)).to.equal(true);
            } finally {
                await release();
            }
        });

        it("U102: the successor genesis data with a substituted origin fork → no tier establishes the successor genesis", async function () {
            const h = TestSession.getHarness();
            const { successorForkId, release } =
                await stageUnpostedSuccessorFork(h);
            try {
                const control = await walkEmptyProofWithGenesis(h, {
                    forkId: successorForkId,
                    genesisForkId: successorForkId
                });
                const tiers = await walkEmptyProofWithGenesis(h, {
                    forkId: successorForkId,
                    genesisForkId: successorForkId,
                    originForkId: ethers.hexlify(ethers.randomBytes(32))
                });

                // control: the genuine successor genesis verifies
                expect(control.every((walk) => walk.valid)).to.equal(true);
                expect(tiers.map((walk) => walk.tier)).to.deep.equal([
                    "localDiamond",
                    "chain"
                ]);
                expect(tiers.every((walk) => !walk.valid)).to.equal(true);
            } finally {
                await release();
            }
        });
    });

    describe("reconstruction", function () {
        it("U97: a pruned required anchor-run block → construction throws; after the genuine blocks are restored a new attempt builds the proof", async function () {
            const h = TestSession.getHarness();
            const { forkId, anchor, observerIndex, latestHeight } =
                await stageFinalThenUnfinalizedTail(h, { postAnchor: true });
            const a = anchor!.height;
            const genuine = await storedConfirmations(h, observerIndex, [
                a,
                a + 1
            ]);
            const pruned = await h
                .control(h.getPeer(observerIndex))
                .stub.pruneStoredBlocksBelowAnchor(forkId, latestHeight)
                .request();
            expect(pruned.prunedHeights).to.include.members([a, a + 1]);

            const failed = await tryBuildProofView(h, observerIndex);

            expect(failed.view).to.equal(null);
            expect(failed.thrown).to.match(
                new RegExp(`missing the required block at height ${a}`)
            );

            expect(
                await restoreStoredBlocks(h, observerIndex, genuine)
            ).to.equal(2);
            const rebuilt = await buildProofView(h, observerIndex);

            expect(rebuilt.start.hash).to.equal(anchor!.hash);
            expect(rebuilt.milestoneHeights).to.deep.equal([
                [a, a + 1, latestHeight]
            ]);
            expect(rebuilt.chainWalk.valid).to.equal(true);
        });

        it("U97: a pruned participant-change block above the anchor → construction throws instead of skipping the hop", async function () {
            const h = TestSession.getHarness();
            const { forkId, joinHeight, observerIndex } =
                await stageJoinHopWithLaterFinalPoint(h, { postAnchor: true });
            await h
                .control(h.getPeer(observerIndex))
                .stub.pruneStoredBlocksBelowAnchor(forkId, joinHeight + 1)
                .request();

            const failed = await tryBuildProofView(h, observerIndex);

            expect(failed.view).to.equal(null);
            expect(failed.thrown).to.match(
                new RegExp(
                    `missing the participant-change block at height ${joinHeight}`
                )
            );
        });

        it("U97: the join hop's confirmation by a required signer is lost above the anchor → construction proves the block before the hop final and carries the hop in the unfinalized tail", async function () {
            const h = TestSession.getHarness();
            const {
                forkId,
                anchor,
                joinHeight: j,
                observerIndex,
                offlineIndex
            } = await stageFinalJoinThenUnfinalizedTail(h, {
                postAnchor: true,
                offlineConfirmsJoin: true
            });
            // control: the join hop is proven by j alone
            const control = await buildProofView(h, observerIndex);
            expect(control.start.hash).to.equal(anchor!.hash);
            expect(control.milestoneHeights).to.deep.equal([[j, j + 1, j + 2]]);
            // the offline peer signed only j: its confirmation there is the
            // hop's required evidence
            await h
                .control(h.getPeer(observerIndex))
                .stub.stripStoredBlockSignature(
                    forkId,
                    j,
                    h.getPeer(offlineIndex).address
                )
                .request();

            const view = await buildProofView(h, observerIndex);

            // j - 1 needs only the pre-join set; j..j+2 are its tail
            expect(view.start.hash).to.equal(anchor!.hash);
            expect(view.milestoneHeights).to.deep.equal([
                [j - 1, j, j + 1, j + 2]
            ]);
            expect(view.finalized.hash).to.equal(
                await blockSnapshotHashAt(h, observerIndex, j - 1)
            );
            expect(view.chainWalk.valid).to.equal(true);
            expect(view.chainWalk.finalized.hash).to.equal(view.finalized.hash);
            expect(view.chainWalk.replayBlockIndex).to.equal(1);
        });

        it("U97: the pruned snapshot of a join block above the anchor → construction throws instead of skipping the hop", async function () {
            const h = TestSession.getHarness();
            const {
                anchor,
                joinHeight: j,
                observerIndex
            } = await stageJoinHopWithLaterFinalPoint(h, { postAnchor: true });
            const control = await buildProofView(h, observerIndex);
            expect(control.start.hash).to.equal(anchor!.hash);
            expect(control.milestoneHeights[0][0]).to.equal(j);
            await h
                .control(h.getPeer(observerIndex))
                .stub.deleteStoredSnapshot(
                    await blockSnapshotHashAt(h, observerIndex, j)
                )
                .request();

            const failed = await tryBuildProofView(h, observerIndex);

            expect(failed.view).to.equal(null);
            expect(failed.thrown).to.match(
                /Milestone built but corresponding snapshot not found/
            );
        });

        it("U117: history pruned below the observed anchor, a join hop and virtual-voting evidence above it → the latest proof, the anchor proof and the replay state all remain", async function () {
            const h = TestSession.getHarness();
            const {
                forkId,
                anchor,
                joinHeight: j,
                observerIndex,
                latestHeight: t
            } = await stageJoinHopWithLaterFinalPoint(h, { postAnchor: true });
            const before = await buildProofView(h, observerIndex);
            const belowAnchor = await blockSnapshotHashAt(
                h,
                observerIndex,
                anchor!.height - 1
            );
            const stub = h.control(h.getPeer(observerIndex)).stub;
            // snapshots and states first: they are found through the blocks
            const prunedSnapshots = await stub
                .pruneStoredSnapshotsBelowAnchor(forkId, anchor!.height)
                .request();
            const pruned = await stub
                .pruneStoredBlocksBelowAnchor(forkId, anchor!.height)
                .request();
            expect(prunedSnapshots.prunedSnapshotHashes).to.include(
                belowAnchor
            );
            expect(pruned.prunedHeights.length).to.be.greaterThan(0);
            expect(
                await h
                    .control(h.getPeer(observerIndex))
                    .query.getStateSnapshotStructByHash(belowAnchor)
                    .request(),
                "history below the anchor is gone"
            ).to.equal(null);

            const latest = await buildProofView(h, observerIndex);
            const atAnchor = await buildProofView(h, observerIndex, {
                height: anchor!.height
            });
            const verified = await verifyProofView(
                h,
                observerIndex,
                latest.stateProof
            );

            // the same proof as before pruning: nothing below the anchor is used
            expect(latest.start.hash).to.equal(anchor!.hash);
            expect(latest.milestoneHeights).to.deep.equal(
                before.milestoneHeights
            );
            expect(latest.milestoneHeights).to.deep.equal([
                heightRange(j, t),
                [t - 1, t]
            ]);
            expect(latest.chainWalk.valid).to.equal(true);
            // the anchor state itself stays representable
            expect(atAnchor.milestoneHeights).to.deep.equal([[anchor!.height]]);
            expect(atAnchor.chainWalk.valid).to.equal(true);
            expect(atAnchor.finalized.hash).to.equal(anchor!.hash);
            // the latest final state is verified and its full state is held
            expect(verified.walk!.valid).to.equal(true);
            expect(
                await h
                    .control(h.getPeer(observerIndex))
                    .query.getStateMachineState(latest.finalized.stateHash)
                    .request()
            ).to.not.equal(null);
        });

        it("U117: a spectator synced at the anchor as its latest finalized state → the anchor block, snapshot and full state are stored and its anchor proof verifies", async function () {
            const h = TestSession.getHarness();
            const { forkId, anchor } = await stageFinalBlocks(h, {
                postAnchor: true,
                finalBlocks: 0
            });
            const payload = await servedPayload(h, h.getPeer(0), forkId);
            expect(proofHeights(payload)).to.deep.equal([[anchor!.height]]);
            expect(Number(payload.milestoneSnapshots[0].blockHeight)).to.equal(
                anchor!.height
            );
            const spectator = await freshSpectatorSyncedFrom(
                h,
                h.getPeer(0),
                [0, 1, 2],
                [0, 1, 2],
                forkId
            );
            const query = h.control(spectator).query;
            const atAnchor = await buildProofView(h, spectator.index, {
                height: anchor!.height
            });

            expect(atAnchor.start.hash).to.equal(anchor!.hash);
            expect(atAnchor.milestoneHeights).to.deep.equal([[anchor!.height]]);
            expect(atAnchor.chainWalk.valid).to.equal(true);
            expect(atAnchor.finalized.hash).to.equal(anchor!.hash);
            const stored = await query
                .getBlockByHeight(forkId, anchor!.height)
                .request();
            expect(stored?.stateSnapshotHash).to.equal(anchor!.hash);
            expect(
                await query.getStateSnapshotStructByHash(anchor!.hash).request()
            ).to.not.equal(null);
            expect(
                await query
                    .getStateMachineState(atAnchor.finalized.stateHash)
                    .request()
            ).to.equal(payload.latestFinalizedEncodedState);
        });

        it("U117: a spectator synced from a proof with a join hop and virtual-voting evidence above the anchor holds no history below the join → its latest proof rebuilds from the anchor, verifies, and its replay state is held", async function () {
            const h = TestSession.getHarness();
            const {
                forkId,
                anchor,
                joinHeight: j,
                observerIndex,
                latestHeight: t
            } = await stageJoinHopWithLaterFinalPoint(h, { postAnchor: true });
            const served = await buildProofView(h, observerIndex);
            const payload = await servedPayload(
                h,
                h.getPeer(observerIndex),
                forkId
            );
            expect(proofHeights(payload)).to.deep.equal(
                served.milestoneHeights
            );
            expect(j).to.be.greaterThan(anchor!.height);
            expect(served.finalized.height).to.equal(t - 1);
            expect(served.finalized.height).to.be.greaterThan(anchor!.height);
            expect(
                ethers.keccak256(payload.latestFinalizedEncodedState)
            ).to.equal(served.finalized.stateHash);
            const spectator = await freshSpectatorSyncedFrom(
                h,
                h.getPeer(observerIndex),
                [0, 1, 2],
                [0, 1, 2],
                forkId
            );
            const query = h.control(spectator).query;
            await waitFor(
                async () =>
                    (await query.getNextBlockHeight(forkId).request()) ===
                    t + 1,
                h.event.protocolEventTimeoutMs()
            );

            const latest = await buildProofView(h, spectator.index);
            const verified = await verifyProofView(
                h,
                spectator.index,
                latest.stateProof
            );

            // the sync stored nothing below the join: no older history to keep
            for (const height of heightRange(0, j - 1))
                expect(
                    await query.getBlockByHeight(forkId, height).request(),
                    `no block at height ${height}`
                ).to.equal(null);
            expect(served.milestoneHeights).to.deep.equal([
                heightRange(j, t),
                [t - 1, t]
            ]);
            // the synced evidence rebuilds the served proof from the anchor
            expect(latest.start.hash).to.equal(anchor!.hash);
            expect(latest.milestoneHeights).to.deep.equal(
                served.milestoneHeights
            );
            expect(latest.chainWalk.valid).to.equal(true);
            expect(latest.finalized).to.deep.equal(served.finalized);
            expect(verified.walk!.valid).to.equal(true);
            expect(
                await query
                    .getStateMachineState(latest.finalized.stateHash)
                    .request()
            ).to.equal(payload.latestFinalizedEncodedState);
        });
    });

    describe("consumers of a failed construction", function () {
        it("U98: dispute construction over a pruned required block → dispute() rejects and no dispute reaches the chain", async function () {
            const h = TestSession.getHarness();
            const { forkId, observerIndex, latestHeight } =
                await stageFinalThenUnfinalizedTail(h, { postAnchor: true });
            await h
                .control(h.getPeer(observerIndex))
                .stub.pruneStoredBlocksBelowAnchor(forkId, latestHeight)
                .request();

            const r = await h.execOnHost(
                h.getPeer(observerIndex),
                async (sm, args) => {
                    let thrown = "";
                    try {
                        await sm.disputeManager.dispute(args.forkId);
                    } catch (error) {
                        thrown =
                            error instanceof Error
                                ? error.message
                                : String(error);
                    }
                    return { thrown };
                },
                { forkId }
            );

            expect(r.thrown).to.match(/missing the required block/);
            expect(
                await h.channelManager.getWindowCommitments(h.channelId, forkId)
            ).to.have.length(0);
        });

        it("U98: sync serving over a pruned required block → generateSyncPayload rejects instead of serving a shorter proof", async function () {
            const h = TestSession.getHarness();
            const { forkId, observerIndex, latestHeight } =
                await stageFinalThenUnfinalizedTail(h, { postAnchor: true });
            await h
                .control(h.getPeer(observerIndex))
                .stub.pruneStoredBlocksBelowAnchor(forkId, latestHeight)
                .request();

            const r = await h.execOnHost(
                h.getPeer(observerIndex),
                async (sm) => {
                    let thrown = "";
                    let served = false;
                    try {
                        served =
                            (await sm.p2pManager.localRpc.spectateService.generateSyncPayload(
                                sm.channelId
                            )) !== undefined;
                    } catch (error) {
                        thrown =
                            error instanceof Error
                                ? error.message
                                : String(error);
                    }
                    return { thrown, served };
                }
            );

            expect(r.served).to.equal(false);
            expect(r.thrown).to.match(/missing the required block/);
        });

        it("U98: snapshot posting over a pruned participant-change block above the anchor → the post rejects with the missing-block error, no transaction is sent and the chain snapshot stays", async function () {
            const h = TestSession.getHarness();
            const { forkId, anchor, joinHeight, observerIndex } =
                await stageJoinHopWithLaterFinalPoint(h, { postAnchor: true });
            await h
                .control(h.getPeer(observerIndex))
                .stub.pruneStoredBlocksBelowAnchor(forkId, joinHeight + 1)
                .request();
            // records every multicall the peer sends; fails none
            const sends = await h.rpcStub.failFirstAdoptionPost(
                observerIndex,
                0
            );

            const r = await h.execOnHost(
                h.getPeer(observerIndex),
                async (sm) => {
                    let thrown = "";
                    try {
                        await sm.snapshotUpdateService.postStateSnapshotWait(
                            sm.forkId
                        );
                    } catch (error) {
                        thrown =
                            error instanceof Error
                                ? error.message
                                : String(error);
                    }
                    return { thrown };
                }
            );
            const sent = await sends.restore();

            expect(r.thrown).to.match(
                new RegExp(
                    `missing the participant-change block at height ${joinHeight}`
                )
            );
            expect(sent).to.deep.equal([]);
            expect((await chainSnapshot(h)).hash).to.equal(anchor!.hash);
        });

        it("U98 (control): snapshot posting with every required block held → the update is sent and the chain adopts the last milestone's first block", async function () {
            const h = TestSession.getHarness();
            const { observerIndex, latestHeight: t } =
                await stageJoinHopWithLaterFinalPoint(h, { postAnchor: true });
            const finalPoint = await blockSnapshotHashAt(
                h,
                observerIndex,
                t - 1
            );
            const sends = await h.rpcStub.failFirstAdoptionPost(
                observerIndex,
                0
            );

            const posted = await postSnapshotFrom(h, observerIndex);
            const sent = await sends.restore();

            expect(posted).to.equal(true);
            expect(sent.flat()).to.include("updateStateSnapshotSameFork");
            expect((await chainSnapshot(h)).hash).to.equal(finalPoint);
        });

        it("U98: snapshot posting whose proof construction fails on its chain walk → the post rejects and the chain snapshot stays", async function () {
            const h = TestSession.getHarness();
            const lagging = 2;
            const { anchor } = await stageMirrorMissingTopUp(h, {
                laggingIndex: lagging,
                anchorBeforeTopUp: true
            });
            const observed = await h.mirror.observe(
                lagging,
                "verifyMilestones"
            );
            await h.mirror.failNextChainRead(
                lagging,
                "verifyMilestones",
                "transport"
            );

            const r = await h.execOnHost(h.getPeer(lagging), async (sm) => {
                let thrown = "";
                try {
                    await sm.snapshotUpdateService.postStateSnapshotWait(
                        sm.forkId
                    );
                } catch (error) {
                    thrown =
                        error instanceof Error ? error.message : String(error);
                }
                return { thrown };
            });
            const observation = await observed.observation();
            await observed.restore();

            expect(r.thrown).to.not.equal("");
            // the lagging mirror cannot prove the hop, so the chain walk ran
            // and failed
            expect(observation.chain.failures).to.have.length(1);
            expect((await chainSnapshot(h)).hash).to.equal(anchor!.hash);
        });
    });
});

import { DisputeFraudProofType } from "@/types/sol-enums";
import {
    blockStructWithTransactionHeader,
    hash as randomHash
} from "@test/factory";
import {
    ANCHORED_TAIL,
    addConfirmations,
    appendInvalidTransition,
    appendNonAuthenticBlock,
    appendOutsiderBlock,
    applyChallenges,
    applyStructureChallenge,
    authorChallenge,
    expectKilledByChallenge,
    expectLastRunHeights,
    expectNoChallengeThroughKillPeriod,
    invalidTransitionChallenge,
    onlyAuditorKills,
    prependStoredBlocks,
    relinkChallengeBlock,
    reissueBlock,
    signersOf,
    replaceAuthorSignature,
    stageAnchorBeforeUnfinalizedTail,
    stageBlockZeroAnchor,
    stageGenesisAnchorZeroRun,
    stagePendingJoinerAfterAnchor,
    stageStaleGenesisClaim,
    storedChallengeBlockIndex,
    structureChallenge,
    uploadBelowAnchorClaim,
    uploadSelfRemovalDispute,
    uploadStaleDispute,
    withForgedBody
} from "@test/fixtures/ChallengeBoundaryStaging";
import { commitmentOf } from "@test/fixtures/DisputeWindowWorkflowStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

const { offlineIndex: OFFLINE, submitterIndex: SUBMITTER } = ANCHORED_TAIL;
// the anchored-tail auditors: peer 2 is offline but still audits from the chain
const AUDITORS = [0, 1, OFFLINE];
// E40: the participant that issues the block after the boundary
const ISSUER = 0;

describe("E2E: dispute validation / anchor counters and block-challenge boundary", function () {
    describe("E02: block zero's resulting snapshot as the anchor", function () {
        it("E02: block zero final, its snapshot posted, then a stale empty-proof genesis dispute uploaded → DisputeStateProofBelowOnChainAnchor kills it and only its submitter is slashed", async function () {
            const h = TestSession.getHarness();
            const { forkId, stale } = await stageStaleGenesisClaim(h);

            await uploadStaleDispute(h, 1, stale);

            await expectKilledByChallenge(h, {
                proofType:
                    DisputeFraudProofType.DisputeStateProofBelowOnChainAnchor,
                auditorIndices: [0, 2],
                slashedIndices: [1]
            });
            await h.dispute.resolveDisputeWait({ forkId });
        });

        it("E02 ext: an auditor whose local mirror never applied the block-zero snapshot post kills the stale empty-proof genesis dispute from the chain's anchor", async function () {
            const h = TestSession.getHarness();
            const lagging = 2;
            const { stale, genesisHash } = await stageStaleGenesisClaim(h, {
                laggingIndex: lagging
            });
            const [other] = await onlyAuditorKills(h, lagging, [0, lagging]);

            await uploadStaleDispute(h, 1, stale);

            await expectKilledByChallenge(h, {
                proofType:
                    DisputeFraudProofType.DisputeStateProofBelowOnChainAnchor,
                auditorIndices: [lagging, other.index],
                slashedIndices: [1]
            });
            // the current auditor reached the same verdict and stayed out of the kill
            await other.kill.waitUntilSkipped();
            // the counter was decided from the chain's anchor: this mirror
            // still holds the genesis snapshot
            expect(
                (await h.query.getLocalStateSnapshot(h.getPeer(lagging))).hash
            ).to.equal(genesisHash);
        });
    });

    describe("E16: below-anchor claim by a disputer that never signed the anchor", function () {
        it("E16: a pending joiner whose join landed after the anchor was posted uploads a proof ending below that anchor → the anchor alone kills it (DisputeStateProofBelowOnChainAnchor), only the joiner is slashed", async function () {
            const h = TestSession.getHarness();
            const { forkId, joiner, anchorHeight, belowAnchor } =
                await stagePendingJoinerAfterAnchor(h);
            const anchorBlock = await h
                .control(h.getPeer(0))
                .query.getBlockByHeight(forkId, anchorHeight)
                .request();
            if (!anchorBlock) throw new Error("expected the anchor block");
            expect(anchorBlock.author).to.not.equal(joiner.address);
            expect(anchorBlock.confirmationSignerAddresses).to.not.include(
                joiner.address
            );

            const dispute = await uploadBelowAnchorClaim(
                h,
                joiner.index,
                belowAnchor
            );
            expect(dispute.input.disputer).to.equal(joiner.address);

            await expectKilledByChallenge(h, {
                proofType:
                    DisputeFraudProofType.DisputeStateProofBelowOnChainAnchor,
                auditorIndices: [0, 1, 2],
                slashedIndices: [joiner.index]
            });
        });
    });

    // The submitter's proof [2, 3, 4] gets blocks 0 and 1 in front of it, so
    // the chain anchor (block 2) sits at index 2 of the last milestone.
    describe("E17: anchor inside the last milestone", function () {
        it("E17: correct blocks before, at and after the anchor → no block-specific counter, no kill, the submitter is not slashed", async function () {
            const h = TestSession.getHarness();
            const forkId = await stageAnchorBeforeUnfinalizedTail(h);

            await uploadSelfRemovalDispute(
                h,
                SUBMITTER,
                async (dispute) => {
                    await prependStoredBlocks(h, dispute, [0, 1]);
                    expectLastRunHeights(dispute, [0, 1, 2, 3, 4]);
                },
                { markMalicious: false }
            );

            await expectNoChallengeThroughKillPeriod(h, {
                forkId,
                auditorIndices: AUDITORS
            });
        });

        it("E17: forged history before the anchor (a forged block 0, so a broken link at index 1) → no auditor challenges it, and the structure, invalid-transition and author challenges naming those positions are all rejected on chain: no kill, the challenger is slashed, the submitter is not", async function () {
            const h = TestSession.getHarness();
            const forkId = await stageAnchorBeforeUnfinalizedTail(h);

            const dispute = await uploadSelfRemovalDispute(
                h,
                SUBMITTER,
                async (dispute) => {
                    await prependStoredBlocks(h, dispute, [0, 1]);
                    await reissueBlock(h, dispute, 0, withForgedBody);
                    expectLastRunHeights(dispute, [0, 1, 2, 3, 4]);
                },
                { markMalicious: true }
            );
            expect(
                await h.channelManager.isInvalidBlockStructureInStateProof(
                    dispute.input.stateProof,
                    1
                ),
                "index 1 must not link to the forged block"
            ).to.equal(true);
            // every block-specific family against the protected history;
            // block 0's transition and index 1's link are real faults, block
            // 0's author is a participant
            await applyChallenges(
                h,
                1,
                dispute,
                [
                    structureChallenge(1),
                    await invalidTransitionChallenge(h, 0, dispute, 0),
                    await authorChallenge(h, 0, dispute, 0)
                ],
                { markMalicious: true }
            );

            await expectNoChallengeThroughKillPeriod(h, {
                forkId,
                auditorIndices: [0, OFFLINE],
                slashedIndices: [1]
            });
        });

        it("E17: forged history into the anchor (a forged block 1, so a broken link at the anchor's index 2) → no auditor challenges it, and the structure, invalid-transition and author challenges naming block 1 and the anchor are all rejected on chain: no kill, the challenger is slashed, the submitter is not", async function () {
            const h = TestSession.getHarness();
            const forkId = await stageAnchorBeforeUnfinalizedTail(h);

            const dispute = await uploadSelfRemovalDispute(
                h,
                SUBMITTER,
                async (dispute) => {
                    await prependStoredBlocks(h, dispute, [0, 1]);
                    await reissueBlock(h, dispute, 1, withForgedBody);
                    expectLastRunHeights(dispute, [0, 1, 2, 3, 4]);
                },
                { markMalicious: true }
            );
            expect(
                await h.channelManager.isInvalidBlockStructureInStateProof(
                    dispute.input.stateProof,
                    2
                ),
                "the anchor block must not link to the forged block"
            ).to.equal(true);
            // neither the forged block nor the anchor is challengeable
            for (const index of [1, 2])
                expect(
                    await h.channelManager.isBlockChallengeEligible(
                        dispute,
                        index
                    ),
                    `index ${index} must be protected`
                ).to.equal(false);
            // block 1's transition and the anchor's link are real faults;
            // every family is applied at block 1 and at the anchor
            await applyChallenges(
                h,
                1,
                dispute,
                [
                    structureChallenge(2),
                    await invalidTransitionChallenge(h, 0, dispute, 1),
                    await authorChallenge(h, 0, dispute, 1),
                    await invalidTransitionChallenge(h, 0, dispute, 2),
                    await authorChallenge(h, 0, dispute, 2)
                ],
                { markMalicious: true }
            );

            await expectNoChallengeThroughKillPeriod(h, {
                forkId,
                auditorIndices: [0, OFFLINE],
                slashedIndices: [1]
            });
        });

        it("E17: invalid transition in a replayed block after the anchor → DisputeInvalidBlockInStateProofApplyFraudProof kills the dispute on chain, only the submitter is slashed", async function () {
            const h = TestSession.getHarness();
            const forkId = await stageAnchorBeforeUnfinalizedTail(h);

            await uploadSelfRemovalDispute(
                h,
                SUBMITTER,
                async (dispute) => {
                    await prependStoredBlocks(h, dispute, [0, 1]);
                    await appendInvalidTransition(h, dispute, SUBMITTER);
                    expectLastRunHeights(dispute, [0, 1, 2, 3, 4, 5]);
                },
                { markMalicious: true }
            );

            await expectKilledByChallenge(h, {
                proofType:
                    DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof,
                auditorIndices: AUDITORS,
                slashedIndices: [SUBMITTER]
            });
            // the counter names the appended block: index 5 of [0, 1, 2, 3, 4, 5]
            expect(
                await storedChallengeBlockIndex(
                    h,
                    0,
                    DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
                )
            ).to.equal(5);
            await h.dispute.resolveDisputeWait({ forkId });
        });

        it("E17: a block after the anchor signed by another key than its author's → DisputeInvalidBlockStructure kills the dispute on chain, neither the named author nor the signer is slashed", async function () {
            const h = TestSession.getHarness();
            const forkId = await stageAnchorBeforeUnfinalizedTail(h);

            await uploadSelfRemovalDispute(
                h,
                SUBMITTER,
                async (dispute) => {
                    await prependStoredBlocks(h, dispute, [0, 1]);
                    await appendNonAuthenticBlock(h, dispute, 0, 1);
                    expectLastRunHeights(dispute, [0, 1, 2, 3, 4, 5]);
                },
                { markMalicious: true }
            );

            await expectKilledByChallenge(h, {
                proofType: DisputeFraudProofType.DisputeInvalidBlockStructure,
                auditorIndices: AUDITORS,
                slashedIndices: [SUBMITTER]
            });
            // the counter names the appended block: index 5 of [0, 1, 2, 3, 4, 5]
            expect(
                await storedChallengeBlockIndex(
                    h,
                    0,
                    DisputeFraudProofType.DisputeInvalidBlockStructure
                )
            ).to.equal(5);
            await h.dispute.resolveDisputeWait({ forkId });
        });

        it("E17: a block after the anchor authored by a non-participant → DisputeBlockAuthorNotParticipant kills the dispute on chain, only the submitter is slashed", async function () {
            const h = TestSession.getHarness();
            const forkId = await stageAnchorBeforeUnfinalizedTail(h);

            await uploadSelfRemovalDispute(
                h,
                SUBMITTER,
                async (dispute) => {
                    await prependStoredBlocks(h, dispute, [0, 1]);
                    await appendOutsiderBlock(dispute);
                    expectLastRunHeights(dispute, [0, 1, 2, 3, 4, 5]);
                },
                { markMalicious: true }
            );

            await expectKilledByChallenge(h, {
                proofType:
                    DisputeFraudProofType.DisputeBlockAuthorNotParticipant,
                auditorIndices: AUDITORS,
                slashedIndices: [SUBMITTER]
            });
            // the counter names the appended block: index 5 of [0, 1, 2, 3, 4, 5]
            expect(
                await storedChallengeBlockIndex(
                    h,
                    0,
                    DisputeFraudProofType.DisputeBlockAuthorNotParticipant
                )
            ).to.equal(5);
            await h.dispute.resolveDisputeWait({ forkId });
        });

        it("E17: a block after the anchor naming another fork → DisputeStateProofHeaderMismatch kills the dispute on chain, only the submitter is slashed", async function () {
            const h = TestSession.getHarness();
            const forkId = await stageAnchorBeforeUnfinalizedTail(h);

            await uploadSelfRemovalDispute(
                h,
                SUBMITTER,
                async (dispute) => {
                    await prependStoredBlocks(h, dispute, [0, 1]);
                    await reissueBlock(h, dispute, 4, (block) =>
                        blockStructWithTransactionHeader(block, {
                            forkId: randomHash()
                        })
                    );
                    expectLastRunHeights(dispute, [0, 1, 2, 3, 4]);
                },
                { markMalicious: true }
            );

            await expectKilledByChallenge(h, {
                proofType:
                    DisputeFraudProofType.DisputeStateProofHeaderMismatch,
                auditorIndices: AUDITORS,
                slashedIndices: [SUBMITTER]
            });
            await h.dispute.resolveDisputeWait({ forkId });
        });

        it("E17 ext: a structure challenge naming a position outside the last milestone (index 5 of 5 blocks) is rejected on chain: no kill, the challenger is slashed, the submitter is not", async function () {
            const h = TestSession.getHarness();
            const forkId = await stageAnchorBeforeUnfinalizedTail(h);

            const dispute = await uploadSelfRemovalDispute(
                h,
                SUBMITTER,
                async (dispute) => {
                    await prependStoredBlocks(h, dispute, [0, 1]);
                    expectLastRunHeights(dispute, [0, 1, 2, 3, 4]);
                },
                { markMalicious: false }
            );
            await applyStructureChallenge(h, 1, dispute, 5);

            await expectNoChallengeThroughKillPeriod(h, {
                forkId,
                auditorIndices: [0, OFFLINE],
                slashedIndices: [1]
            });
        });
    });

    describe("E18: block zero with the genesis anchor and with its own snapshot as the anchor", function () {
        it("E18: genesis anchor, unfinalized block zero with a non-authentic author signature → DisputeInvalidBlockStructure at index 0 kills the dispute, only the submitter is slashed (not block zero's author)", async function () {
            const h = TestSession.getHarness();
            const forkId = await stageGenesisAnchorZeroRun(h, {
                finalizedZero: false
            });

            await uploadSelfRemovalDispute(
                h,
                SUBMITTER,
                async (dispute) => {
                    expectLastRunHeights(dispute, [0, 1]);
                    if (!dispute.postedAuditingData)
                        throw new Error(
                            "an unfinalized genesis run must post its auditing data"
                        );
                    await replaceAuthorSignature(h, dispute, 0, 1);
                },
                { markMalicious: true }
            );

            await expectKilledByChallenge(h, {
                proofType: DisputeFraudProofType.DisputeInvalidBlockStructure,
                auditorIndices: [0, 1, 2],
                slashedIndices: [SUBMITTER]
            });
            await h.dispute.resolveDisputeWait({ forkId });
        });

        it("E18: genesis anchor, unfinalized block zero, correct blocks → no block-specific counter, no kill", async function () {
            const h = TestSession.getHarness();
            const forkId = await stageGenesisAnchorZeroRun(h, {
                finalizedZero: false
            });

            await uploadSelfRemovalDispute(
                h,
                SUBMITTER,
                async (dispute) => {
                    expectLastRunHeights(dispute, [0, 1]);
                },
                { markMalicious: false }
            );

            await expectNoChallengeThroughKillPeriod(h, {
                forkId,
                auditorIndices: [0, 1, 2]
            });
        });

        it("E18: genesis anchor, threshold-final block zero with a forged transaction re-signed by every participant → zero stays everyone-final and eligible: an invalid-transition challenge at index 0 kills the dispute on chain, a challenge at the ineligible index 2 is rejected; only the submitter and the rejected challenger are slashed", async function () {
            const h = TestSession.getHarness();
            const forkId = await stageGenesisAnchorZeroRun(h, {
                finalizedZero: true
            });

            const dispute = await uploadSelfRemovalDispute(
                h,
                SUBMITTER,
                async (dispute) => {
                    expectLastRunHeights(dispute, [0, 1]);
                    await reissueBlock(h, dispute, 0, withForgedBody);
                    await relinkChallengeBlock(h, dispute, 1);
                },
                { markMalicious: true }
            );
            // zero is still signed by every participant: threshold-final
            expect([...signersOf(dispute, 0)].sort()).to.deep.equal(
                h.peers.map((peer) => peer.address).sort()
            );
            expect(
                await h.channelManager.isBlockChallengeEligible(dispute, 0)
            ).to.equal(true);
            expect(
                await h.channelManager.isBlockChallengeEligible(dispute, 2)
            ).to.equal(false);

            // a position outside the milestone is not challengeable
            await applyChallenges(h, 1, dispute, [structureChallenge(2)], {
                markMalicious: true
            });
            await h.assert.dispute.slashedOnChainExactly([
                h.getPeer(1).address
            ]);
            expect(
                await h.channelManager.getWindowCommitments(h.channelId, forkId)
            ).to.include(commitmentOf(dispute));

            // zero's real fault at its own position kills the dispute
            await applyChallenges(
                h,
                0,
                dispute,
                [await invalidTransitionChallenge(h, 0, dispute, 0)],
                { markMalicious: false }
            );
            await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                mode: "atLeast"
            });
            await h.assert.dispute.slashedOnChainExactly([
                h.getPeer(1).address,
                h.getPeer(SUBMITTER).address
            ]);
            await h.dispute.resolveDisputeWait({ forkId });
        });

        it("E18: genesis anchor, threshold-final block zero, correct blocks → no block-specific counter, no kill", async function () {
            const h = TestSession.getHarness();
            const forkId = await stageGenesisAnchorZeroRun(h, {
                finalizedZero: true
            });

            await uploadSelfRemovalDispute(
                h,
                SUBMITTER,
                async (dispute) => {
                    expectLastRunHeights(dispute, [0, 1]);
                },
                { markMalicious: false }
            );

            await expectNoChallengeThroughKillPeriod(h, {
                forkId,
                auditorIndices: [0, 1, 2]
            });
        });

        it("E18: block zero's resulting snapshot as the anchor protects zero: a forged transaction in block zero gets no block-specific challenge, no kill, the submitter is not slashed", async function () {
            const h = TestSession.getHarness();
            const forkId = await stageBlockZeroAnchor(h);

            const dispute = await uploadSelfRemovalDispute(
                h,
                SUBMITTER,
                async (dispute) => {
                    expectLastRunHeights(dispute, [0]);
                    await reissueBlock(h, dispute, 0, withForgedBody);
                },
                { markMalicious: true }
            );
            expect(
                await h.channelManager.isBlockChallengeEligible(dispute, 0)
            ).to.equal(false);

            await expectNoChallengeThroughKillPeriod(h, {
                forkId,
                auditorIndices: [0, 1, 2]
            });
        });
    });

    // The submitter's proof is the anchor-holding run [2, 3, 4]: the anchor
    // is the last milestone's first block, the protected boundary. The faulty
    // and the correct block after it are issued by peer 0, not the submitter.
    describe("E40: provable fault after the protected boundary", function () {
        it("E40: invalid transition in a block after the boundary issued by another participant → DisputeInvalidBlockInStateProofApplyFraudProof kills the dispute, the submitter is slashed and, by the separate block fraud proof against the block it issued, the issuer", async function () {
            const h = TestSession.getHarness();
            const forkId = await stageAnchorBeforeUnfinalizedTail(h);

            await uploadSelfRemovalDispute(
                h,
                SUBMITTER,
                async (dispute) => {
                    expectLastRunHeights(dispute, [2, 3, 4]);
                    await appendInvalidTransition(h, dispute, ISSUER);
                    expect(signersOf(dispute, 3)[0]).to.equal(
                        h.getPeer(ISSUER).address
                    );
                },
                { markMalicious: true }
            );

            await expectKilledByChallenge(h, {
                proofType:
                    DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof,
                auditorIndices: AUDITORS,
                slashedIndices: [SUBMITTER, ISSUER]
            });
            await h.dispute.resolveDisputeWait({ forkId });
        });

        it("E40: the invalid block after the boundary, issued by another participant, carries every participant's signature (evidence that could prove its finality) → still eligible: DisputeInvalidBlockInStateProofApplyFraudProof kills the dispute, the submitter is slashed and, by the separate block fraud proof against the block it issued, the issuer", async function () {
            const h = TestSession.getHarness();
            const forkId = await stageAnchorBeforeUnfinalizedTail(h);

            await uploadSelfRemovalDispute(
                h,
                SUBMITTER,
                async (dispute) => {
                    expectLastRunHeights(dispute, [2, 3, 4]);
                    await appendInvalidTransition(h, dispute, ISSUER, [
                        1,
                        OFFLINE,
                        SUBMITTER
                    ]);
                    expect([...signersOf(dispute, 3)].sort()).to.deep.equal(
                        h.peers.map((peer) => peer.address).sort()
                    );
                },
                { markMalicious: true }
            );

            await expectKilledByChallenge(h, {
                proofType:
                    DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof,
                auditorIndices: AUDITORS,
                slashedIndices: [SUBMITTER, ISSUER]
            });
            await h.dispute.resolveDisputeWait({ forkId });
        });

        it("E40: a correct block after the boundary issued by another participant, carrying every participant's signature → eligibility alone is no offense: no counter, no kill, nobody slashed", async function () {
            const h = TestSession.getHarness();
            const forkId = await stageAnchorBeforeUnfinalizedTail(h);

            await uploadSelfRemovalDispute(
                h,
                SUBMITTER,
                async (dispute) => {
                    expectLastRunHeights(dispute, [2, 3, 4]);
                    // the boundary's successors: a real block issued by
                    // another participant than the submitter
                    const index = [1, 2].find(
                        (candidate) =>
                            signersOf(dispute, candidate)[0] !==
                            h.getPeer(SUBMITTER).address
                    );
                    if (index === undefined)
                        throw new Error(
                            "the submitter issued every block after the boundary"
                        );
                    // it lacks only the offline peer's signature
                    await addConfirmations(h, dispute, index, [OFFLINE]);
                    expect([...signersOf(dispute, index)].sort()).to.deep.equal(
                        h.peers.map((peer) => peer.address).sort()
                    );
                },
                { markMalicious: false }
            );

            await expectNoChallengeThroughKillPeriod(h, {
                forkId,
                auditorIndices: AUDITORS
            });
        });
    });
});

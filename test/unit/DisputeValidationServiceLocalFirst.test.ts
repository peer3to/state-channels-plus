import Block from "@/models/Block";
import { DisputeFraudProofType } from "@/types/sol-enums";
import { Codec, hash, Type } from "@/utils";
import { hash as randomHash } from "@test/factory";
import {
    constructTimeoutOfCalldataPostedBlock,
    stageBlindPendingAuditor
} from "@test/fixtures/DisputeAuditStaging";
import {
    stageMirrorMissingConsumedTopUp,
    stageStaleGenesisDispute
} from "@test/fixtures/MirrorDivergenceStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

// The auditor's checks read the chain, never the mirror. Each case observes
// the auditor's mirror and chain reads record-only; the reads still reach the
// real contracts.
describe("Unit: DisputeValidationService chain reads", function () {
    // a mismatch is judged only on challenge-eligible blocks, which the
    // anchor decides
    describe("hasStateProofHeaderMismatch", function () {
        it("matching header -> one chain read, no mirror read, true, no proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            const reads = await h.mirror.observe(
                1,
                "hasStateProofHeaderMismatch"
            );

            const run = await h.dispute.auditDispute(1, dispute);

            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
            const { local, chain } = await reads.observation();
            expect(local.reads).to.equal(0);
            expect(chain.answers).to.deep.equal([false]);
        });

        it("milestones[-1].blockConfirmations[-1] header.forkId = random -> one chain read, false + DisputeStateProofHeaderMismatch", async function () {
            const h = TestSession.getHarness();
            // no block is final while peer 2 is away: the proof is one
            // genesis-linked run from block 0, so its last block is eligible
            await h.scenario.preDisputeSetupDisconnectedPeer();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(3);
            expect(dispute.postedAuditingData).to.equal(true);
            await h.tamper.mismatchLastMilestoneHeader(dispute, {
                forkId: randomHash()
            });
            const reads = await h.mirror.observe(
                1,
                "hasStateProofHeaderMismatch"
            );

            const run = await h.dispute.auditDispute(1, dispute, auditingData);

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeStateProofHeaderMismatch
            );
            const { local, chain } = await reads.observation();
            expect(local.reads).to.equal(0);
            expect(chain.answers).to.deep.equal([true]);
        });
    });

    describe("isAuditingDataOmissionAllowed", function () {
        it("chain final -> one chain read, no mirror read, true, no proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            expect(dispute.postedAuditingData).to.equal(false);
            const reads = await h.mirror.observe(
                1,
                "isAuditingDataOmissionAllowed"
            );

            const run = await h.dispute.auditDispute(1, dispute);

            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
            const { local, chain } = await reads.observation();
            expect(local.reads).to.equal(0);
            expect(chain.answers).to.deep.equal([true]);
        });

        it("chain reads proven, chain final -> one chain read, no mirror read, true, no proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            expect(dispute.postedAuditingData).to.equal(false);
            const auditor = h.control(h.getPeer(1));
            await auditor.stub.stubProvenChainReads().request();
            try {
                const reads = await h.mirror.observe(
                    1,
                    "isAuditingDataOmissionAllowed"
                );

                const run = await h.dispute.auditDispute(1, dispute);

                expect(run).to.include({ outcome: "returned", isValid: true });
                expect(run.disputeFraudProofCount).to.equal(0);
                const { local, chain } = await reads.observation();
                await reads.restore();
                expect(local.reads).to.equal(0);
                expect(chain.answers).to.deep.equal([true]);
            } finally {
                await auditor.stub.restoreProvenChainReads().request();
            }
        });

        it("chain not final -> one chain read, no mirror read, false + DisputeLastMilestoneNotFinalAndNoAuditingData", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            expect(dispute.postedAuditingData).to.equal(true);
            dispute.postedAuditingData = false;
            const reads = await h.mirror.observe(
                1,
                "isAuditingDataOmissionAllowed"
            );

            const run = await h.dispute.auditDispute(1, dispute);

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData
            );
            const { local, chain } = await reads.observation();
            expect(local.reads).to.equal(0);
            expect(chain.answers).to.deep.equal([false]);
        });

        it("chain view before the join final -> one chain read, no mirror read, the chain answer wins, no DisputeLastMilestoneNotFinalAndNoAuditingData", async function () {
            const h = TestSession.getHarness();
            // peer 3 joins late: the head milestone waits for its signature
            await h.scenario.preDisputeSetupCalldataPath();
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            dispute.postedAuditingData = false;
            const reads = await h.mirror.observe(
                1,
                "isAuditingDataOmissionAllowed"
            );
            // the chain view lags the mirror: it has not seen the join, so
            // the pre-join participants who signed the milestone are everyone
            await h.mirror.serveChainReadsBefore(
                1,
                "isAuditingDataOmissionAllowed",
                "InboundMessagesProcessed"
            );

            const run = await h.dispute.auditDispute(1, dispute);

            const { local, chain } = await reads.observation();
            expect(local.reads).to.equal(0);
            expect(chain.answers).to.deep.equal([true]);
            expect(run.outcome).to.equal("returned");
            expect(run.storedProof?.disputeFraudProofType).to.not.equal(
                DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData
            );
        });

        it("chain RPC refuses the connection -> the audit throws it, no mirror read, no proof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            dispute.postedAuditingData = false;
            const reads = await h.mirror.observe(
                1,
                "isAuditingDataOmissionAllowed"
            );
            await h.mirror.failNextChainRead(
                1,
                "isAuditingDataOmissionAllowed",
                "transport"
            );

            const run = await h.dispute.auditDispute(1, dispute);

            const { local, chain } = await reads.observation();
            expect(local.reads).to.equal(0);
            expect(chain.failures).to.have.length(1);
            expect(chain.failureCodes).to.not.include("CALL_EXCEPTION");
            expect(run.outcome).to.equal("threw");
            expect(run.disputeFraudProofCount).to.equal(0);
        });
    });

    describe("isCorrectLatestState", function () {
        it("chain correct -> one chain read, no mirror read, true, no proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            expect(dispute.postedAuditingData).to.equal(false);
            const reads = await h.mirror.observe(1, "isCorrectLatestState");

            const run = await h.dispute.auditDispute(1, dispute);

            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
            const { local, chain } = await reads.observation();
            expect(local.reads).to.equal(0);
            expect(chain.answers).to.deep.equal([true]);
        });

        it("dispute.input.latestStateSnapshotHash = random: chain incorrect -> one chain read, no mirror read, false + DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            dispute.input.latestStateSnapshotHash = randomHash();
            const reads = await h.mirror.observe(1, "isCorrectLatestState");

            const run = await h.dispute.auditDispute(1, dispute);

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidStateProof
            );
            const { local, chain } = await reads.observation();
            expect(local.reads).to.equal(0);
            expect(chain.answers).to.deep.equal([false]);
        });

        it("stale genesis dispute after a same-fork snapshot post -> false + DisputeStateProofBelowOnChainAnchor, no isCorrectLatestState read", async function () {
            const h = TestSession.getHarness();
            const { dispute } = await stageStaleGenesisDispute(h);
            expect(dispute.postedAuditingData).to.equal(false);
            const reads = await h.mirror.observe(1, "isCorrectLatestState");

            const run = await h.dispute.auditDispute(1, dispute);

            // the chain's anchor is above the genesis claim: the below-anchor
            // counter kills it before the latest-state check runs
            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.disputeFraudProofCount).to.equal(1);
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeStateProofBelowOnChainAnchor
            );
            const { local, chain } = await reads.observation();
            expect(local.reads).to.equal(0);
            expect(chain.reads).to.equal(0);
        });

        it("dispute.input.latestStateSnapshotHash = random: chain RPC refuses the connection -> the audit throws it, no mirror read, no proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            dispute.input.latestStateSnapshotHash = randomHash();
            const reads = await h.mirror.observe(1, "isCorrectLatestState");
            await h.mirror.failNextChainRead(
                1,
                "isCorrectLatestState",
                "transport"
            );

            const run = await h.dispute.auditDispute(1, dispute);

            const { local, chain } = await reads.observation();
            expect(local.reads).to.equal(0);
            expect(chain.failures).to.have.length(1);
            expect(chain.failureCodes).to.not.include("CALL_EXCEPTION");
            expect(run.outcome).to.equal("threw");
            expect(run.disputeFraudProofCount).to.equal(0);
        });
    });

    describe("verifyBalanceInvariantCheckSnapshot", function () {
        it("chain valid -> one chain read, no mirror read, true, no proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            const reads = await h.mirror.observe(
                1,
                "verifyBalanceInvariantCheckSnapshot"
            );

            const run = await h.dispute.auditDispute(1, dispute);

            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
            const { local, chain } = await reads.observation();
            expect(local.reads).to.equal(0);
            expect(chain.answers).to.deep.equal([true]);
        });

        it("forged totalDeposits, audited by a pending auditor without a final block at the forged head: chain invalid -> one chain read, no mirror read, false + DisputeInvalidBalanceInvariant", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            // the colluders' head is one the auditor never finalized
            const { auditorIndex } = await stageBlindPendingAuditor(
                h,
                [0, 1, 2]
            );
            const forged = await h.tamper.buildForgedSnapshot(
                2,
                (ctx) => ({
                    snapshotData: {
                        ...ctx.originalSnapshotData,
                        totalDeposits: {
                            ...ctx.originalSnapshotData.totalDeposits,
                            amount:
                                BigInt(
                                    ctx.originalSnapshotData.totalDeposits
                                        .amount
                                ) + 1n
                        }
                    }
                }),
                { withoutSignerIndices: [auditorIndex] }
            );
            // forged head block + forged snapshot committed by the dispute
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(2);
            // premise: the head is final, so it is the last milestone's
            // only block and no replayed tail meets the forged block
            const milestone = dispute.input.stateProof.milestones.at(-1)!;
            expect(milestone.blockConfirmations).to.have.length(1);
            milestone.blockConfirmations[0] =
                forged.forgedBlock.blockConfirmationStruct;
            auditingData.milestoneSnapshots[
                auditingData.milestoneSnapshots.length - 1
            ] = forged.forgedSnapshot.toStruct();
            auditingData.latestStateSnapshot = forged.forgedSnapshot.toStruct();
            dispute.input.latestStateSnapshotHash = forged.forgedSnapshot.hash;
            dispute.input.disputeAuditingDataHash = hash(
                Codec.encode(auditingData, Type.DisputeAuditingData)
            );
            dispute.postedAuditingData = true;
            const reads = await h.mirror.observe(
                auditorIndex,
                "verifyBalanceInvariantCheckSnapshot"
            );

            const run = await h.dispute.auditDispute(
                auditorIndex,
                dispute,
                auditingData
            );

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidBalanceInvariant
            );
            const { local, chain } = await reads.observation();
            expect(local.reads).to.equal(0);
            expect(chain.answers).to.deep.equal([false]);
        });

        it("mirror missing a consumed top-up: chain valid -> one chain read, no mirror read, the chain answer wins, true, no proof", async function () {
            const h = TestSession.getHarness();
            await stageMirrorMissingConsumedTopUp(h, 1);
            await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            const reads = await h.mirror.observe(
                1,
                "verifyBalanceInvariantCheckSnapshot"
            );

            const run = await h.dispute.auditDispute(1, dispute, auditingData);

            const { local, chain } = await reads.observation();
            expect(local.reads).to.equal(0);
            expect(chain.answers).to.deep.equal([true]);
            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
        });

        it("mirror missing a consumed top-up: chain RPC refuses the connection -> the audit throws it, no mirror read, no proof", async function () {
            const h = TestSession.getHarness();
            await stageMirrorMissingConsumedTopUp(h, 1);
            await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            const reads = await h.mirror.observe(
                1,
                "verifyBalanceInvariantCheckSnapshot"
            );
            await h.mirror.failNextChainRead(
                1,
                "verifyBalanceInvariantCheckSnapshot",
                "transport"
            );

            const run = await h.dispute.auditDispute(1, dispute, auditingData);

            const { local, chain } = await reads.observation();
            expect(local.reads).to.equal(0);
            expect(chain.failures).to.have.length(1);
            expect(chain.failureCodes).to.not.include("CALL_EXCEPTION");
            expect(run.outcome).to.equal("threw");
            expect(run.disputeFraudProofCount).to.equal(0);
        });
    });

    describe("validateTimeoutCalldataPostedProof", function () {
        it("chain valid -> one chain read, no mirror read, false + TimeoutCalldataPosted", async function () {
            const h = TestSession.getHarness();
            const { dispute, auditorIndex } =
                await constructTimeoutOfCalldataPostedBlock(h, {
                    blocksBefore: 2
                });
            dispute.input.timeout.isForced = true;
            const reads = await h.mirror.observe(
                auditorIndex,
                "validateTimeoutCalldataPostedProof"
            );

            const run = await h.dispute.auditDispute(auditorIndex, dispute);

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.TimeoutCalldataPosted
            );
            const { local, chain } = await reads.observation();
            expect(local.reads).to.equal(0);
            expect(chain.answers).to.deep.equal([true]);
        });

        it("mirror and store missing the previous block's calldata post: chain invalid -> one chain read, no mirror read, true, no proof", async function () {
            const h = TestSession.getHarness();
            const {
                dispute,
                auditorIndex,
                previousBlock: block1
            } = await constructTimeoutOfCalldataPostedBlock(h, {
                blocksBefore: 2
            });
            // the auditor misses the previous block's calldata log: its store
            // keeps a stale timestamp and its mirror has no commitment, while
            // the chain commitment carries the real timestamp
            await h
                .control(h.getPeer(auditorIndex))
                .stub.stubCalldataPosting()
                .request();
            await h
                .control(h.getPeer(auditorIndex))
                .validation.stageBlockCalldata(block1!.encodedSignedBlock, 1)
                .request();
            const block1Author = h.peers.find(
                (p) => p.address === block1!.author
            )!;
            await h.transition.postBlockCalldataOnChainWait(
                block1Author,
                block1!.encodedSignedBlock
            );
            const reads = await h.mirror.observe(
                auditorIndex,
                "validateTimeoutCalldataPostedProof"
            );

            const run = await h.dispute.auditDispute(auditorIndex, dispute);

            const { local, chain } = await reads.observation();
            expect(local.reads).to.equal(0);
            expect(chain.answers).to.deep.equal([false]);
            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.storedProof).to.equal(undefined);
        });

        it("store behind the chain on the previous block's calldata: chain invalid -> one chain read, no mirror read, true, no proof", async function () {
            const h = TestSession.getHarness();
            const {
                dispute,
                auditorIndex,
                previousBlock: block1
            } = await constructTimeoutOfCalldataPostedBlock(h, {
                blocksBefore: 2
            });
            const auditor = h.getPeer(auditorIndex);
            const applied = auditor.eventSpies.onPostedCalldata?.callCount ?? 0;
            const block1Author = h.peers.find(
                (p) => p.address === block1!.author
            )!;
            await h.transition.postBlockCalldataOnChainWait(
                block1Author,
                block1!.encodedSignedBlock
            );
            // the hook fires after the auditor's mirror took the commitment
            await h.event.waitForPeers(
                "onPostedCalldata",
                [auditor.index],
                applied + 1,
                { mode: "atLeast" }
            );
            // then its store falls behind with a stale timestamp
            await h
                .control(auditor)
                .validation.stageBlockCalldata(block1!.encodedSignedBlock, 1)
                .request();
            // the timed-out participant's signature forfeits the calldata
            // clock, so the late post does not make the timeout too early
            const timedOut = h.peers.find(
                (p) => p.address === dispute.input.timeout.participant
            )!;
            dispute.input.timeout.participantSignatureOnPreviousBlock =
                (await Block.fromSignedBlock(
                    Codec.decode(block1!.encodedSignedBlock, Type.SignedBlock)
                ).sign(timedOut.signer)) as string;
            const reads = await h.mirror.observe(
                auditorIndex,
                "validateTimeoutCalldataPostedProof"
            );

            const run = await h.dispute.auditDispute(auditorIndex, dispute);

            const { local, chain } = await reads.observation();
            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.storedProof).to.equal(undefined);
            expect(local.reads).to.equal(0);
            expect(chain.answers).to.deep.equal([false]);
        });

        it("chain RPC refuses the connection -> the audit throws it, no mirror read, no proof", async function () {
            const h = TestSession.getHarness();
            const { dispute, auditorIndex } =
                await constructTimeoutOfCalldataPostedBlock(h, {
                    blocksBefore: 2
                });
            dispute.input.timeout.isForced = true;
            const reads = await h.mirror.observe(
                auditorIndex,
                "validateTimeoutCalldataPostedProof"
            );
            await h.mirror.failNextChainRead(
                auditorIndex,
                "validateTimeoutCalldataPostedProof",
                "transport"
            );

            const run = await h.dispute.auditDispute(auditorIndex, dispute);

            const { local, chain } = await reads.observation();
            expect(local.reads).to.equal(0);
            expect(chain.failureCodes).to.not.include("CALL_EXCEPTION");
            expect(run.outcome).to.equal("threw");
            expect(run.disputeFraudProofCount).to.equal(0);
        });
    });

    // the same chain reads while the light client proves the chain's answers
    describe("light client stubbed", function () {
        it("hasStateProofHeaderMismatch: matching header -> one chain read, no mirror read, true, no proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            const auditor = h.control(h.getPeer(1));
            await auditor.stub.stubProvenChainReads().request();
            try {
                const reads = await h.mirror.observe(
                    1,
                    "hasStateProofHeaderMismatch"
                );

                const run = await h.dispute.auditDispute(1, dispute);

                expect(run).to.include({ outcome: "returned", isValid: true });
                expect(run.disputeFraudProofCount).to.equal(0);
                const { local, chain } = await reads.observation();
                await reads.restore();
                expect(local.reads).to.equal(0);
                expect(chain.answers).to.deep.equal([false]);
            } finally {
                await auditor.stub.restoreProvenChainReads().request();
            }
        });

        it("isCorrectLatestState: chain correct -> one chain read, no mirror read, true, no proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            const auditor = h.control(h.getPeer(1));
            await auditor.stub.stubProvenChainReads().request();
            try {
                const reads = await h.mirror.observe(1, "isCorrectLatestState");

                const run = await h.dispute.auditDispute(1, dispute);

                expect(run).to.include({ outcome: "returned", isValid: true });
                expect(run.disputeFraudProofCount).to.equal(0);
                const { local, chain } = await reads.observation();
                await reads.restore();
                expect(local.reads).to.equal(0);
                expect(chain.answers).to.deep.equal([true]);
            } finally {
                await auditor.stub.restoreProvenChainReads().request();
            }
        });

        it("verifyBalanceInvariantCheckSnapshot: chain valid -> one chain read, no mirror read, true, no proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            const auditor = h.control(h.getPeer(1));
            await auditor.stub.stubProvenChainReads().request();
            try {
                const reads = await h.mirror.observe(
                    1,
                    "verifyBalanceInvariantCheckSnapshot"
                );

                const run = await h.dispute.auditDispute(1, dispute);

                expect(run).to.include({ outcome: "returned", isValid: true });
                expect(run.disputeFraudProofCount).to.equal(0);
                const { local, chain } = await reads.observation();
                await reads.restore();
                expect(local.reads).to.equal(0);
                expect(chain.answers).to.deep.equal([true]);
            } finally {
                await auditor.stub.restoreProvenChainReads().request();
            }
        });

        it("validateTimeoutCalldataPostedProof: chain valid -> one chain read, no mirror read, false + TimeoutCalldataPosted", async function () {
            const h = TestSession.getHarness();
            const { dispute, auditorIndex } =
                await constructTimeoutOfCalldataPostedBlock(h, {
                    blocksBefore: 2
                });
            dispute.input.timeout.isForced = true;
            const auditor = h.control(h.getPeer(auditorIndex));
            await auditor.stub.stubProvenChainReads().request();
            try {
                const reads = await h.mirror.observe(
                    auditorIndex,
                    "validateTimeoutCalldataPostedProof"
                );

                const run = await h.dispute.auditDispute(auditorIndex, dispute);

                expect(run).to.include({ outcome: "returned", isValid: false });
                expect(run.storedProof?.disputeFraudProofType).to.equal(
                    DisputeFraudProofType.TimeoutCalldataPosted
                );
                const { local, chain } = await reads.observation();
                await reads.restore();
                expect(local.reads).to.equal(0);
                expect(chain.answers).to.deep.equal([true]);
            } finally {
                await auditor.stub.restoreProvenChainReads().request();
            }
        });
    });

    describe("getOnChainSlashedParticipants", function () {
        it("a valid dispute -> the auditor reads the slashed participants from the chain, not the mirror, true, no proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            const reads = await h.mirror.observe(
                1,
                "getOnChainSlashedParticipants"
            );

            const run = await h.dispute.auditDispute(1, dispute);

            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
            const { local, chain } = await reads.observation();
            await reads.restore();
            expect(local.reads).to.equal(0);
            expect(chain.reads).to.be.greaterThan(0);
        });
    });
});

import Block from "@/models/Block";
import { DisputeFraudProofType } from "@/types/sol-enums";
import { Codec, hash, Type } from "@/utils";
import { hash as randomHash } from "@test/factory";
import {
    stageMirrorMissingConsumedTopUp,
    stageStaleGenesisDispute,
    stageTimeoutCalldataPostedDispute
} from "@test/fixtures/MirrorDivergenceStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

// The auditor's local-first reads: the local diamond answers first, and only
// the answer that would make the auditor act against the disputer is asked
// of the chain. Each case observes the auditor's local and chain reads
// record-only; the reads still reach the real contracts.
describe("Unit: DisputeValidationService local-first reads", function () {
    // pure: the local diamond computes exactly what the chain would, so the
    // check never reads the chain, for either answer
    describe("hasStateProofHeaderMismatch", function () {
        it("matching header -> local only, no chain read, true, no proof", async function () {
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
            expect(local.answers).to.deep.equal([false]);
            expect(chain.reads).to.equal(0);
        });

        it("milestones[-1].blockConfirmations[-1] header.forkId = random -> local only, no chain read, false + DisputeStateProofHeaderMismatch", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            await h.tamper.mismatchLastMilestoneHeader(dispute, {
                forkId: randomHash()
            });
            const reads = await h.mirror.observe(
                1,
                "hasStateProofHeaderMismatch"
            );

            const run = await h.dispute.auditDispute(1, dispute);

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeStateProofHeaderMismatch
            );
            const { local, chain } = await reads.observation();
            expect(local.answers).to.deep.equal([true]);
            expect(chain.reads).to.equal(0);
        });
    });

    describe("isLastMilestoneFinalByEveryone", function () {
        it("local final -> kept without a chain read, true, no proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            expect(dispute.postedAuditingData).to.equal(false);
            const reads = await h.mirror.observe(
                1,
                "isLastMilestoneFinalByEveryone"
            );

            const run = await h.dispute.auditDispute(1, dispute);

            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
            const { local, chain } = await reads.observation();
            expect(local.answers).to.deep.equal([true]);
            expect(chain.reads).to.equal(0);
        });

        it("local not final, chain not final -> one chain read, false + DisputeLastMilestoneNotFinalAndNoAuditingData", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            expect(dispute.postedAuditingData).to.equal(true);
            dispute.postedAuditingData = false;
            const reads = await h.mirror.observe(
                1,
                "isLastMilestoneFinalByEveryone"
            );

            const run = await h.dispute.auditDispute(1, dispute);

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData
            );
            const { local, chain } = await reads.observation();
            expect(local.answers).to.deep.equal([false]);
            expect(chain.answers).to.deep.equal([false]);
        });

        it("local not final, chain view before the join final -> one chain read, the chain answer wins, no DisputeLastMilestoneNotFinalAndNoAuditingData", async function () {
            const h = TestSession.getHarness();
            // peer 3 joins late: the head milestone waits for its signature
            await h.scenario.preDisputeSetupCalldataPath();
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            dispute.postedAuditingData = false;
            const reads = await h.mirror.observe(
                1,
                "isLastMilestoneFinalByEveryone"
            );
            // the chain view lags the mirror: it has not seen the join, so
            // the pre-join participants who signed the milestone are everyone
            await h.mirror.serveChainReadsBefore(
                1,
                "isLastMilestoneFinalByEveryone",
                "InboundMessagesProcessed"
            );

            const run = await h.dispute.auditDispute(1, dispute);

            const { local, chain } = await reads.observation();
            expect(local.answers).to.deep.equal([false]);
            expect(chain.answers).to.deep.equal([true]);
            expect(run.outcome).to.equal("returned");
            expect(run.storedProof?.disputeFraudProofType).to.not.equal(
                DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData
            );
        });

        it("local revert -> the chain answers instead, false + DisputeLastMilestoneNotFinalAndNoAuditingData", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            dispute.postedAuditingData = false;
            const reads = await h.mirror.observe(
                1,
                "isLastMilestoneFinalByEveryone"
            );
            await h.mirror.failNextLocalRead(
                1,
                "isLastMilestoneFinalByEveryone",
                "revert"
            );

            const run = await h.dispute.auditDispute(1, dispute);

            const { local, chain } = await reads.observation();
            expect(local.answers).to.deep.equal([]);
            expect(local.failures).to.have.length(1);
            expect(local.failures[0]).to.contain("Local EVM execution failed");
            expect(chain.answers).to.deep.equal([false]);
            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData
            );
        });

        it("local executor failure (not a revert) -> the audit throws it, no chain read, no proof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            dispute.postedAuditingData = false;
            const reads = await h.mirror.observe(
                1,
                "isLastMilestoneFinalByEveryone"
            );
            await h.mirror.failNextLocalRead(
                1,
                "isLastMilestoneFinalByEveryone",
                "transport"
            );

            const run = await h.dispute.auditDispute(1, dispute);

            expect(run.outcome).to.equal("threw");
            expect(run.outcome === "threw" ? run.threwMessage : "").to.contain(
                "Malformed RPC request"
            );
            expect(run.disputeFraudProofCount).to.equal(0);
            const { local, chain } = await reads.observation();
            expect(local.failures).to.have.length(1);
            expect(local.failures[0]).to.not.contain(
                "Local EVM execution failed"
            );
            expect(chain.reads).to.equal(0);
        });

        it("local not final, chain RPC refuses the connection -> the audit throws it, no proof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            dispute.postedAuditingData = false;
            const reads = await h.mirror.observe(
                1,
                "isLastMilestoneFinalByEveryone"
            );
            await h.mirror.failNextChainRead(
                1,
                "isLastMilestoneFinalByEveryone",
                "transport"
            );

            const run = await h.dispute.auditDispute(1, dispute);

            const { local, chain } = await reads.observation();
            expect(local.answers).to.deep.equal([false]);
            expect(chain.failures).to.have.length(1);
            expect(chain.failureCodes).to.not.include("CALL_EXCEPTION");
            expect(run.outcome).to.equal("threw");
            expect(run.disputeFraudProofCount).to.equal(0);
        });
    });

    describe("isCorrectLatestState", function () {
        it("local correct -> kept without a chain read, true, no proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            expect(dispute.postedAuditingData).to.equal(false);
            const reads = await h.mirror.observe(1, "isCorrectLatestState");

            const run = await h.dispute.auditDispute(1, dispute);

            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
            const { local, chain } = await reads.observation();
            expect(local.answers).to.deep.equal([true]);
            expect(chain.reads).to.equal(0);
        });

        it("dispute.input.latestStateSnapshotHash = random: local incorrect, chain incorrect -> one chain read, false + DisputeInvalidStateProof", async function () {
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
            expect(local.answers).to.deep.equal([false]);
            expect(chain.answers).to.deep.equal([false]);
        });

        it("local revert -> the chain answers correct instead, true, no proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            const reads = await h.mirror.observe(1, "isCorrectLatestState");
            await h.mirror.failNextLocalRead(
                1,
                "isCorrectLatestState",
                "revert"
            );

            const run = await h.dispute.auditDispute(1, dispute);

            const { local, chain } = await reads.observation();
            expect(local.failures).to.have.length(1);
            expect(local.failures[0]).to.contain("Local EVM execution failed");
            expect(chain.answers).to.deep.equal([true]);
            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
        });

        it("stale genesis dispute, chain view before the snapshot post: local incorrect, chain correct -> one chain read, the chain answer wins, no DisputeInvalidStateProof, DisputeNotLatestState later", async function () {
            const h = TestSession.getHarness();
            const { dispute } = await stageStaleGenesisDispute(h);
            expect(dispute.postedAuditingData).to.equal(false);
            const reads = await h.mirror.observe(1, "isCorrectLatestState");
            await h.mirror.serveChainReadsBefore(
                1,
                "isCorrectLatestState",
                "StateSnapshotUpdated"
            );

            const run = await h.dispute.auditDispute(1, dispute);

            const { local, chain } = await reads.observation();
            expect(local.answers).to.deep.equal([false]);
            expect(chain.answers).to.deep.equal([true]);
            // the chain's "correct" wins: no DisputeInvalidStateProof. The
            // audit goes on, and the later latest-state check kills the stale
            // dispute for what it is
            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.disputeFraudProofCount).to.equal(1);
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeNotLatestState
            );
        });

        it("local executor failure (not a revert) -> the audit throws it, no chain read, no proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            dispute.input.latestStateSnapshotHash = randomHash();
            const reads = await h.mirror.observe(1, "isCorrectLatestState");
            await h.mirror.failNextLocalRead(
                1,
                "isCorrectLatestState",
                "transport"
            );

            const run = await h.dispute.auditDispute(1, dispute);

            expect(run.outcome).to.equal("threw");
            expect(run.outcome === "threw" ? run.threwMessage : "").to.contain(
                "Malformed RPC request"
            );
            expect(run.disputeFraudProofCount).to.equal(0);
            const { chain } = await reads.observation();
            expect(chain.reads).to.equal(0);
        });

        it("dispute.input.latestStateSnapshotHash = random: local incorrect, chain RPC refuses the connection -> the audit throws it, no proof", async function () {
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
            expect(local.answers).to.deep.equal([false]);
            expect(chain.failures).to.have.length(1);
            expect(chain.failureCodes).to.not.include("CALL_EXCEPTION");
            expect(run.outcome).to.equal("threw");
            expect(run.disputeFraudProofCount).to.equal(0);
        });
    });

    describe("verifyBalanceInvariantCheckSnapshot", function () {
        it("local valid -> kept without a chain read, true, no proof", async function () {
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
            expect(local.answers).to.deep.equal([true]);
            expect(chain.reads).to.equal(0);
        });

        it("forged totalDeposits: local invalid, chain invalid -> one chain read, false + DisputeInvalidBalanceInvariant", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            const forged = await h.tamper.buildForgedSnapshot(2, (ctx) => ({
                snapshotData: {
                    ...ctx.originalSnapshotData,
                    totalDeposits: {
                        ...ctx.originalSnapshotData.totalDeposits,
                        amount:
                            BigInt(
                                ctx.originalSnapshotData.totalDeposits.amount
                            ) + 1n
                    }
                }
            }));
            // forged head block + forged snapshot committed by the dispute
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(2);
            const proof = dispute.input.stateProof;
            if (proof.signedBlocks.length > 0) {
                proof.signedBlocks[proof.signedBlocks.length - 1] =
                    forged.forgedBlock.signedBlock;
            } else {
                const milestone = proof.milestones.at(-1)!;
                milestone.blockConfirmations[0] =
                    forged.forgedBlock.blockConfirmationStruct;
                auditingData.milestoneSnapshots[
                    auditingData.milestoneSnapshots.length - 1
                ] = forged.forgedSnapshot.toStruct();
            }
            auditingData.latestStateSnapshot = forged.forgedSnapshot.toStruct();
            dispute.input.latestStateSnapshotHash = forged.forgedSnapshot.hash;
            dispute.input.disputeAuditingDataHash = hash(
                Codec.encode(auditingData, Type.DisputeAuditingData)
            );
            dispute.postedAuditingData = true;
            const reads = await h.mirror.observe(
                0,
                "verifyBalanceInvariantCheckSnapshot"
            );

            const run = await h.dispute.auditDispute(0, dispute, auditingData);

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidBalanceInvariant
            );
            const { local, chain } = await reads.observation();
            expect(local.answers).to.deep.equal([false]);
            expect(chain.answers).to.deep.equal([false]);
        });

        it("mirror missing a consumed top-up: local invalid, chain valid -> one chain read, the chain answer wins, true, no proof", async function () {
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
            expect(local.answers).to.deep.equal([false]);
            expect(chain.answers).to.deep.equal([true]);
            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
        });

        it("local revert -> the chain answers valid instead, true, no proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            const reads = await h.mirror.observe(
                1,
                "verifyBalanceInvariantCheckSnapshot"
            );
            await h.mirror.failNextLocalRead(
                1,
                "verifyBalanceInvariantCheckSnapshot",
                "revert"
            );

            const run = await h.dispute.auditDispute(1, dispute);

            const { local, chain } = await reads.observation();
            expect(local.failures).to.have.length(1);
            expect(local.failures[0]).to.contain("Local EVM execution failed");
            expect(chain.answers).to.deep.equal([true]);
            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
        });

        it("local executor failure (not a revert) -> the audit throws it, no chain read, no proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            const reads = await h.mirror.observe(
                1,
                "verifyBalanceInvariantCheckSnapshot"
            );
            await h.mirror.failNextLocalRead(
                1,
                "verifyBalanceInvariantCheckSnapshot",
                "transport"
            );

            const run = await h.dispute.auditDispute(1, dispute);

            expect(run.outcome).to.equal("threw");
            expect(run.outcome === "threw" ? run.threwMessage : "").to.contain(
                "Malformed RPC request"
            );
            expect(run.disputeFraudProofCount).to.equal(0);
            const { chain } = await reads.observation();
            expect(chain.reads).to.equal(0);
        });

        it("mirror missing a consumed top-up: local invalid, chain RPC refuses the connection -> the audit throws it, no proof", async function () {
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
            expect(local.answers).to.deep.equal([false]);
            expect(chain.failures).to.have.length(1);
            expect(chain.failureCodes).to.not.include("CALL_EXCEPTION");
            expect(run.outcome).to.equal("threw");
            expect(run.disputeFraudProofCount).to.equal(0);
        });
    });

    // postedAuditingData disputes; only the chain's revert rejects the proof
    describe("verifyStateProof", function () {
        it("local valid -> kept without a chain read, true, no proof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            expect(dispute.postedAuditingData).to.equal(true);
            const reads = await h.mirror.observe(1, "verifyStateProof");

            const run = await h.dispute.auditDispute(1, dispute, auditingData);

            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
            const { local, chain } = await reads.observation();
            expect(local.answers).to.deep.equal([true]);
            expect(chain.reads).to.equal(0);
        });

        it("auditingData.latestStateSnapshot.timestamp += 1: local invalid, chain invalid -> one chain read, false + DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            dispute.input.requireExistingDisputeWindow = true;
            auditingData.latestStateSnapshot.timestamp =
                Number(auditingData.latestStateSnapshot.timestamp) + 1;
            const reads = await h.mirror.observe(1, "verifyStateProof");

            const run = await h.dispute.auditDispute(1, dispute, auditingData);

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidStateProof
            );
            const { local, chain } = await reads.observation();
            expect(local.answers).to.deep.equal([false]);
            expect(chain.answers).to.deep.equal([false]);
        });

        it("stale genesis dispute with posted auditing data, chain view before the snapshot post: local invalid, chain valid -> one chain read, the chain answer wins, no DisputeInvalidStateProof, DisputeNotLatestState later", async function () {
            const h = TestSession.getHarness();
            const { dispute, auditingData } = await stageStaleGenesisDispute(h);
            dispute.postedAuditingData = true;
            const reads = await h.mirror.observe(1, "verifyStateProof");
            await h.mirror.serveChainReadsBefore(
                1,
                "verifyStateProof",
                "StateSnapshotUpdated"
            );

            const run = await h.dispute.auditDispute(1, dispute, auditingData);

            const { local, chain } = await reads.observation();
            expect(local.answers).to.deep.equal([false]);
            expect(chain.answers).to.deep.equal([true]);
            // the chain's "correct" wins: no DisputeInvalidStateProof. The
            // audit goes on, and the later latest-state check kills the stale
            // dispute for what it is
            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.disputeFraudProofCount).to.equal(1);
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeNotLatestState
            );
        });

        it("local revert, chain valid -> the chain answer is used, true, no proof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            const reads = await h.mirror.observe(1, "verifyStateProof");
            await h.mirror.failNextLocalRead(1, "verifyStateProof", "revert");

            const run = await h.dispute.auditDispute(1, dispute, auditingData);

            const { local, chain } = await reads.observation();
            expect(local.failures[0]).to.contain("Local EVM execution failed");
            expect(chain.answers).to.deep.equal([true]);
            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
        });

        it("local revert, chain revert (CALL_EXCEPTION) -> an invalid proof, false + DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            const reads = await h.mirror.observe(1, "verifyStateProof");
            await h.mirror.failNextLocalRead(1, "verifyStateProof", "revert");
            await h.mirror.failNextChainRead(1, "verifyStateProof", "revert");

            const run = await h.dispute.auditDispute(1, dispute, auditingData);

            const { chain } = await reads.observation();
            expect(chain.failureCodes).to.deep.equal(["CALL_EXCEPTION"]);
            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidStateProof
            );
        });

        it("local invalid, chain RPC refuses the connection -> the audit throws it, no proof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            dispute.input.requireExistingDisputeWindow = true;
            auditingData.latestStateSnapshot.timestamp =
                Number(auditingData.latestStateSnapshot.timestamp) + 1;
            const reads = await h.mirror.observe(1, "verifyStateProof");
            await h.mirror.failNextChainRead(
                1,
                "verifyStateProof",
                "transport"
            );

            const run = await h.dispute.auditDispute(1, dispute, auditingData);

            const { local, chain } = await reads.observation();
            expect(local.answers).to.deep.equal([false]);
            expect(chain.failures).to.have.length(1);
            expect(chain.failureCodes).to.not.include("CALL_EXCEPTION");
            expect(run.outcome).to.equal("threw");
            expect(run.disputeFraudProofCount).to.equal(0);
        });

        it("local executor failure (not a revert) -> the audit throws it, no chain read, no proof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            expect(dispute.postedAuditingData).to.equal(true);
            const reads = await h.mirror.observe(1, "verifyStateProof");
            await h.mirror.failNextLocalRead(
                1,
                "verifyStateProof",
                "transport"
            );

            const run = await h.dispute.auditDispute(1, dispute, auditingData);

            expect(run.outcome).to.equal("threw");
            expect(run.outcome === "threw" ? run.threwMessage : "").to.contain(
                "Malformed RPC request"
            );
            expect(run.disputeFraudProofCount).to.equal(0);
            const { local, chain } = await reads.observation();
            expect(local.failures).to.have.length(1);
            expect(local.failures[0]).to.not.contain(
                "Local EVM execution failed"
            );
            expect(chain.reads).to.equal(0);
        });
    });

    // a proof the mirror rejects is dropped; one it accepts is confirmed
    describe("validateTimeoutCalldataPostedProof", function () {
        it("local valid, chain valid -> one chain read, false + TimeoutCalldataPosted", async function () {
            const h = TestSession.getHarness();
            const { dispute } = await stageTimeoutCalldataPostedDispute(h);
            dispute.input.timeout.isForced = true;
            const reads = await h.mirror.observe(
                1,
                "validateTimeoutCalldataPostedProof"
            );

            const run = await h.dispute.auditDispute(1, dispute);

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.TimeoutCalldataPosted
            );
            const { local, chain } = await reads.observation();
            expect(local.answers).to.deep.equal([true]);
            expect(chain.answers).to.deep.equal([true]);
        });

        it("mirror and store missing the previous block's calldata post: local valid, chain invalid -> one chain read, true, no proof", async function () {
            const h = TestSession.getHarness();
            const { dispute, block1 } =
                await stageTimeoutCalldataPostedDispute(h);
            // the auditor misses the previous block's calldata log: its store
            // keeps a stale timestamp and its mirror has no commitment, while
            // the chain commitment carries the real timestamp
            await h.control(h.getPeer(1)).stub.stubCalldataPosting().request();
            await h
                .control(h.getPeer(1))
                .validation.stageBlockCalldata(block1.encodedSignedBlock, 1)
                .request();
            const block1Author = h.peers.find(
                (p) => p.address === block1.author
            )!;
            await h
                .control(block1Author)
                .validation.postBlockCalldataOnChain(block1.encodedSignedBlock)
                .request();
            const reads = await h.mirror.observe(
                1,
                "validateTimeoutCalldataPostedProof"
            );

            const run = await h.dispute.auditDispute(1, dispute);

            const { local, chain } = await reads.observation();
            expect(local.answers).to.deep.equal([true]);
            expect(chain.answers).to.deep.equal([false]);
            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.storedProof).to.equal(undefined);
        });

        it("store behind its mirror on the previous block's calldata: local invalid -> kept without a chain read, true, no proof", async function () {
            const h = TestSession.getHarness();
            const { dispute, block1 } =
                await stageTimeoutCalldataPostedDispute(h);
            const auditor = h.getPeer(1);
            const applied = auditor.eventSpies.onPostedCalldata?.callCount ?? 0;
            const block1Author = h.peers.find(
                (p) => p.address === block1.author
            )!;
            await h
                .control(block1Author)
                .validation.postBlockCalldataOnChain(block1.encodedSignedBlock)
                .request();
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
                .validation.stageBlockCalldata(block1.encodedSignedBlock, 1)
                .request();
            // the timed-out participant's signature forfeits the calldata
            // clock, so the late post does not make the timeout too early
            const timedOut = h.peers.find(
                (p) => p.address === dispute.input.timeout.participant
            )!;
            dispute.input.timeout.participantSignatureOnPreviousBlock =
                (await Block.fromSignedBlock(
                    Codec.decode(block1.encodedSignedBlock, Type.SignedBlock)
                ).sign(timedOut.signer)) as string;
            const reads = await h.mirror.observe(
                1,
                "validateTimeoutCalldataPostedProof"
            );

            const run = await h.dispute.auditDispute(1, dispute);

            const { local, chain } = await reads.observation();
            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.storedProof).to.equal(undefined);
            expect(local.answers).to.deep.equal([false]);
            expect(chain.reads).to.equal(0);
        });

        it("local revert, chain valid -> the chain answer is used, false + TimeoutCalldataPosted", async function () {
            const h = TestSession.getHarness();
            const { dispute } = await stageTimeoutCalldataPostedDispute(h);
            dispute.input.timeout.isForced = true;
            const reads = await h.mirror.observe(
                1,
                "validateTimeoutCalldataPostedProof"
            );
            await h.mirror.failNextLocalRead(
                1,
                "validateTimeoutCalldataPostedProof",
                "revert"
            );

            const run = await h.dispute.auditDispute(1, dispute);

            const { local, chain } = await reads.observation();
            expect(local.failures[0]).to.contain("Local EVM execution failed");
            expect(chain.answers).to.deep.equal([true]);
            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.TimeoutCalldataPosted
            );
        });

        it("local executor failure (not a revert) -> the audit throws it, no chain read, no proof", async function () {
            const h = TestSession.getHarness();
            const { dispute } = await stageTimeoutCalldataPostedDispute(h);
            dispute.input.timeout.isForced = true;
            const reads = await h.mirror.observe(
                1,
                "validateTimeoutCalldataPostedProof"
            );
            await h.mirror.failNextLocalRead(
                1,
                "validateTimeoutCalldataPostedProof",
                "transport"
            );

            const run = await h.dispute.auditDispute(1, dispute);

            expect(run.outcome).to.equal("threw");
            expect(run.outcome === "threw" ? run.threwMessage : "").to.contain(
                "Malformed RPC request"
            );
            expect(run.disputeFraudProofCount).to.equal(0);
            const { chain } = await reads.observation();
            expect(chain.reads).to.equal(0);
        });

        it("local valid, chain RPC refuses the connection -> the audit throws it, no proof", async function () {
            const h = TestSession.getHarness();
            const { dispute } = await stageTimeoutCalldataPostedDispute(h);
            dispute.input.timeout.isForced = true;
            const reads = await h.mirror.observe(
                1,
                "validateTimeoutCalldataPostedProof"
            );
            await h.mirror.failNextChainRead(
                1,
                "validateTimeoutCalldataPostedProof",
                "transport"
            );

            const run = await h.dispute.auditDispute(1, dispute);

            const { local, chain } = await reads.observation();
            expect(local.answers).to.deep.equal([true]);
            expect(chain.failureCodes).to.not.include("CALL_EXCEPTION");
            expect(run.outcome).to.equal("threw");
            expect(run.disputeFraudProofCount).to.equal(0);
        });
    });
});

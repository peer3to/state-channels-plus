import Block from "@/models/Block";
import { DisputeFraudProofType } from "@/types/sol-enums";
import { Codec, hash, Type } from "@/utils";
import { hash as randomHash } from "@test/factory";
import {
    blockAllegation,
    commitAndKillAsAuditor,
    postedForgedRunFrom,
    postedRunOverFinalPoint,
    postedRunWithForgedTip,
    stageAnchorAtHead,
    stageChainAnchorAheadOfMirror
} from "@test/fixtures/AnchorRaceStaging";
import {
    forgedTimestamp,
    postedForgedSingleton,
    storedProofBlock
} from "@test/fixtures/DisputeAuditStaging";
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

        it("local revert -> the audit throws it, no chain read, no proof", async function () {
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

            expect(run.outcome).to.equal("threw");
            expect(run.outcome === "threw" ? run.threwMessage : "").to.contain(
                "Local EVM execution failed"
            );
            expect(run.disputeFraudProofCount).to.equal(0);
            const { chain } = await reads.observation();
            expect(chain.reads).to.equal(0);
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
            expect((await reads.observation()).chain.reads).to.equal(0);
        });

        it("local not final, chain RPC refuses the connection -> the audit throws it, no proof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            dispute.postedAuditingData = false;
            await h.mirror.observe(1, "isLastMilestoneFinalByEveryone");
            await h.mirror.failNextChainRead(
                1,
                "isLastMilestoneFinalByEveryone",
                "transport"
            );

            const run = await h.dispute.auditDispute(1, dispute);

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

        it("stale genesis dispute, chain view before the snapshot post: local incorrect, chain correct -> one chain read, the chain answer wins, no DisputeInvalidStateProof, DisputeNotLatestState later", async function () {
            const h = TestSession.getHarness();
            const { dispute } = await stageStaleGenesisDispute(h);
            expect(dispute.postedAuditingData).to.equal(false);
            const reads = await h.mirror.observe(1, "isCorrectLatestState");
            // the whole chain view lags: its proof start is the genesis too
            await h.mirror.observe(1, "getAnchorSnapshot");
            await h.mirror.serveChainReadsBefore(
                1,
                "isCorrectLatestState",
                "StateSnapshotUpdated"
            );
            await h.mirror.serveChainReadsBefore(
                1,
                "getAnchorSnapshot",
                "StateSnapshotUpdated"
            );

            const run = await h.dispute.auditDispute(1, dispute);

            // one chain read, answering correct
            expect((await reads.observation()).chain.answers).to.deep.equal([
                true
            ]);
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
            expect(dispute.postedAuditingData).to.equal(false);
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
            expect((await reads.observation()).chain.reads).to.equal(0);
        });

        it("dispute.input.latestStateSnapshotHash = random: local incorrect, chain RPC refuses the connection -> the audit throws it, no proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            dispute.input.latestStateSnapshotHash = randomHash();
            await h.mirror.observe(1, "isCorrectLatestState");
            await h.mirror.failNextChainRead(
                1,
                "isCorrectLatestState",
                "transport"
            );

            const run = await h.dispute.auditDispute(1, dispute);

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
            const milestone = dispute.input.stateProof.milestones.at(-1)!;
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
                0,
                "verifyBalanceInvariantCheckSnapshot"
            );

            const run = await h.dispute.auditDispute(0, dispute, auditingData);

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidBalanceInvariant
            );
            // the latest state fails locally and on chain
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
            expect((await reads.observation()).chain.reads).to.equal(0);
        });

        it("mirror missing a consumed top-up: local invalid, chain RPC refuses the connection -> the audit throws it, no proof", async function () {
            const h = TestSession.getHarness();
            await stageMirrorMissingConsumedTopUp(h, 1);
            await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            await h.mirror.observe(1, "verifyBalanceInvariantCheckSnapshot");
            await h.mirror.failNextChainRead(
                1,
                "verifyBalanceInvariantCheckSnapshot",
                "transport"
            );

            const run = await h.dispute.auditDispute(1, dispute, auditingData);

            expect(run.outcome).to.equal("threw");
            expect(run.disputeFraudProofCount).to.equal(0);
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
            expect(run.storedProof).to.equal(undefined);
            expect((await reads.observation()).chain.reads).to.equal(0);
        });

        it("local valid, chain RPC refuses the connection -> the audit throws it, no proof", async function () {
            const h = TestSession.getHarness();
            const { dispute } = await stageTimeoutCalldataPostedDispute(h);
            dispute.input.timeout.isForced = true;
            await h.mirror.observe(1, "validateTimeoutCalldataPostedProof");
            await h.mirror.failNextChainRead(
                1,
                "validateTimeoutCalldataPostedProof",
                "transport"
            );

            const run = await h.dispute.auditDispute(1, dispute);

            expect(run.outcome).to.equal("threw");
            expect(run.storedProof).to.equal(undefined);
        });
    });

    // Without data, linkage and the latest state decide (local first, an
    // adverse answer confirmed on chain). Posted data is judged by the
    // chain's verifyStateProof alone; only then does the proof's walk run
    // (from the latest local threshold-final point, then the local diamond's
    // start, then the chain's) to persist what it verifies.
    describe("state-proof verification", function () {
        it("no data: linkage and the latest state decide, no walk", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            const linkage = await h.mirror.observe(1, "isStateProofLinked");
            const walks = await h.mirror.observe(
                1,
                "verifyMilestonesFromTrustedStart"
            );
            const storageWalks = await h.mirror.observe(1, "verifyMilestones");

            const run = await h.dispute.auditDispute(1, dispute);

            expect(run).to.include({ outcome: "returned", isValid: true });
            const linked = await linkage.observation();
            expect(linked.local.answers).to.deep.equal([true]);
            expect(linked.chain.reads).to.equal(0);
            expect((await walks.observation()).local.reads).to.equal(0);
            const storage = await storageWalks.observation();
            expect(storage.local.reads).to.equal(0);
            expect(storage.chain.reads).to.equal(0);
        });

        it("posted data the chain's verifyStateProof rejects → DisputeInvalidStateProof, no local verification or walk", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            // a block above the tip: no threshold proves it from any start
            const { dispute, auditingData } = await postedForgedSingleton(h);
            const verification = await h.mirror.observe(1, "verifyStateProof");
            const walks = await h.mirror.observe(
                1,
                "verifyMilestonesFromTrustedStart"
            );

            const run = await h.dispute.auditDispute(1, dispute, auditingData);

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidStateProof
            );
            const { local, chain } = await verification.observation();
            expect(local.reads).to.equal(0);
            expect(chain.answers).to.deep.equal([false]);
            expect((await walks.observation()).local.reads).to.equal(0);
        });

        it("posted data, the chain's verification refuses the connection -> the audit throws it, no proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute, auditingData } = await postedForgedSingleton(h);
            // faults arm on observed reads only
            await h.mirror.observe(1, "verifyStateProof");
            await h.mirror.failNextChainRead(
                1,
                "verifyStateProof",
                "transport"
            );

            const run = await h.dispute.auditDispute(1, dispute, auditingData);

            expect(run.outcome).to.equal("threw");
            expect(run.disputeFraudProofCount).to.equal(0);
        });

        it("final chain success accepts", async function () {
            const h = TestSession.getHarness();
            const stage = await stageChainAnchorAheadOfMirror(h, {
                mirrorAnchorHeight: 5,
                chainAnchorHeight: 9,
                headHeight: 10
            });
            const [nine, ten] = await Promise.all(
                [9, 10].map((height) =>
                    storedProofBlock(
                        h,
                        stage.auditorIndex,
                        stage.forkId,
                        height
                    )
                )
            );
            const authors = [nine, ten].map(
                ({ confirmation }) =>
                    Block.fromBlockConfirmation(confirmation).author
            );
            const third = stage.participants.find(
                (index) => !authors.includes(h.getPeer(index).address)
            )!;
            // block 9 without its confirmations, then blocks 10 and 11 of the
            // third participant: two signers prove no threshold from the
            // mirror's start 5, block 10 does not commit the auditor's final
            // point 10, and the chain's anchor 9 starts the run
            const posted = await postedForgedRunFrom(h, stage, {
                baseHeight: 9,
                authorIndex: third,
                count: 2,
                stripBase: true
            });
            const walks = await h.mirror.observe(
                stage.auditorIndex,
                "verifyMilestonesFromTrustedStart"
            );
            const storageWalks = await h.mirror.observe(
                stage.auditorIndex,
                "verifyMilestones"
            );

            const run = await h.dispute.auditDispute(
                stage.auditorIndex,
                posted.dispute,
                posted.auditingData
            );

            expect((await walks.observation()).local.answers).to.deep.equal([
                false
            ]);
            const { local, chain } = await storageWalks.observation();
            expect(local.answers).to.deep.equal([false]);
            expect(chain.answers).to.deep.equal([true]);
            // accepted: no DisputeInvalidStateProof; the replay judges block 10
            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            );
            expect(blockAllegation(run.storedProof!)).to.deep.equal({
                blockIndex: 1,
                convictedBlockHash: posted.forged[0].hash
            });
        });

        it("wrong channel fork or identity is not trusted start", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 4);
            const stage = { forkId: h.activeForkId!, disputerIndex: 0 };
            // the auditor's final point is block 3
            const three = await storedProofBlock(h, 1, stage.forkId, 3);
            // block 3's snapshot committed by a block on another fork
            const wrongFork = await postedRunOverFinalPoint(h, stage, {
                height: 3,
                startForkId: randomHash(),
                startSnapshot: three.snapshot
            });
            // a re-timed copy of block 3's snapshot: same data, another identity
            const wrongIdentity = await postedRunOverFinalPoint(h, stage, {
                height: 3,
                startForkId: stage.forkId,
                startSnapshot: forgedTimestamp(three.snapshot)
            });
            const walks = await h.mirror.observe(
                1,
                "verifyMilestonesFromTrustedStart"
            );
            const verification = await h.mirror.observe(1, "verifyStateProof");

            const forkRun = await h.dispute.auditDispute(
                1,
                wrongFork.dispute,
                wrongFork.auditingData
            );
            const identityRun = await h.dispute.auditDispute(
                1,
                wrongIdentity.dispute,
                wrongIdentity.auditingData
            );

            // the other fork's block never reaches a walk: the header check
            // rejects the proof first
            expect(forkRun).to.include({ outcome: "returned", isValid: false });
            expect(forkRun.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeStateProofHeaderMismatch
            );
            // the other identity does not start from the final point, and no
            // lower tier accepts it
            expect(identityRun).to.include({
                outcome: "returned",
                isValid: false
            });
            expect(identityRun.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidStateProof
            );
            // the chain rejects it: no walk runs to persist anything
            expect(
                (await verification.observation()).chain.answers
            ).to.deep.equal([false]);
            expect((await walks.observation()).local.reads).to.equal(0);
        });
    });

    // The submitted proof's coordinates are positions in the proof: neither
    // the mirror's start nor the chain's renumbers them. Each block
    // allegation asks the chain right before it is stored.
    describe("chain anchor races", function () {
        it("chain 9 mirror 5 submitted pair stays 0 6", async function () {
            const h = TestSession.getHarness();
            const stage = await stageChainAnchorAheadOfMirror(h, {
                mirrorAnchorHeight: 5,
                chainAnchorHeight: 9,
                headHeight: 10
            });
            // blocks 5..10 and an unseen block 11: (0, 6) is block 11
            const posted = await postedRunWithForgedTip(h, stage, 5, 10);
            const eligibility = await h.mirror.observe(
                stage.auditorIndex,
                "isBlockChallengeEligible"
            );

            const run = await h.dispute.auditDispute(
                stage.auditorIndex,
                posted.dispute,
                posted.auditingData
            );

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            );
            expect(posted.dispute.input.stateProof.milestones).to.have.length(
                1
            );
            expect(blockAllegation(run.storedProof!)).to.deep.equal({
                blockIndex: 6,
                convictedBlockHash: posted.forged.hash
            });
            // the replay's tail-start search, then the allegation's own read
            expect(
                (await eligibility.observation()).chain.answers.at(-1)
            ).to.equal(true);

            const kill = await commitAndKillAsAuditor(h, stage, posted);

            expect(kill.applies.map(({ error }) => error)).to.deep.equal([
                null
            ]);
            expect(kill.stillCommitted).to.equal(false);
            expect(kill.slashed).to.include(
                h.getPeer(stage.disputerIndex).address
            );
            expect(kill.slashed).to.not.include(
                h.getPeer(stage.auditorIndex).address
            );
        });

        it("chain 5 mirror genesis submitted pair stays 0 6", async function () {
            const h = TestSession.getHarness();
            const stage = await stageChainAnchorAheadOfMirror(h, {
                chainAnchorHeight: 5,
                headHeight: 5
            });
            // blocks 0..5 and an unseen block 6: (0, 6) is block 6
            const posted = await postedRunWithForgedTip(h, stage, 0, 5);
            const eligibility = await h.mirror.observe(
                stage.auditorIndex,
                "isBlockChallengeEligible"
            );

            const run = await h.dispute.auditDispute(
                stage.auditorIndex,
                posted.dispute,
                posted.auditingData
            );

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            );
            expect(posted.dispute.input.stateProof.milestones).to.have.length(
                1
            );
            expect(blockAllegation(run.storedProof!)).to.deep.equal({
                blockIndex: 6,
                convictedBlockHash: posted.forged.hash
            });
            expect(
                (await eligibility.observation()).chain.answers.at(-1)
            ).to.equal(true);

            const kill = await commitAndKillAsAuditor(h, stage, posted);

            expect(kill.applies.map(({ error }) => error)).to.deep.equal([
                null
            ]);
            expect(kill.stillCommitted).to.equal(false);
            expect(kill.slashed).to.include(
                h.getPeer(stage.disputerIndex).address
            );
            expect(kill.slashed).to.not.include(
                h.getPeer(stage.auditorIndex).address
            );
        });

        it("delayed snapshot event does not renumber proof", async function () {
            const h = TestSession.getHarness();
            const stage = await stageChainAnchorAheadOfMirror(h, {
                mirrorAnchorHeight: 5,
                chainAnchorHeight: 9,
                headHeight: 10
            });
            const posted = await postedRunWithForgedTip(h, stage, 5, 10);
            const eligibility = await h.mirror.observe(
                stage.auditorIndex,
                "isBlockChallengeEligible"
            );
            const expected = {
                blockIndex: 6,
                convictedBlockHash: posted.forged.hash
            };

            // audited while the auditor's mirror still starts at 5
            const beforeEvent = await h.dispute.auditDispute(
                stage.auditorIndex,
                posted.dispute,
                posted.auditingData
            );
            // the snapshot event arrives: the mirror starts at 9; a repeat
            // audit alleges the same block and the stored wrapper stays
            await stage.releaseHeldSnapshots();
            const afterEvent = await h.dispute.auditDispute(
                stage.auditorIndex,
                posted.dispute,
                posted.auditingData
            );

            expect(blockAllegation(beforeEvent.storedProof!)).to.deep.equal(
                expected
            );
            expect(blockAllegation(afterEvent.storedProof!)).to.deep.equal(
                expected
            );
            expect(
                (await eligibility.observation()).chain.answers.at(-1)
            ).to.equal(true);

            const kill = await commitAndKillAsAuditor(h, stage, posted);

            expect(kill.applies.map(({ error }) => error)).to.deep.equal([
                null
            ]);
            expect(kill.stillCommitted).to.equal(false);
            expect(kill.slashed).to.include(
                h.getPeer(stage.disputerIndex).address
            );
            expect(kill.slashed).to.not.include(
                h.getPeer(stage.auditorIndex).address
            );
        });

        it("chain9 mirror5 bad block6 → the chain's start rejects the run: DisputeInvalidStateProof, nothing replayed", async function () {
            const h = TestSession.getHarness();
            const stage = await stageChainAnchorAheadOfMirror(h, {
                mirrorAnchorHeight: 5,
                chainAnchorHeight: 9,
                headHeight: 10
            });
            const six = await storedProofBlock(
                h,
                stage.auditorIndex,
                stage.forkId,
                6
            );
            const sixAuthor = Block.fromBlockConfirmation(
                six.confirmation
            ).author;
            const offender = stage.participants.find(
                (index) => h.getPeer(index).address !== sixAuthor
            )!;
            // the real block 5, then blocks 6..10 of a participant that is
            // not block 6's author: the mirror's start 5 would hold the run,
            // but its crafted block 9 does not commit the chain's anchor 9
            const posted = await postedForgedRunFrom(h, stage, {
                baseHeight: 5,
                authorIndex: offender,
                count: 5
            });
            const verification = await h.mirror.observe(
                stage.auditorIndex,
                "verifyStateProof"
            );
            const eligibility = await h.mirror.observe(
                stage.auditorIndex,
                "isBlockChallengeEligible"
            );

            const run = await h.dispute.auditDispute(
                stage.auditorIndex,
                posted.dispute,
                posted.auditingData
            );

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidStateProof
            );
            expect(
                (await verification.observation()).chain.answers
            ).to.deep.equal([false]);
            expect((await eligibility.observation()).chain.reads).to.equal(0);
        });

        it("audit reuses independent canonical start read", async function () {
            const h = TestSession.getHarness();
            const stage = await stageAnchorAtHead(h, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(
                stage.disputerIndex
            );
            const posted = await postedRunWithForgedTip(h, stage, 3, 3);
            const starts = await h.mirror.observe(
                stage.auditorIndex,
                "getAnchorSnapshot"
            );
            const storageWalks = await h.mirror.observe(
                stage.auditorIndex,
                "verifyMilestones"
            );
            const eligibility = await h.mirror.observe(
                stage.auditorIndex,
                "isBlockChallengeEligible"
            );

            // a whole honest audit: one canonical start read
            const honest = await h.dispute.auditDispute(
                stage.auditorIndex,
                dispute
            );
            expect(honest).to.include({ outcome: "returned", isValid: true });
            expect((await starts.observation()).chain.reads).to.equal(1);

            // an audit with a block allegation: again one start read; the
            // replay's tail start and the allegation query the chain itself
            const alleged = await h.dispute.auditDispute(
                stage.auditorIndex,
                posted.dispute,
                posted.auditingData
            );
            expect(alleged.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            );
            expect((await starts.observation()).chain.reads).to.equal(2);
            expect(
                (await eligibility.observation()).chain.answers.at(-1)
            ).to.equal(true);
            // local verification succeeded both times: no chain walk
            expect((await storageWalks.observation()).chain.reads).to.equal(0);
        });

        it("failed eligibility read throws and leaves no stored wrapper", async function () {
            const h = TestSession.getHarness();
            const stage = await stageAnchorAtHead(h, 3);
            const posted = await postedRunWithForgedTip(h, stage, 3, 3);
            const walks = await h.mirror.observe(
                stage.auditorIndex,
                "verifyMilestonesFromTrustedStart"
            );
            const starts = await h.mirror.observe(
                stage.auditorIndex,
                "getAnchorSnapshot"
            );
            const eligibility = await h.mirror.observe(
                stage.auditorIndex,
                "isBlockChallengeEligible"
            );
            await h.mirror.failNextChainRead(
                stage.auditorIndex,
                "isBlockChallengeEligible",
                "transport"
            );

            const run = await h.dispute.auditDispute(
                stage.auditorIndex,
                posted.dispute,
                posted.auditingData
            );

            expect(run.outcome).to.equal("threw");
            expect(run.storedProof).to.equal(undefined);
            expect(run.disputeFraudProofCount).to.equal(0);
            // local verification and the independent start read succeeded
            expect((await walks.observation()).local.answers).to.deep.equal([
                true
            ]);
            const start = (await starts.observation()).chain;
            expect(start.reads).to.equal(1);
            expect(start.failures).to.deep.equal([]);
            // only the eligibility read failed
            const { chain } = await eligibility.observation();
            expect(chain.reads).to.equal(1);
            expect(chain.failures).to.have.length(1);
            expect(await h.query.onChainSlashedParticipants()).to.not.include(
                h.getPeer(stage.auditorIndex).address
            );
        });

        it("explicit repeat audit rereads anchor and submits eligible wrapper", async function () {
            const h = TestSession.getHarness();
            const stage = await stageAnchorAtHead(h, 3);
            const posted = await postedRunWithForgedTip(h, stage, 3, 3);
            const eligibility = await h.mirror.observe(
                stage.auditorIndex,
                "isBlockChallengeEligible"
            );
            await h.mirror.failNextChainRead(
                stage.auditorIndex,
                "isBlockChallengeEligible",
                "transport"
            );
            const failed = await h.dispute.auditDispute(
                stage.auditorIndex,
                posted.dispute,
                posted.auditingData
            );
            expect(failed.outcome).to.equal("threw");

            const repeated = await h.dispute.auditDispute(
                stage.auditorIndex,
                posted.dispute,
                posted.auditingData
            );

            expect(repeated).to.include({
                outcome: "returned",
                isValid: false
            });
            expect(repeated.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            );
            expect(blockAllegation(repeated.storedProof!)).to.deep.equal({
                blockIndex: 1,
                convictedBlockHash: posted.forged.hash
            });
            // fresh chain reads, no cached failure
            const { chain } = await eligibility.observation();
            expect(chain.failures).to.have.length(1);
            expect(chain.answers.at(-1)).to.equal(true);

            const kill = await commitAndKillAsAuditor(h, stage, posted);

            expect(kill.applies.map(({ error }) => error)).to.deep.equal([
                null
            ]);
            expect(kill.stillCommitted).to.equal(false);
            expect(kill.slashed).to.include(
                h.getPeer(stage.disputerIndex).address
            );
            expect(kill.slashed).to.not.include(
                h.getPeer(stage.auditorIndex).address
            );
        });
    });
});

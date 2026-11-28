import Block from "@/models/Block";
import StateSnapshot from "@/models/StateSnapshot";
import { Status } from "@/types";
import {
    DisputeFraudProofType,
    FraudProofType,
    toSolidityFraudProofType
} from "@/types/sol-enums";
import type { Hash } from "@/types/types";
import { Codec, hash, Type } from "@/utils";
import { BLOCK_REPLAY_FAULT_MESSAGE } from "@test/fixtures/customRpc/harnessControl/services/stub/StubService";
import {
    activeView,
    evidenceBlockHashesAt,
    holdsEvidenceState,
    holdsState,
    snapshotAt,
    stageAuditedHeadAboveView,
    stageForgedSupportBelowHonestTail,
    stageFrozenViewBehindDisputeTail,
    stageLaggingParticipantBehindTail,
    stagePendingAuditorBehindJoin,
    stagePendingJoinerMissingHopBase,
    stagePersistedSideBlockAtHonestTail,
    stageSideBlockBelowAuditorHead,
    stageSideReplayBelowHonestTail
} from "@test/fixtures/DisputeAuditStaging";
import { stageHeadKeptOnlyAsAuditEvidence } from "@test/fixtures/MilestoneProofStartStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

// A dispute replay persists the blocks, snapshots and states it verifies so
// reduction can read them, without moving the auditor's own view.
describe("Unit: DisputeValidationService replay persistence", function () {
    describe("replayed tail", function () {
        it("U40: a participant auditor that missed the unfinalized tail replays it from its finalized state -> it holds the latest block, snapshot and state, true", async function () {
            const h = TestSession.getHarness();
            const staged = await stageFrozenViewBehindDisputeTail(h);
            const tail =
                staged.dispute.input.stateProof.milestones.at(
                    -1
                )!.blockConfirmations;
            const head = Block.fromBlockConfirmation(tail.at(-1)!);
            expect(head.height).to.be.greaterThan(staged.frozenHeight);
            const latest = await snapshotAt(
                h,
                staged.disputerIndex,
                head.height
            );
            expect(await holdsState(h, staged.frozenIndex, latest)).to.equal(
                false
            );

            const run = await h.dispute.auditDispute(
                staged.frozenIndex,
                staged.dispute,
                staged.auditingData
            );

            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
            const stored = await h
                .control(h.getPeer(staged.frozenIndex))
                .query.getBlockByHash(head.hash)
                .request();
            expect(stored, "the replayed head is stored").to.not.be.null;
            expect(await holdsState(h, staged.frozenIndex, latest)).to.equal(
                true
            );
        });

        it("U40: a pending-participant auditor that missed the unfinalized tail replays it from its finalized state -> it holds the latest block, snapshot and state, true", async function () {
            const h = TestSession.getHarness();
            const staged = await stagePendingAuditorBehindJoin(h, {
                consumeJoin: true
            });
            const head = Block.fromBlockConfirmation(
                staged.dispute.input.stateProof.milestones
                    .at(-1)!
                    .blockConfirmations.at(-1)!
            );
            const latest = await snapshotAt(h, 0, head.height);
            const pending = h.control(h.getPeer(staged.pendingIndex)).query;
            expect(
                await pending
                    .getStateSnapshotStructByHash(latest.hash as Hash)
                    .request()
            ).to.equal(null);
            expect(await pending.getStatus().request()).to.equal(
                Status.PENDING_PARTICIPANT
            );
            expect(await pending.getBlockByHash(head.hash).request()).to.be
                .null;
            expect(await holdsState(h, staged.pendingIndex, latest)).to.equal(
                false
            );

            const run = await h.dispute.auditDispute(
                staged.pendingIndex,
                staged.dispute,
                staged.auditingData
            );

            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
            expect(
                await pending.getBlockByHash(head.hash).request(),
                "the replayed head is stored"
            ).to.not.be.null;
            expect(
                await pending
                    .getStateSnapshotStructByHash(latest.hash as Hash)
                    .request(),
                "the latest snapshot is stored"
            ).to.not.equal(null);
            expect(await holdsState(h, staged.pendingIndex, latest)).to.equal(
                true
            );
        });

        it("U64: the replay reaches a state newer than the auditor's view -> the data is stored for reduction, the view stays where it was, and the auditor signs none of the replayed blocks", async function () {
            const h = TestSession.getHarness();
            const staged = await stageFrozenViewBehindDisputeTail(h);
            const frozen = h.getPeer(staged.frozenIndex);
            const before = await activeView(h, staged.frozenIndex);
            expect(before.nextBlockHeight).to.equal(staged.frozenHeight + 1);

            const run = await h.dispute.auditDispute(
                staged.frozenIndex,
                staged.dispute,
                staged.auditingData
            );

            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(await activeView(h, staged.frozenIndex)).to.deep.equal(
                before
            );
            const replayed = staged.dispute.input.stateProof.milestones
                .at(-1)!
                .blockConfirmations.map((confirmation) =>
                    Block.fromBlockConfirmation(confirmation)
                )
                .filter((block) => block.height > staged.frozenHeight);
            expect(replayed).to.have.length.greaterThan(0);
            for (const block of replayed) {
                const stored = await h
                    .control(frozen)
                    .query.getBlockByHash(block.hash)
                    .request();
                expect(stored, `replayed block ${block.height} is stored`).to
                    .not.be.null;
                expect(stored!.author).to.not.equal(frozen.address);
                expect(stored!.confirmationSignerAddresses).to.not.include(
                    frozen.address
                );
            }
        });

        it("U119: after the persistence-only replay the auditor's own dispute still ends at its view and the replayed state stays available; a live peer's own dispute ends at its latest state", async function () {
            const h = TestSession.getHarness();
            const staged = await stageFrozenViewBehindDisputeTail(h);
            const replayRun = await h.dispute.auditDispute(
                staged.frozenIndex,
                staged.dispute,
                staged.auditingData
            );
            expect(replayRun).to.include({
                outcome: "returned",
                isValid: true
            });
            const head = Block.fromBlockConfirmation(
                staged.dispute.input.stateProof.milestones
                    .at(-1)!
                    .blockConfirmations.at(-1)!
            );
            const headSnapshot = await snapshotAt(
                h,
                staged.disputerIndex,
                head.height
            );

            const own = await h.dispute.fetchConstructedDispute(
                staged.frozenIndex
            );

            expect(own.dispute.input.latestStateSnapshotHash).to.equal(
                (await snapshotAt(h, staged.disputerIndex, staged.frozenHeight))
                    .hash
            );
            const ownHead = Block.fromBlockConfirmation(
                own.dispute.input.stateProof.milestones
                    .at(-1)!
                    .blockConfirmations.at(-1)!
            );
            expect(ownHead.height).to.equal(staged.frozenHeight);
            expect(
                await holdsState(h, staged.frozenIndex, headSnapshot)
            ).to.equal(true);
            // the replay added no signature of the cut-off peer
            const frozen = h.getPeer(staged.frozenIndex);
            const storedHead = await h
                .control(frozen)
                .query.getBlockByHash(head.hash)
                .request();
            expect(storedHead, "the replayed head is stored").to.not.be.null;
            expect(storedHead!.author).to.not.equal(frozen.address);
            expect(storedHead!.confirmationSignerAddresses).to.not.include(
                frozen.address
            );
            // live progress: the disputer's own dispute ends at its latest state
            expect(staged.dispute.input.latestStateSnapshotHash).to.equal(
                headSnapshot.hash
            );
        });

        it("U119 control: the same cut-off peer, reconnected, progresses live instead of replaying -> its own dispute ends at its latest active state, and it signs the new block", async function () {
            const h = TestSession.getHarness();
            const staged = await stageFrozenViewBehindDisputeTail(h);
            const frozen = h.getPeer(staged.frozenIndex);
            await h.network.reconnectPeers([staged.frozenIndex]);
            // it catches up by sync, and a synced block carries no signature
            // of its own; the block after that it receives and signs live
            await h.transition.advanceState({
                count: 1,
                waitForFinalization: false
            });
            await h.transition.advanceState({
                count: 1,
                waitForFinalization: true
            });
            const latest = (await h
                .control(h.getPeer(staged.disputerIndex))
                .query.getLatestBlockHeight(staged.forkId)
                .request())!;
            expect(
                await h
                    .control(frozen)
                    .query.getNextBlockHeight(staged.forkId)
                    .request(),
                "the reconnected peer's view reaches the head"
            ).to.equal(latest + 1);

            const own = await h.dispute.fetchConstructedDispute(
                staged.frozenIndex
            );

            expect(own.dispute.input.latestStateSnapshotHash).to.equal(
                (await snapshotAt(h, staged.disputerIndex, latest)).hash
            );
            const head = await h
                .control(frozen)
                .query.getBlockByHeight(staged.forkId, latest)
                .request();
            expect(
                head!.author === frozen.address ||
                    head!.confirmationSignerAddresses.includes(frozen.address),
                "live progress signs"
            ).to.equal(true);
        });
    });

    describe("failed replay", function () {
        it("U62: a tail block fails its replay -> it is not stored as replayed, and auditing again replays and rejects it again", async function () {
            const h = TestSession.getHarness();
            const staged = await stageFrozenViewBehindDisputeTail(h);
            const forged = await h.tamper.buildForgedSnapshot(
                staged.disputerIndex,
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
                })
            );
            const { dispute, auditingData } = staged;
            const tail =
                dispute.input.stateProof.milestones.at(-1)!.blockConfirmations;
            tail[tail.length - 1] = forged.forgedBlock.blockConfirmationStruct;
            auditingData.latestStateSnapshot = forged.forgedSnapshot.toStruct();
            dispute.input.latestStateSnapshotHash = forged.forgedSnapshot.hash;
            dispute.input.disputeAuditingDataHash = hash(
                Codec.encode(auditingData, Type.DisputeAuditingData)
            );
            const frozen = h.getPeer(staged.frozenIndex);

            const first = await h.dispute.auditDispute(
                staged.frozenIndex,
                dispute,
                auditingData
            );

            expect(first).to.include({ outcome: "returned", isValid: false });
            expect(first.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            );
            const evidence = Codec.decode(
                first.storedProof!.encodedProof,
                DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            );
            expect(Number(evidence.blockIndex)).to.equal(tail.length - 1);
            expect(
                await h
                    .control(frozen)
                    .query.getBlockByHash(forged.forgedBlock.hash)
                    .request(),
                "the failed block is not stored"
            ).to.be.null;
            expect(
                await h
                    .control(frozen)
                    .query.getStateSnapshotStructByHash(
                        forged.forgedSnapshot.hash
                    )
                    .request(),
                "the failed block's snapshot is not stored"
            ).to.be.null;

            const second = await h.dispute.auditDispute(
                staged.frozenIndex,
                dispute,
                auditingData
            );
            expect(second).to.include({ outcome: "returned", isValid: false });
            expect(second.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            );
            expect(second.disputeFraudProofCount).to.equal(1);
        });

        it("U63: the failing tail block also appears in an earlier milestone of the proof -> its replay still runs and fails at its last-milestone position, nothing of it is stored", async function () {
            const h = TestSession.getHarness();
            const staged = await stageFrozenViewBehindDisputeTail(h);
            const forged = await h.tamper.buildForgedSnapshot(
                staged.disputerIndex,
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
                })
            );
            const { dispute, auditingData } = staged;
            const milestones = dispute.input.stateProof.milestones;
            const tail = milestones.at(-1)!.blockConfirmations;
            tail[tail.length - 1] = forged.forgedBlock.blockConfirmationStruct;
            // the same run repeated as an earlier milestone
            milestones.splice(milestones.length - 1, 0, {
                blockConfirmations: [...tail]
            });
            auditingData.milestoneSnapshots.splice(
                auditingData.milestoneSnapshots.length - 1,
                0,
                auditingData.milestoneSnapshots.at(-1)!
            );
            auditingData.latestStateSnapshot = forged.forgedSnapshot.toStruct();
            dispute.input.latestStateSnapshotHash = forged.forgedSnapshot.hash;
            dispute.input.disputeAuditingDataHash = hash(
                Codec.encode(auditingData, Type.DisputeAuditingData)
            );

            const run = await h.dispute.auditDispute(
                staged.frozenIndex,
                dispute,
                auditingData
            );

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            );
            const evidence = Codec.decode(
                run.storedProof!.encodedProof,
                DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            );
            expect(Number(evidence.blockIndex)).to.equal(tail.length - 1);
            expect(
                await h
                    .control(h.getPeer(staged.frozenIndex))
                    .query.getBlockByHash(forged.forgedBlock.hash)
                    .request(),
                "the failed block is not stored"
            ).to.be.null;
        });
    });

    // Support a proof walk checks but does not prove final is never stored as
    // executed history: a later replay never meets it there.
    describe("unexecuted support", function () {
        it("U135: a dispute carrying a forged block above its tail is audited, then the honest dispute whose tail replays the real block there → the honest dispute is valid with no counter, history holds the real block, the forged one is neither history nor evidence", async function () {
            const h = TestSession.getHarness();
            const staged = await stageForgedSupportBelowHonestTail(h);
            const auditor = h.control(h.getPeer(staged.frozenIndex)).query;

            await h.dispute.auditDispute(
                staged.frozenIndex,
                staged.forgedDispute
            );
            expect(
                await auditor
                    .getBlockByHeight(staged.forkId, staged.shadowed.height)
                    .request(),
                "the forged support is not executed history"
            ).to.be.null;
            // the run holding the auditor's start proves no hop above it
            expect(
                await evidenceBlockHashesAt(
                    h,
                    staged.frozenIndex,
                    staged.forkId,
                    staged.shadowed.height
                )
            ).to.deep.equal([]);

            const honest = await h.dispute.auditDispute(
                staged.frozenIndex,
                staged.dispute,
                staged.auditingData
            );

            expect(honest).to.include({ outcome: "returned", isValid: true });
            expect(honest.storedProof).to.equal(undefined);
            expect(
                (
                    await auditor
                        .getBlockByHeight(staged.forkId, staged.shadowed.height)
                        .request()
                )?.hash
            ).to.equal(staged.shadowed.hash);
        });

        it("U135: the honest dispute is audited first, then the dispute carrying a forged block at its tail height → history keeps the real block, a second audit of the honest dispute stays valid with no counter", async function () {
            const h = TestSession.getHarness();
            const staged = await stageForgedSupportBelowHonestTail(h);
            const auditor = h.control(h.getPeer(staged.frozenIndex)).query;
            const first = await h.dispute.auditDispute(
                staged.frozenIndex,
                staged.dispute,
                staged.auditingData
            );
            expect(first).to.include({ outcome: "returned", isValid: true });

            await h.dispute.auditDispute(
                staged.frozenIndex,
                staged.forgedDispute
            );

            expect(
                (
                    await auditor
                        .getBlockByHeight(staged.forkId, staged.shadowed.height)
                        .request()
                )?.hash
            ).to.equal(staged.shadowed.hash);
            const again = await h.dispute.auditDispute(
                staged.frozenIndex,
                staged.dispute,
                staged.auditingData
            );
            expect(again).to.include({ outcome: "returned", isValid: true });
            expect(again.storedProof).to.equal(undefined);
        });

        it("U143: a dispute carrying a block forged by the honest tail block's own author is audited, then the honest dispute → the honest dispute is valid with no dispute counter, history holds the real block, no double-sign proof comes from unexecuted support", async function () {
            const h = TestSession.getHarness();
            const staged = await stageForgedSupportBelowHonestTail(h, {
                forger: "shadowedAuthor"
            });
            const auditor = h.control(h.getPeer(staged.frozenIndex)).query;
            expect(staged.forged.author).to.equal(staged.shadowed.author);

            await h.dispute.auditDispute(
                staged.frozenIndex,
                staged.forgedDispute
            );
            const honest = await h.dispute.auditDispute(
                staged.frozenIndex,
                staged.dispute,
                staged.auditingData
            );

            expect(honest).to.include({ outcome: "returned", isValid: true });
            expect(honest.storedProof).to.equal(undefined);
            expect(
                (
                    await auditor
                        .getBlockByHeight(staged.forkId, staged.shadowed.height)
                        .request()
                )?.hash
            ).to.equal(staged.shadowed.hash);
        });
    });

    // A replayed dispute tail is executed history: a later replay meets it
    // at its height.
    describe("replayed tail of another dispute", function () {
        it("a side dispute replays a re-signed copy of the honest tail block at a free height, then the honest dispute replays the real block there → the honest dispute is valid with no dispute counter, the copy's author is proven a double signer, and the honest latest state is held for reduction", async function () {
            const h = TestSession.getHarness();
            const staged = await stageSideReplayBelowHonestTail(h);
            const auditor = h.control(h.getPeer(staged.frozenIndex)).query;
            const side = await h.dispute.auditDispute(
                staged.frozenIndex,
                staged.sideDispute
            );
            // premise - the side replay stored its copy at the free height
            expect(side).to.include({ outcome: "returned", isValid: true });
            expect(
                (
                    await auditor
                        .getBlockByHeight(staged.forkId, staged.shadowed.height)
                        .request()
                )?.hash
            ).to.equal(staged.copy.hash);

            const honest = await h.dispute.auditDispute(
                staged.frozenIndex,
                staged.dispute,
                staged.auditingData
            );

            expect(honest).to.include({ outcome: "returned", isValid: true });
            expect(honest.disputeFraudProofCount).to.equal(0);
            expect(
                await auditor
                    .getFraudProofType(staged.shadowed.author)
                    .request()
            ).to.equal(
                String(toSolidityFraudProofType(FraudProofType.BlockDoubleSign))
            );
            expect(
                await holdsState(
                    h,
                    staged.frozenIndex,
                    await snapshotAt(
                        h,
                        staged.disputerIndex,
                        staged.shadowed.height
                    )
                ),
                "the honest dispute's latest state is held for reduction"
            ).to.equal(true);
        });

        it("another author's block a side replay persisted at a free height above the view, linked to the honest tail, then the honest dispute replays the real block there → the honest dispute is valid with no dispute counter, no proof against the real block's author, and the honest latest state is held for reduction", async function () {
            const h = TestSession.getHarness();
            const staged = await stagePersistedSideBlockAtHonestTail(h);
            const auditor = h.control(h.getPeer(staged.frozenIndex)).query;
            // premise - the side block sits above the frozen view
            expect(
                (
                    await auditor
                        .getBlockByHeight(staged.forkId, staged.shadowed.height)
                        .request()
                )?.hash
            ).to.equal(staged.side.hash);
            expect(
                await auditor.getLatestBlockHeight(staged.forkId).request()
            ).to.equal(staged.frozenHeight);

            const honest = await h.dispute.auditDispute(
                staged.frozenIndex,
                staged.dispute,
                staged.auditingData
            );

            expect(honest).to.include({ outcome: "returned", isValid: true });
            expect(honest.disputeFraudProofCount).to.equal(0);
            expect(
                await auditor
                    .getFraudProofType(staged.shadowed.author)
                    .request()
            ).to.equal(null);
            expect(
                await holdsState(
                    h,
                    staged.frozenIndex,
                    await snapshotAt(
                        h,
                        staged.disputerIndex,
                        staged.shadowed.height
                    )
                ),
                "the honest dispute's latest state is held for reduction"
            ).to.equal(true);
        });
        it("another author's block a side replay persisted in a gap below the auditor's head, linked to the honest final block, then the honest dispute replays the real block there → the honest dispute is valid with no dispute counter and no proof against the real block's author", async function () {
            const h = TestSession.getHarness();
            const staged = await stageSideBlockBelowAuditorHead(h, {
                onHeadRun: false
            });
            const auditor = h.control(h.getPeer(staged.auditorIndex)).query;

            const honest = await h.dispute.auditDispute(
                staged.auditorIndex,
                staged.dispute,
                staged.auditingData
            );

            expect(honest).to.include({ outcome: "returned", isValid: true });
            expect(honest.storedProof).to.equal(undefined);
            expect(honest.disputeFraudProofCount).to.equal(0);
            expect(
                await auditor
                    .getFraudProofType(staged.shadowed.author)
                    .request()
            ).to.equal(null);
        });

        it("control: another author's block on the run that ends at the auditor's head, at the height the honest dispute's tail replays → that stored block is agreed history: the linked conflict stores a dispute counter, false", async function () {
            const h = TestSession.getHarness();
            const staged = await stageSideBlockBelowAuditorHead(h, {
                onHeadRun: true
            });

            const run = await h.dispute.auditDispute(
                staged.auditorIndex,
                staged.dispute,
                staged.auditingData
            );

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            );
        });
    });

    // What an audit verifies but does not execute is kept as its dispute's
    // proof evidence: every reader of that material finds it there.
    describe("audit evidence readers", function () {
        it("a threshold-final head an audit verified and never executed → block history holds neither its block, snapshot nor state; the evidence holds the block and the state", async function () {
            const h = TestSession.getHarness();
            const staged = await stageAuditedHeadAboveView(h);
            const auditor = h.control(h.getPeer(staged.auditorIndex)).query;

            expect(staged.run).to.include({
                outcome: "returned",
                isValid: true
            });
            expect(staged.run.disputeFraudProofCount).to.equal(0);
            expect(
                await auditor
                    .getBlockHashAt(staged.forkId, staged.headHeight)
                    .request()
            ).to.equal(null);
            expect(
                await auditor
                    .getStateSnapshotStructByHash(
                        staged.headSnapshot.hash as Hash
                    )
                    .request()
            ).to.equal(null);
            expect(
                await holdsState(h, staged.auditorIndex, staged.headSnapshot)
            ).to.equal(false);
            expect(
                await evidenceBlockHashesAt(
                    h,
                    staged.auditorIndex,
                    staged.forkId,
                    staged.headHeight
                )
            ).to.have.length(1);
            expect(
                await holdsEvidenceState(
                    h,
                    staged.auditorIndex,
                    staged.headSnapshot
                )
            ).to.equal(true);
        });

        it("a head an audit kept only as evidence → the walk evidence of that dispute's proof ends at the head's snapshot", async function () {
            const h = TestSession.getHarness();
            const staged = await stageAuditedHeadAboveView(h);

            const encodedSnapshot = await h.execOnHost(
                h.getPeer(staged.auditorIndex),
                (sm, args, modules) =>
                    modules.Codec.encode(
                        sm.agreementManager
                            .getStoredEvidence(args.forkId, args.stateProof)
                            .milestoneSnapshots.at(-1)!,
                        modules.Type.StateSnapshot
                    ) as string,
                {
                    forkId: staged.forkId,
                    stateProof: staged.dispute.input.stateProof
                }
            );

            expect(
                StateSnapshot.from(
                    Codec.decode(encodedSnapshot, Type.StateSnapshot)
                ).hash
            ).to.equal(staged.headSnapshot.hash);
        });

        it("a head an audit kept only as evidence → that dispute's latest snapshot and state for a final dispute are the head's", async function () {
            const h = TestSession.getHarness();
            const staged = await stageAuditedHeadAboveView(h);

            const latest = await h.execOnHost(
                h.getPeer(staged.auditorIndex),
                (sm, args, modules) => {
                    const snapshot =
                        sm.agreementManager.getLatestSnapshotFromStateProof(
                            args.stateProof,
                            args.forkId
                        );
                    return {
                        encodedSnapshot: modules.Codec.encode(
                            snapshot.toStruct(),
                            modules.Type.StateSnapshot
                        ) as string,
                        hasState:
                            sm.storage.getStateIncludingEvidence(
                                snapshot.stateMachineStateHash
                            ) !== undefined
                    };
                },
                {
                    forkId: staged.forkId,
                    stateProof: staged.dispute.input.stateProof
                }
            );

            expect(
                StateSnapshot.from(
                    Codec.decode(latest.encodedSnapshot, Type.StateSnapshot)
                ).hash
            ).to.equal(staged.headSnapshot.hash);
            expect(latest.hasState).to.equal(true);
        });

        it("the same proof audited again with posted data that lacks the finalized state → the replay base state comes from the first audit's evidence: valid, no counter", async function () {
            const h = TestSession.getHarness();
            const staged = await stagePendingJoinerMissingHopBase(h);
            const first = await h.dispute.auditDispute(
                staged.charlieIndex,
                staged.dispute,
                staged.auditingData
            );
            expect(first).to.include({ outcome: "returned", isValid: true });
            // premise - the base state is evidence only
            expect(
                await holdsState(h, staged.charlieIndex, staged.baseSnapshot)
            ).to.equal(false);
            const auditingData = Codec.decode(
                Codec.encode(staged.auditingData, Type.DisputeAuditingData),
                Type.DisputeAuditingData
            );
            auditingData.latestFinalizedStateStateMachineState = "0x";
            const dispute = Codec.decode(
                Codec.encode(staged.dispute, Type.Dispute),
                Type.Dispute
            );
            dispute.input.disputeAuditingDataHash = hash(
                Codec.encode(auditingData, Type.DisputeAuditingData)
            );

            const again = await h.dispute.auditDispute(
                staged.charlieIndex,
                dispute,
                auditingData
            );

            expect(again).to.include({ outcome: "returned", isValid: true });
            expect(again.disputeFraudProofCount).to.equal(0);
        });

        it("the window reduces to a head the auditor kept only as audit evidence → its reduce data is found", async function () {
            const h = TestSession.getHarness();
            const { forkId, auditorIndex, head } =
                await stageHeadKeptOnlyAsAuditEvidence(h);
            // premise - the auditor holds no snapshot of the head
            expect(
                await h
                    .control(h.getPeer(auditorIndex))
                    .query.getStateSnapshotStructByHash(
                        head.stateSnapshotHash as Hash
                    )
                    .request()
            ).to.equal(null);

            const reduce = await h.query.reduceData(forkId, auditorIndex);

            expect(reduce.reducedHeight).to.equal(
                Number(
                    Codec.decode(head.encodedBlock, Type.Block).transaction
                        .header.transactionCnt
                )
            );
            expect(reduce.threw).to.equal("");
            expect(reduce.blockCount).to.not.equal(null);
        });
    });

    // An internal failure while replaying is no verdict on the peer's data.
    describe("internal replay failure", function () {
        it("U91: dispute replay fails internally at the second tail block after the first replayed -> the audit throws, no counter; the failed block is not stored, the first stays persisted", async function () {
            const h = TestSession.getHarness();
            const staged = await stageFrozenViewBehindDisputeTail(h);
            const frozen = h.getPeer(staged.frozenIndex);
            const tail = staged.dispute.input.stateProof.milestones
                .at(-1)!
                .blockConfirmations.map((confirmation) =>
                    Block.fromBlockConfirmation(confirmation)
                )
                .filter((block) => block.height > staged.frozenHeight);
            expect(tail).to.have.length(2);
            const [first, second] = tail as [Block, Block];
            await h
                .control(frozen)
                .stub.stubFailBlockReplayAt(staged.forkId, second.height)
                .request();

            const run = await h.dispute.auditDispute(
                staged.frozenIndex,
                staged.dispute,
                staged.auditingData
            );

            expect(run.outcome).to.equal("threw");
            expect(run.outcome === "threw" ? run.threwMessage : "").to.contain(
                BLOCK_REPLAY_FAULT_MESSAGE
            );
            expect(run.storedProof).to.equal(undefined);
            expect(run.disputeFraudProofCount).to.equal(0);
            expect(
                await h.control(frozen).stub.didBlockReplayFaultFire().request()
            ).to.equal(true);
            expect(
                await h
                    .control(frozen)
                    .query.getBlockByHash(second.hash)
                    .request(),
                "the failed block is not stored as replayed"
            ).to.be.null;
            // each replayed block commits before the next one runs, without
            // moving the view: the earlier success stays persisted
            expect(
                await h
                    .control(frozen)
                    .query.getBlockByHash(first.hash)
                    .request(),
                "the first replayed block is persisted"
            ).to.not.be.null;
            expect(
                await holdsState(
                    h,
                    staged.frozenIndex,
                    await snapshotAt(h, staged.disputerIndex, first.height)
                )
            ).to.equal(true);
        });

        it("U91: sync replay fails internally at the second tail block after the first replayed -> the sync throws, the responder is not blacklisted, the failed block is not stored", async function () {
            const h = TestSession.getHarness();
            const staged = await stageLaggingParticipantBehindTail(h);
            const lagging = h.getPeer(staged.laggingIndex);
            const responder = h.getPeer(staged.live[0]!);
            const failedHeight = staged.laggingHeight + 2;
            const failed = (await h
                .control(responder)
                .query.getBlockByHeight(staged.forkId, failedHeight)
                .request())!;
            await h
                .control(lagging)
                .stub.stubFailBlockReplayAt(staged.forkId, failedHeight)
                .request();

            let threw = "";
            try {
                await h.execOnHost(
                    lagging,
                    async (sm, args) =>
                        await sm.p2pManager.localRpc.spectateService.requestSync(
                            args.responder,
                            sm.channelId,
                            args.forkId
                        ),
                    { responder: responder.address, forkId: staged.forkId }
                );
            } catch (error) {
                threw = error instanceof Error ? error.message : String(error);
            }

            expect(threw).to.contain(BLOCK_REPLAY_FAULT_MESSAGE);
            // premise: the first tail block replayed before the fault
            expect(
                await holdsState(
                    h,
                    staged.laggingIndex,
                    await snapshotAt(
                        h,
                        responder.index,
                        staged.laggingHeight + 1
                    )
                ),
                "the first tail block replayed before the fault"
            ).to.equal(true);
            expect(
                await h
                    .control(lagging)
                    .stub.didBlockReplayFaultFire()
                    .request()
            ).to.equal(true);
            expect(
                await h
                    .control(lagging)
                    .query.isBlacklisted(responder.address)
                    .request()
            ).to.equal(false);
            expect(
                await h
                    .control(lagging)
                    .query.getBlockByHash(failed.hash as Hash)
                    .request(),
                "the failed block is not stored"
            ).to.be.null;
        });
    });

    describe("pending auditor", function () {
        it("U87: the replayed tail consumes the pending auditor's JOIN and seats it -> the replay is persisted, the auditor stays PENDING_PARTICIPANT with its view and force-join state unchanged, and signs nothing", async function () {
            const h = TestSession.getHarness();
            const staged = await stagePendingAuditorBehindJoin(h, {
                consumeJoin: true
            });
            const pending = h.getPeer(staged.pendingIndex);
            const before = await activeView(h, staged.pendingIndex);
            expect(before.status).to.equal(Status.PENDING_PARTICIPANT);
            const head = Block.fromBlockConfirmation(
                staged.dispute.input.stateProof.milestones
                    .at(-1)!
                    .blockConfirmations.at(-1)!
            );
            // premise: the replayed head seats the joiner
            expect(
                (
                    await snapshotAt(h, 0, head.height)
                ).snapshotData.participants.map(String)
            ).to.include(pending.address);

            const run = await h.dispute.auditDispute(
                staged.pendingIndex,
                staged.dispute,
                staged.auditingData
            );

            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(await activeView(h, staged.pendingIndex)).to.deep.equal(
                before
            );
            const stored = await h
                .control(pending)
                .query.getBlockByHash(head.hash)
                .request();
            expect(stored, "the replayed head is stored").to.not.be.null;
            expect(stored!.confirmationSignerAddresses).to.not.include(
                pending.address
            );
        });

        it("U87: the dispute's blocks leave the pending auditor's JOIN unconsumed -> the audit persists them, the auditor stays PENDING_PARTICIPANT with its view and force-join state unchanged", async function () {
            const h = TestSession.getHarness();
            const staged = await stagePendingAuditorBehindJoin(h, {
                consumeJoin: false
            });
            const pending = h.getPeer(staged.pendingIndex);
            const before = await activeView(h, staged.pendingIndex);
            expect(before.status).to.equal(Status.PENDING_PARTICIPANT);
            const head = Block.fromBlockConfirmation(
                staged.dispute.input.stateProof.milestones
                    .at(-1)!
                    .blockConfirmations.at(-1)!
            );
            expect(
                (
                    await snapshotAt(h, 0, head.height)
                ).snapshotData.participants.map(String)
            ).to.not.include(pending.address);

            const run = await h.dispute.auditDispute(
                staged.pendingIndex,
                staged.dispute,
                staged.auditingData
            );

            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(await activeView(h, staged.pendingIndex)).to.deep.equal(
                before
            );
            expect(
                await holdsEvidenceState(
                    h,
                    staged.pendingIndex,
                    await snapshotAt(h, 0, head.height)
                ),
                "the dispute's latest state is kept as evidence for reduction"
            ).to.equal(true);
        });
    });
});

import { Status } from "@/types";
import {
    DisputeFraudProofType,
    toSolidityDisputeFraudProofType
} from "@/types/sol-enums";
import { Codec, Type, hash } from "@/utils";
import {
    expectAnchorRuleAloneAllowsOmission,
    expectAvailabilityKillOnChain,
    expectOnlyAvailabilityCounter,
    holdsDisputeLatestState,
    lastInitiatedDispute,
    lastMilestoneFirstBlockSigners,
    lastMilestoneHeights,
    stageAnchoredUnfinalizedTail,
    stageEveryoneFinalHeadWithBlindAuditors,
    stubOmittedDataWithLaterFault,
    waitUntilAuditAccepted
} from "@test/fixtures/AuditingDataAvailabilityStaging";
import {
    assertColludersKilledByConflict,
    stageBlindPendingAuditor
} from "@test/fixtures/DisputeAuditStaging";
import { readDisputeKill } from "@test/fixtures/OmittedInboundJoinerStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

describe("E2E: dispute validation / auditing data availability", function () {
    describe("auditing data omitted, the anchor is in the last milestone", function () {
        it("E11: a participant holding only the anchor state replays the unfinalized tail and accepts the dispute", async function () {
            const h = TestSession.getHarness();
            const staging = await stageAnchoredUnfinalizedTail(h);
            const auditorIndex = staging.blindParticipantIndex;
            const auditor = h.control(h.getPeer(auditorIndex));
            // the auditor never received the tail
            expect(
                await auditor.query
                    .getLatestBlockHeight(staging.forkId)
                    .request()
            ).to.equal(staging.anchorHeight);

            await h.byzantine.submitInvalidStateTransitionBlock(
                staging.offenderIndex
            );
            await h.assert.dispute.initiatedWait({
                peersIndices: [staging.disputerIndex],
                initiatedWithAuditingData: false
            });
            const { disputeHash, dispute } = lastInitiatedDispute(
                h,
                staging.disputerIndex
            );
            await expectAnchorRuleAloneAllowsOmission(h, staging, dispute);

            // the audit ran every check: a participant stores the
            // confirmation only after the audit returned valid
            await waitUntilAuditAccepted(h, auditorIndex, disputeHash);
            expect(
                await holdsDisputeLatestState(h, auditorIndex, dispute)
            ).to.equal(true);
            expect(
                await auditor.query.getDisputeFraudProofTypes().request()
            ).to.deep.equal([]);

            await h.dispute.resolveDisputeWait({
                forkId: staging.forkId,
                honestPeerIndices: [staging.disputerIndex],
                assertMaliciousRemoved: false
            });
        });

        it("E11: a pending participant holding only the anchor state replays the unfinalized tail and accepts the dispute", async function () {
            const h = TestSession.getHarness();
            const staging = await stageAnchoredUnfinalizedTail(h);
            const auditorIndex = staging.pendingJoinerIndex;
            const auditor = h.control(h.getPeer(auditorIndex));
            // the auditor never received the tail
            expect(
                await auditor.query
                    .getLatestBlockHeight(staging.forkId)
                    .request()
            ).to.equal(staging.anchorHeight);

            await h.byzantine.submitInvalidStateTransitionBlock(
                staging.offenderIndex
            );
            await h.assert.dispute.initiatedWait({
                peersIndices: [staging.disputerIndex],
                initiatedWithAuditingData: false
            });
            const { disputeHash, dispute } = lastInitiatedDispute(
                h,
                staging.disputerIndex
            );
            await expectAnchorRuleAloneAllowsOmission(h, staging, dispute);

            // the audit ran every check: a pending participant stores the
            // confirmation only after the audit returned valid
            await waitUntilAuditAccepted(h, auditorIndex, disputeHash);
            expect(
                await holdsDisputeLatestState(h, auditorIndex, dispute)
            ).to.equal(true);
            expect(
                await auditor.query.getDisputeFraudProofTypes().request()
            ).to.deep.equal([]);
            // the replay persisted the tail without seating the joiner
            expect(await auditor.query.getStatus().request()).to.equal(
                Status.PENDING_PARTICIPANT
            );

            await h.dispute.resolveDisputeWait({
                forkId: staging.forkId,
                honestPeerIndices: [staging.disputerIndex],
                assertMaliciousRemoved: false
            });
        });
    });

    describe("auditing data omitted, everyone in the required set signed the last milestone", function () {
        it("E12: with no anchor in the last milestone, a participant and a pending participant that never received the tail reconstruct the latest state from their own final head and accept the omitted-data dispute", async function () {
            const h = TestSession.getHarness();
            const staging = await stageEveryoneFinalHeadWithBlindAuditors(h);
            const {
                forkId,
                headHeight,
                blindParticipantIndex,
                pendingJoinerIndex,
                disputerIndex,
                offenderIndex
            } = staging;
            const auditorIndices = [blindParticipantIndex, pendingJoinerIndex];
            const joinerAddress = h.getPeer(pendingJoinerIndex).address;
            expect([
                ...(await h.channelManager.getPendingParticipants(h.channelId))
            ]).to.include(joinerAddress);
            // the auditors never received the tail
            for (const index of auditorIndices)
                expect(
                    await h
                        .control(h.getPeer(index))
                        .query.getLatestBlockHeight(forkId)
                        .request()
                ).to.equal(headHeight);

            await h.byzantine.submitInvalidStateTransitionBlock(offenderIndex);
            await h.assert.dispute.initiatedWait({
                peersIndices: [disputerIndex],
                initiatedWithAuditingData: false
            });
            const { disputeHash, dispute } = lastInitiatedDispute(
                h,
                disputerIndex
            );
            // the precondition: everyone in the required set signed the head,
            // the offender too, and no chain anchor is in the last milestone
            expect(
                await h.channelManager.isAuditingDataOmissionAllowed.staticCall(
                    dispute
                )
            ).to.equal(true);
            const chainAnchor = await h.channelManager.getStateSnapshot(
                h.channelId
            );
            const { first, last } = lastMilestoneHeights(dispute);
            expect(first).to.equal(headHeight);
            expect(first).to.be.greaterThan(Number(chainAnchor.blockHeight));
            expect(last).to.equal(headHeight + 1);
            const signers = lastMilestoneFirstBlockSigners(dispute);
            for (const index of [
                offenderIndex,
                disputerIndex,
                blindParticipantIndex,
                pendingJoinerIndex
            ])
                expect(signers).to.include(h.getPeer(index).address);

            // each blind auditor replayed the tail from its own final head:
            // it accepts only after holding the dispute's latest state
            for (const index of auditorIndices) {
                await waitUntilAuditAccepted(h, index, disputeHash);
                expect(
                    await holdsDisputeLatestState(h, index, dispute)
                ).to.equal(true);
                expect(
                    await h
                        .control(h.getPeer(index))
                        .query.getDisputeFraudProofTypes()
                        .request()
                ).to.deep.equal([]);
            }

            await h.dispute.resolveDisputeWait({
                forkId,
                honestPeerIndices: [disputerIndex],
                assertMaliciousRemoved: false
            });
        });
    });

    describe("auditing data omitted while a required signer is missing from the last milestone", function () {
        it("E13: a participant never signed → the availability counter kills the dispute before the later latest-state check", async function () {
            const h = TestSession.getHarness();
            // peer 2 is disconnected from the start: it signs no block
            await h.scenario.preDisputeSetupDisconnectedPeer();
            const forkId = h.activeForkId!;
            const missingSignerIndex = 2;
            const disputerIndex = 3;
            const auditorIndices = [0, missingSignerIndex];
            // the disconnected peer only audits; its own dispute is not part of the case
            await h.dispute.suppressDisputeInitiation([missingSignerIndex]);
            // the submitter and the double signer never kill: the kill is an auditor's
            await h.rpcStub.suppressDisputeKill(disputerIndex);
            await h.rpcStub.suppressDisputeKill(1);
            await stubOmittedDataWithLaterFault(h, disputerIndex);

            await h.byzantine.submitDoubleSignBlock(1);
            await h.assert.dispute.initiatedWait({
                peersIndices: [disputerIndex],
                initiatedWithAuditingData: false
            });
            const { dispute } = lastInitiatedDispute(h, disputerIndex);
            expect(lastMilestoneFirstBlockSigners(dispute)).to.not.include(
                h.getPeer(missingSignerIndex).address
            );

            await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                mode: "atLeast"
            });
            await h.assert.dispute.slashedOnChain(
                h.getPeer(disputerIndex).address
            );
            await expectAvailabilityKillOnChain(
                h,
                disputerIndex,
                auditorIndices
            );
            await expectOnlyAvailabilityCounter(h, auditorIndices);

            await h.tamper.restoreConstructDispute(disputerIndex);
            await h.dispute.resolveDisputeWait({ forkId });
        });

        it("E13: the pending participant never signed → the availability counter kills the dispute before the later latest-state check", async function () {
            const h = TestSession.getHarness();
            // a forced joiner without a peer process is pending on chain and signs nothing
            await h.scenario.preDisputeSetupCalldataPath();
            const forkId = h.activeForkId!;
            const disputerIndex = 2;
            const auditorIndices = [0, 3];
            // the submitter and the offender never kill: the kill is an auditor's
            await h.rpcStub.suppressDisputeKill(disputerIndex);
            await h.rpcStub.suppressDisputeKill(1);
            await stubOmittedDataWithLaterFault(h, disputerIndex);
            // a second, valid dispute from peer 0 would be audited inside the
            // same kill period; it is submitted after the kill instead
            await h.dispute.suppressDisputeInitiation([0]);

            await h.byzantine.submitInvalidStateTransitionBlock(1);
            await h.assert.dispute.initiatedWait({
                peersIndices: [disputerIndex],
                initiatedWithAuditingData: false
            });
            const { dispute } = lastInitiatedDispute(h, disputerIndex);
            const peerAddresses = h.peers.map((peer) => peer.address);
            const pendingJoiner = [
                ...(await h.channelManager.getPendingParticipants(h.channelId))
            ].find((address) => !peerAddresses.includes(address));
            expect(pendingJoiner, "the forced joiner is pending on chain").to
                .not.be.undefined;
            expect(lastMilestoneFirstBlockSigners(dispute)).to.not.include(
                pendingJoiner
            );

            await h.event.waitForPeers("onDisputeKilled", auditorIndices, 1, {
                mode: "atLeast"
            });
            await h.assert.dispute.slashedOnChain(
                h.getPeer(disputerIndex).address
            );
            await expectAvailabilityKillOnChain(
                h,
                disputerIndex,
                auditorIndices
            );
            await expectOnlyAvailabilityCounter(h, auditorIndices);

            await h.tamper.restoreConstructDispute(disputerIndex);
            await h.rpcStub.restoreDisputeInitiationAndDispute(0, forkId);
            await h.dispute.resolveDisputeWait({
                forkId,
                syntheticOnChainParticipants: 1
            });
        });
    });

    describe("auditing data posted because omission is not permitted", function () {
        it("E14: auditors audit a valid dispute with the posted data and accept it", async function () {
            const h = TestSession.getHarness();
            // the pending forced joiner never signs: no dispute may omit its data
            await h.scenario.preDisputeSetupCalldataPath();
            const forkId = h.activeForkId!;
            const offenderIndex = 1;
            const disputerIndex = 0;

            await h.byzantine.submitInvalidStateTransitionBlock(offenderIndex);
            await h.assert.dispute.initiatedWait({
                peersIndices: [disputerIndex],
                initiatedWithAuditingData: true
            });
            const { disputeHash, dispute } = lastInitiatedDispute(
                h,
                disputerIndex
            );
            // the pending joiner signed nothing: the chain forbids omission
            expect(
                await h.channelManager.isAuditingDataOmissionAllowed.staticCall(
                    dispute
                )
            ).to.equal(false);
            await waitUntilAuditAccepted(h, 2, disputeHash);
            await waitUntilAuditAccepted(h, 3, disputeHash);
            // the acceptance rests on the posted data: auditor 3 judges the
            // same dispute without it as an availability fault
            const withoutData = await h.dispute.auditDispute(3, {
                ...dispute,
                postedAuditingData: false
            });
            expect(withoutData).to.include({
                outcome: "returned",
                isValid: false
            });
            expect(withoutData.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData
            );

            await h.dispute.resolveDisputeWait({
                forkId,
                syntheticOnChainParticipants: 1
            });
            // no live counter: auditor 3 holds only the probe's
            for (const index of [0, 2])
                expect(
                    await h
                        .control(h.getPeer(index))
                        .query.getDisputeFraudProofTypes()
                        .request()
                ).to.deep.equal([]);
            expect(
                await h
                    .control(h.getPeer(3))
                    .query.getDisputeFraudProofTypes()
                    .request()
            ).to.deep.equal([
                String(
                    toSolidityDisputeFraudProofType(
                        DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData
                    )
                )
            ]);
            await h.assert.dispute.slashedOnChain(
                h.getPeer(offenderIndex).address
            );
        });

        it("E14: the posted latest snapshot breaks the balance invariant; a pending auditor without a final block at the forged head → DisputeInvalidBalanceInvariant kills the dispute, then DisputeConflictsWithFinalState kills the colluders' real-head disputes", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({ peerCount: 4 });
            const forkId = h.activeForkId!;
            const disputerIndex = 2;
            // the pending auditor never signs: no dispute may omit its data,
            // and the colluders' head is one it never finalized
            const { auditorIndex, restoreGossip } =
                await stageBlindPendingAuditor(h, [0, 1, 2, 3]);
            // the participants (the submitter's own node too) hold the real
            // head final: only the auditor's balance counter may land
            await Promise.all(
                [0, 1, 2, 3].map((index) =>
                    h.rpcStub.suppressDisputeKill(index)
                )
            );

            const forged = await h.tamper.buildForgedSnapshot(
                disputerIndex,
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

            await h.tamper.postTamperedDispute(
                disputerIndex,
                (dispute, _confirmation, auditingData) => {
                    if (!dispute.postedAuditingData || !auditingData) {
                        throw new Error(
                            "expected a dispute that must post its auditing data"
                        );
                    }
                    // the forged block replaces the latest block, the first
                    // block of the last (threshold-final) milestone
                    const milestone =
                        dispute.input.stateProof.milestones.at(-1);
                    if (milestone?.blockConfirmations.length !== 1) {
                        throw new Error(
                            "expected the last milestone to hold only the latest block"
                        );
                    }
                    milestone.blockConfirmations[0] =
                        forged.forgedBlock.blockConfirmationStruct;
                    auditingData.milestoneSnapshots[
                        auditingData.milestoneSnapshots.length - 1
                    ] = forged.forgedSnapshot.toStruct();
                    auditingData.latestStateSnapshot =
                        forged.forgedSnapshot.toStruct();
                    dispute.input.latestStateSnapshotHash =
                        forged.forgedSnapshot.hash;
                    dispute.input.disputeAuditingDataHash = hash(
                        Codec.encode(auditingData, Type.DisputeAuditingData)
                    );
                }
            );

            await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidBalanceInvariant,
                peerIndices: [auditorIndex]
            });
            await h.event.waitForPeers("onDisputeKilled", [auditorIndex], 1, {
                mode: "atLeast"
            });
            const kill = await readDisputeKill(
                h,
                h.getPeer(disputerIndex).address
            );
            expect(kill.killer).to.equal(h.getPeer(auditorIndex).address);
            expect(kill.appliedProofTypes).to.deep.equal([
                DisputeFraudProofType.DisputeInvalidBalanceInvariant
            ]);
            await h.assert.dispute.slashedOnChain(
                h.getPeer(disputerIndex).address
            );
            await restoreGossip();
            await assertColludersKilledByConflict(h, {
                forkId,
                auditorIndex,
                submitterIndex: disputerIndex,
                colluderIndices: [0, 1, 3]
            });
        });
    });
});

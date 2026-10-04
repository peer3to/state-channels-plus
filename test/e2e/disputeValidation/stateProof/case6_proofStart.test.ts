import Block from "@/models/Block";
import StateSnapshot from "@/models/StateSnapshot";
import {
    DisputeFraudProofType,
    toSolidityDisputeFraudProofType
} from "@/types/sol-enums";
import { Codec, hash, Type } from "@/utils";
import {
    craftProofBlock,
    forgedTimestamp,
    stageAuditorBehindOnChainAnchor,
    stageExitAnchoredFork,
    storedProofBlock
} from "@test/fixtures/DisputeAuditStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import type { DisputeFraudProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import { expect } from "chai";

// Case 6: proof start. A same-fork exit snapshot above height 0 is the proof
// start: an honest proof is one run holding it. A claim that ends below it
// (or an empty proof) is obsolete, not current, and the dedicated counter
// kills it.
describe("E2E: dispute validation / stateProof / Case 6 (proof start)", function () {
    it("a dispute whose only block is an unlinked forgery below the on-chain anchor → DisputeStateProofBelowOnChainAnchor, the forger is removed, no honest slash", async function () {
        const h = TestSession.getHarness();
        const { forkId, participants, anchorHeight } =
            await stageExitAnchoredFork(h);
        const [forger, ...honest] = participants;
        const forged = await craftProofBlock(h, {
            authorIndex: forger,
            forkId,
            height: anchorHeight - 1
        });

        // posted auditing data: the availability counter does not apply, so
        // only the dedicated below-anchor counter can kill the claim
        await h.tamper.postTamperedDispute(forger, (dispute) => {
            dispute.input.stateProof = {
                milestones: [
                    {
                        blockConfirmations: [
                            { signedBlock: forged.signedBlock, signatures: [] }
                        ]
                    }
                ]
            };
            dispute.input.latestStateSnapshotHash =
                forged.block.stateSnapshotHash;
            dispute.postedAuditingData = true;
        });

        await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
            disputeFraudProofType:
                DisputeFraudProofType.DisputeStateProofBelowOnChainAnchor,
            peerIndices: honest,
            atLeastOneHonestPeer: true
        });
        await h.dispute.resolveDisputeWait({
            forkId,
            honestPeerIndices: honest
        });

        const slashed = await h.query.onChainSlashedParticipants(honest[0]);
        for (const index of honest)
            expect(slashed).to.not.include(h.getPeer(index).address);
    });

    it("an empty-proof dispute after a same-fork exit snapshot → DisputeStateProofBelowOnChainAnchor, no honest slash", async function () {
        const h = TestSession.getHarness();
        const { forkId, participants } = await stageExitAnchoredFork(h);
        const [disputer] = participants;
        const honest = participants.filter((index) => index !== disputer);

        await h.tamper.postTamperedDispute(disputer, (dispute) => {
            dispute.input.stateProof = { milestones: [] };
            dispute.postedAuditingData = false;
        });

        await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
            disputeFraudProofType:
                DisputeFraudProofType.DisputeStateProofBelowOnChainAnchor,
            peerIndices: honest,
            atLeastOneHonestPeer: true
        });
        await h.dispute.resolveDisputeWait({
            forkId,
            honestPeerIndices: honest,
            assertMaliciousRemoved: false
        });

        const slashed = await h.query.onChainSlashedParticipants(honest[0]);
        for (const index of honest)
            expect(slashed).to.not.include(h.getPeer(index).address);
    });

    it("a prover whose mirror missed the exit snapshot builds from the genesis; the chain accepts it; the dispute resolves; no slash", async function () {
        const h = TestSession.getHarness();
        // peer 1's local copy of the on-chain snapshot stays at the genesis
        const { auditorIndex: prover, anchorHeight } =
            await stageAuditorBehindOnChainAnchor(h);
        const forkId = h.activeForkId!;
        const submissions = await h.rpcStub.recordDisputeSubmissions(prover, {
            forward: true
        });

        await h.byzantine.submitDoubleSignBlock(0);
        await waitFor(async () => (await submissions.submissions()).length > 0);
        const { stateProof } = Codec.decode(
            (await submissions.submissions())[0].encodedDispute,
            Type.Dispute
        ).input;
        expect(
            Block.fromBlockConfirmation(
                stateProof.milestones[0].blockConfirmations[0]
            ).height,
            "the proof starts below the on-chain snapshot"
        ).to.be.lessThan(anchorHeight);

        await h.dispute.resolveDisputeWait({
            forkId,
            honestPeerIndices: [prover]
        });
        const slashed = await h.query.onChainSlashedParticipants(prover);
        expect(slashed).to.not.include(h.getPeer(prover).address);
    });

    it("a committed posted proof with an undecodable block in a milestone below the on-chain anchor is audited valid through the lifecycle: no fraud proof, no kill, the skipped prefix is not persisted, the balance check still runs, a structure allegation at that position cannot punish the submitter, no honest slash", async function () {
        const h = TestSession.getHarness();
        const { forkId, participants, anchorHeight } =
            await stageExitAnchoredFork(h);
        const [disputer, ...auditors] = participants;
        const leaver = [0, 1, 2, 3].find(
            (index) => !participants.includes(index)
        )!;
        expect(anchorHeight, "room for an interior block").to.be.greaterThan(1);
        for (const index of participants)
            await h.rpcStub.suppressTimeoutCheck(index);
        // an honest self-removal dispute: nothing in it is a fault. It is
        // posted on the disputer's behalf; its runtime must not re-upload it
        await h
            .control(h.getPeer(disputer))
            .dispute.setForceExit(true)
            .request();
        await h.dispute.suppressDisputeInitiation([disputer]);
        h.context.leftChannelPeerIndices = [
            ...h.context.leftChannelPeerIndices,
            disputer
        ];
        const first = await storedProofBlock(h, disputer, forkId, 0);
        const last = await storedProofBlock(
            h,
            disputer,
            forkId,
            anchorHeight - 1
        );
        // the skipped milestone's snapshot: committed by no stored block
        const prefixSnapshot = forgedTimestamp(first.snapshot);
        const balanceChecks = await h.mirror.observe(
            auditors[0],
            "verifyBalanceInvariantCheckSnapshot"
        );

        const { dispute } = await h.tamper.postTamperedDispute(
            disputer,
            (dispute, _confirmation, auditingData) => {
                // [0, undecodable, anchor - 1]: wholly below the anchor, so skipped
                dispute.input.stateProof.milestones.unshift({
                    blockConfirmations: [
                        first.confirmation,
                        {
                            signedBlock: {
                                encodedBlock: "0xdeadbeef",
                                signature:
                                    first.confirmation.signedBlock.signature
                            },
                            signatures: []
                        },
                        last.confirmation
                    ]
                });
                auditingData!.milestoneSnapshots.unshift(prefixSnapshot);
                dispute.input.disputeAuditingDataHash = hash(
                    Codec.encode(auditingData!, Type.DisputeAuditingData)
                );
                dispute.postedAuditingData = true;
            },
            { markMalicious: false }
        );
        await h.assert.dispute.committedWait({
            peersIndices: auditors,
            expectedCount: 1
        });

        // a structure allegation at the undecodable block's original
        // position (0, 1), sent by the leaver: the chain judges position 1
        // of the last milestone only, which holds no malformed block
        const allegation: DisputeFraudProofStruct = {
            proofType: toSolidityDisputeFraudProofType(
                DisputeFraudProofType.DisputeInvalidBlockStructure
            ),
            participant: dispute.input.disputer,
            dispute,
            encodedProof: Codec.encode(
                { blockIndex: 1n },
                DisputeFraudProofType.DisputeInvalidBlockStructure
            )
        };
        // the leaver's runtime aborted on the dispute (it is no participant);
        // its own key sends the allegation
        const alleger = h.getPeer(leaver);
        expect(
            await h.channelManager.canParticipateInDisputes(
                h.channelId,
                alleger.address
            )
        ).to.equal(false);
        await (
            await h.channelManager
                .connect(alleger.signer)
                .applyDisputeFraudProofs([allegation])
        ).wait();
        expect(
            await h.query.onChainSlashedParticipants(auditors[0]),
            "the allegation cannot punish the submitter"
        ).to.not.include(h.getPeer(disputer).address);

        // the independent balance check ran in the live audit
        await waitFor(
            async () => (await balanceChecks.observation()).local.reads > 0
        );
        await h.dispute.resolveDisputeWait({
            forkId,
            honestPeerIndices: auditors,
            assertMaliciousRemoved: false
        });

        for (const index of auditors) {
            const query = h.control(h.getPeer(index)).query;
            expect(
                await query.getDisputeFraudProofTypes().request(),
                `peer ${index} stored no fraud proof`
            ).to.deep.equal([]);
            expect(
                h.event.getEventCallCount(index, "onDisputeKilled")
            ).to.equal(0);
            expect(
                await query
                    .getStateSnapshotStructByHash(
                        StateSnapshot.from(prefixSnapshot).hash
                    )
                    .request(),
                `peer ${index} persisted no skipped-prefix snapshot`
            ).to.equal(null);
        }
        const slashed = await h.query.onChainSlashedParticipants(auditors[0]);
        for (const index of participants)
            expect(slashed).to.not.include(h.getPeer(index).address);
    });
});

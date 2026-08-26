import { expect } from "chai";
import { Codec, Type, hash } from "@/utils";
import { DisputeFraudProofType } from "@/types/sol-enums";
import { MathTestSession as TestSession } from "@test/harness";

describe("E2E: dispute validation / balanceInvariant", function () {
    it("an honest dispute with nonzero genesis deposits passes the local balance invariant", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup();
        await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
        const { dispute, auditingData } =
            await h.dispute.fetchConstructedDispute(0);

        expect(
            BigInt(
                auditingData.latestStateSnapshot.snapshotData.totalDeposits
                    .amount
            )
        ).to.be.greaterThan(0n);

        const run = await h.dispute.auditDispute(1, dispute);

        expect(run).to.include({ outcome: "returned", isValid: true });
        expect(run.disputeFraudProofCount).to.equal(0);
    });

    it("peer 2 uploads a dispute whose committed snapshot breaks the balance invariant → DisputeInvalidBalanceInvariant", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup();
        const forkId = h.activeForkId!;

        const forged = await h.tamper.buildForgedSnapshot(2, (ctx) => ({
            snapshotData: {
                ...ctx.originalSnapshotData,
                totalDeposits: {
                    ...ctx.originalSnapshotData.totalDeposits,
                    amount:
                        BigInt(ctx.originalSnapshotData.totalDeposits.amount) +
                        1n
                }
            }
        }));
        expect(
            BigInt(forged.originalSnapshot.snapshotData.totalDeposits.amount)
        ).to.be.greaterThan(0n);

        await h.tamper.postTamperedDispute(
            2,
            (dispute, _confirmation, auditingData) => {
                if (!auditingData) {
                    throw new Error("expected dispute auditing data");
                }

                const proof = dispute.input.stateProof;
                if (proof.signedBlocks.length > 0) {
                    proof.signedBlocks[proof.signedBlocks.length - 1] =
                        forged.forgedBlock.signedBlock;
                } else {
                    const milestone = proof.milestones.at(-1);
                    if (!milestone?.blockConfirmations.length) {
                        throw new Error("expected a latest state-proof block");
                    }
                    milestone.blockConfirmations[0] =
                        forged.forgedBlock.blockConfirmationStruct;
                    auditingData.milestoneSnapshots[
                        auditingData.milestoneSnapshots.length - 1
                    ] = forged.forgedSnapshot.toStruct();
                }

                auditingData.latestStateSnapshot =
                    forged.forgedSnapshot.toStruct();
                dispute.input.latestStateSnapshotHash =
                    forged.forgedSnapshot.hash;
                dispute.input.disputeAuditingDataHash = hash(
                    Codec.encode(auditingData, Type.DisputeAuditingData)
                );
                dispute.postedAuditingData = true;
            }
        );

        await h.assert.dispute.committedWait({
            peersIndices: [0, 1],
            expectedCount: 1
        });
        await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
            disputeFraudProofType:
                DisputeFraudProofType.DisputeInvalidBalanceInvariant,
            peerIndices: [0, 1]
        });
        await h.event.waitForPeers("onDisputeKilled", [0, 1], 1, {
            mode: "atLeast"
        });
        await h.dispute.resolveDisputeWait({ forkId });
    });
});

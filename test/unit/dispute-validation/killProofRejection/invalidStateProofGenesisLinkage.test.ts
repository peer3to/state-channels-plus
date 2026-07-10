import { Codec, Type } from "@/utils";
import {
    DisputeFraudProofType,
    toSolidityDisputeFraudProofType
} from "@/types/sol-enums";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";
import { hexString } from "../../../factory";
import { covers } from "../domain";

describe("dispute-validation / killProofRejection / invalidStateProofGenesisLinkage", function () {
    it(
        "unlinked genesisStateSnapshotData against a valid genesis dispute → submitter slashed, honest disputer survives",
        covers(
            {
                bogusKillProof: "DisputeInvalidStateProof",
                forkId: "unlinked",
                postedAuditingData: "false"
            },
            async function () {
                const h = TestSession.getHarness();

                const honestDisputerIndex = 1;
                const byzantineIndex = 2;

                await h.lifecycle.timeoutSetup(4);

                await h.assert.dispute.initiatedWait({
                    peersIndices: [honestDisputerIndex],
                    timeoutMs: 15000
                });
                // peers 1,2,3 dispute the timed-out peer 0 -> 3 commitments (peer 0 is the defendant)
                await h.assert.dispute.committedWait({
                    expectedCount: 3,
                    mode: "atLeast",
                    timeoutMs: 15000
                });

                const dispute = h.getPeer(honestDisputerIndex).eventSpies
                    .onInitiatingDispute!.lastCall.args[1] as DisputeStruct;

                expect(
                    dispute.input.stateProof.milestones.length === 0 &&
                        dispute.input.stateProof.signedBlocks.length === 0 &&
                        dispute.postedAuditingData === false,
                    "expected a non-posted genesis dispute (empty stateProof)"
                ).to.equal(true);

                // real auditing data for the empty genesis stateProof (correct genesis), then
                // corrupt the genesis so keccak256(genesisStateSnapshotData) != forkId -> unlinked
                const { encodedAuditingData } = await h
                    .control(h.getPeer(byzantineIndex))
                    .dispute.getAuditingData(
                        h.activeForkId!,
                        Codec.encode(
                            dispute.input.stateProof,
                            Type.StateProof
                        ) as string
                    )
                    .request();
                const auditingData = Codec.decode(
                    encodedAuditingData,
                    Type.DisputeAuditingData
                );
                auditingData.genesisStateSnapshotData.stateMachineStateHash =
                    hexString(32);

                h.contextApi.markMaliciousPeer({
                    maliciousPeerIndex: byzantineIndex
                });

                const proof = {
                    proofType: toSolidityDisputeFraudProofType(
                        DisputeFraudProofType.DisputeInvalidStateProof
                    ),
                    participant: dispute.input.disputer,
                    dispute,
                    encodedProof: Codec.encode(
                        { auditingData },
                        DisputeFraudProofType.DisputeInvalidStateProof
                    )
                };

                const tx = await h.channelManager
                    .connect(h.getPeer(byzantineIndex).signer)
                    .applyDisputeFraudProofs([proof]);
                await tx.wait();

                // The honest disputer must NOT be slashed by the bogus proof,
                // and the bogus-proof submitter must be slashed instead.
                const slashed =
                    await h.channelManager.getOnChainSlashedParticipants(
                        h.channelId
                    );
                const disputerAddr = h
                    .getPeer(honestDisputerIndex)
                    .address.toLowerCase();
                expect(
                    slashed.some((a) => a.toLowerCase() === disputerAddr),
                    "honest disputer must NOT be slashed"
                ).to.equal(false);
                await h.assert.dispute.slashedOnChain(
                    h.getPeer(byzantineIndex).address,
                    "byzantine bad-proof submitter must be on-chain slashed"
                );
            }
        )
    );
});

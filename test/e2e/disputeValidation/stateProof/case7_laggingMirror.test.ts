import Block from "@/models/Block";
import StateSnapshot from "@/models/StateSnapshot";
import { DisputeFraudProofType } from "@/types/sol-enums";
import { Codec } from "@/utils";
import {
    craftProofBlock,
    forgedTimestamp,
    stageAuditorBehindOnChainAnchor,
    storedProofBlock
} from "@test/fixtures/DisputeAuditStaging";
import {
    branchingRunBelowAnchor,
    postDisputeWithProof,
    stageExitAnchoredForkWithLaggingMirror,
    storedDisputeFraudProof
} from "@test/fixtures/StateProofLifecycleStaging";
import {
    expectUnfinalTailStateProof,
    MathTestSession as TestSession
} from "@test/harness";
import type { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { expect } from "chai";

// Case 7: an auditor whose local mirror missed the same-fork exit snapshot.
// Block allegations follow the submitted proof and the chain's anchor, read
// per allegation, never the mirror's.
describe("E2E: dispute validation / stateProof / Case 7 (lagging mirror)", function () {
    it("lagging auditor mirror applies proof for exact submitted milestone/block position", async function () {
        const h = TestSession.getHarness();
        // peer 1's mirror never applies the exit snapshot
        const { auditorIndex, anchorHeight } =
            await stageAuditorBehindOnChainAnchor(h);
        const disputer = 0;
        const forkId = h.activeForkId!;
        for (const index of [disputer, auditorIndex])
            await h.rpcStub.suppressTimeoutCheck(index);
        // the auditor's allegation alone decides the dispute
        await h.rpcStub.suppressDisputeKill(disputer);
        const applies =
            await h.rpcStub.recordDisputeFraudProofApplies(auditorIndex);
        let tipIndex = -1;

        // a below-anchor prefix milestone, then the constructed runs with a
        // forged block above the head appended to the last one
        const { dispute } = await postDisputeWithProof(
            h,
            disputer,
            async (constructed) => {
                const prefix: BlockConfirmationStruct[] = [];
                for (let height = 0; height < anchorHeight; height++)
                    prefix.push(
                        (await storedProofBlock(h, disputer, forkId, height))
                            .confirmation
                    );
                const genesisRun = await storedProofBlock(
                    h,
                    disputer,
                    forkId,
                    0
                );
                const lastRun = constructed.milestones.at(-1)!;
                const head = Block.fromBlockConfirmation(lastRun.at(-1)!);
                const latestStateSnapshot = forgedTimestamp(
                    constructed.latestStateSnapshot
                );
                const forged = await craftProofBlock(h, {
                    authorIndex: disputer,
                    forkId,
                    height: head.height + 1,
                    previousBlockHash: head.hash,
                    stateSnapshotHash:
                        StateSnapshot.from(latestStateSnapshot).hash
                });
                tipIndex = lastRun.length;
                return {
                    milestones: [
                        prefix,
                        ...constructed.milestones.slice(0, -1),
                        [
                            ...lastRun,
                            { signedBlock: forged.signedBlock, signatures: [] }
                        ]
                    ],
                    milestoneSnapshots: [
                        genesisRun.snapshot,
                        ...constructed.milestoneSnapshots
                    ],
                    latestStateSnapshot
                };
            }
        );
        expectUnfinalTailStateProof(dispute.input.stateProof);

        await h.event.waitForPeers("onDisputeKilled", [auditorIndex], 1, {
            mode: "atLeast"
        });
        const encoded = await storedDisputeFraudProof(
            h,
            auditorIndex,
            DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
        );
        expect(encoded, "the auditor's block allegation").to.not.equal(
            undefined
        );
        const evidence = Codec.decode(
            encoded!,
            DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
        );
        // the forged block's position in the submitted last milestone
        expect(Number(evidence.blockIndex)).to.equal(tipIndex);
        expect(
            (await applies.applies()).filter((apply) => apply.error === null),
            "the auditor's kill landed"
        ).to.have.length(1);
        const slashed = await h.query.onChainSlashedParticipants(auditorIndex);
        expect(slashed).to.include(h.getPeer(disputer).address);
        expect(slashed).to.not.include(h.getPeer(auditorIndex).address);

        await h.dispute.resolveDisputeWait({
            forkId,
            honestPeerIndices: [auditorIndex]
        });
    });

    it("a lagging mirror replays from the chain's tail start: both auditors allege the same first eligible block, the lagging auditor's kill lands and no honest auditor is slashed", async function () {
        const h = TestSession.getHarness();
        const staged = await stageExitAnchoredForkWithLaggingMirror(h);
        const { disputer, laggingAuditor, auditor, anchorHeight } = staged;
        const proof = await branchingRunBelowAnchor(h, staged);
        // one dispute in the window, decided by the two auditors alone
        await h.dispute.suppressDisputeInitiation([
            disputer,
            laggingAuditor,
            auditor
        ]);
        await h.rpcStub.suppressDisputeKill(disputer);
        // each kill parks once its auditor stored its allegation
        const laggingKills = await h.rpcStub.recordDisputeFraudProofApplies(
            laggingAuditor,
            { hold: true }
        );
        const kills = await h.rpcStub.recordDisputeFraudProofApplies(auditor, {
            hold: true
        });

        await postDisputeWithProof(h, disputer, async () => proof);
        await laggingKills.waitUntilHeld(1);
        await kills.waitUntilHeld(1);

        // the run starts at block 0, so a run index is a height: the replay
        // starts past the anchor, above the forged branch below it
        const allegedIndex = async (peerIndex: number) => {
            const encoded = await storedDisputeFraudProof(
                h,
                peerIndex,
                DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            );
            expect(encoded, `peer ${peerIndex}'s allegation`).to.not.equal(
                undefined
            );
            return Number(
                Codec.decode(
                    encoded!,
                    DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
                ).blockIndex
            );
        };
        expect(proof.branchIndex).to.be.at.most(anchorHeight);
        expect(
            await allegedIndex(laggingAuditor),
            "the lagging auditor alleges the first eligible block"
        ).to.equal(anchorHeight + 1);
        expect(
            await allegedIndex(auditor),
            "both auditors allege the same block"
        ).to.equal(anchorHeight + 1);

        // the lagging auditor's allegation alone kills the dispute
        await laggingKills.release();
        await h.event.waitForPeers("onDisputeKilled", [laggingAuditor], 1, {
            mode: "atLeast"
        });
        expect(
            (await laggingKills.applies()).filter(
                (apply) => apply.error === null
            ),
            "the lagging auditor's kill landed"
        ).to.have.length(1);
        await kills.release();
        await h.event.waitForPeers("onDisputeKilled", [auditor], 1, {
            mode: "atLeast"
        });
        const slashed = await h.query.onChainSlashedParticipants(auditor);
        expect(slashed).to.include(h.getPeer(disputer).address);
        expect(slashed).to.not.include(h.getPeer(laggingAuditor).address);
        expect(slashed).to.not.include(h.getPeer(auditor).address);
    });
});

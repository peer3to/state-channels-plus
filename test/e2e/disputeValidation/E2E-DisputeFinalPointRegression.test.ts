import {
    DisputeFraudProofType,
    toSolidityDisputeFraudProofType
} from "@/types/sol-enums";
import { Codec, hash, Type } from "@/utils";
import { chainAcceptsDisputeProof } from "@test/fixtures/ChainProofVerdict";
import {
    postJoinerBypassDispute,
    readDisputeKill,
    stageSeatedJoinerHistory
} from "@test/fixtures/OmittedInboundJoinerStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

// FIND-DISPUTE-6-E2YJ9X. Alice and Bob post the chain anchor; Charlie joins,
// the honest history consumes his JOIN and is final past it with his
// signature. Alice then posts a dispute whose only hop jumps from the anchor
// above Charlie's final point, signed by Alice and Bob only, with an inbound
// head below Charlie's JOIN: its walk never needs Charlie.

describe("E2E: dispute validation / dispute final point regression", function () {
    it("the colluders' posted-data dispute that hops from the chain anchor above seated Charlie's final point without his JOIN is killed on chain by Charlie's DisputeFinalPointRegression, and only its submitter is slashed", async function () {
        const h = TestSession.getHarness();
        const history = await stageSeatedJoinerHistory(h);
        const alice = h.getPeer(history.aliceIndex);
        const bob = h.getPeer(history.bobIndex);
        const charlie = h.getPeer(history.charlieIndex);
        const joinHash = history.charlieFinal.latestInboundMessageBlockHash;
        expect(
            history.charlieFinal.snapshotData.participants,
            "Charlie is seated in his final history"
        ).to.include(charlie.address);
        expect(
            history.anchor.latestInboundMessageBlockHash,
            "the chain anchor is below Charlie's JOIN"
        ).to.not.equal(joinHash);

        const posted = await postJoinerBypassDispute(h, history);
        expect(posted.dispute.postedAuditingData).to.equal(true);
        expect(
            posted.dispute.input.latestInboundMessageBlockHash,
            "the upload names Charlie's JOIN as the chain inbound head"
        ).to.equal(joinHash);
        expect(posted.hopBlock.height).to.be.greaterThan(
            history.charlieFinal.blockHeight
        );
        expect(
            [...posted.hopBlock.allSignerAddresses],
            "the hop is signed without Charlie"
        ).to.have.members([alice.address, bob.address]);
        expect(
            posted.hopSnapshot.latestInboundMessageBlockHash,
            "the hop's inbound head stays the anchor's"
        ).to.equal(history.anchor.latestInboundMessageBlockHash);
        expect(
            await chainAcceptsDisputeProof(
                h.channelManager,
                posted.dispute,
                posted.auditingData
            ),
            "the chain walks the hop from the anchor without Charlie"
        ).to.equal(true);

        await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
            disputeFraudProofType:
                DisputeFraudProofType.DisputeFinalPointRegression,
            peerIndices: [charlie.index]
        });
        expect(
            await h.control(charlie).query.getDisputeFraudProofTypes().request()
        ).to.deep.equal([
            String(
                toSolidityDisputeFraudProofType(
                    DisputeFraudProofType.DisputeFinalPointRegression
                )
            )
        ]);
        await h.event.waitForPeers("onDisputeKilled", [charlie.index], 1, {
            mode: "atLeast"
        });

        const kill = await readDisputeKill(h, alice.address);
        expect(kill.killer).to.equal(charlie.address);
        expect(kill.appliedProofTypes).to.deep.equal([
            DisputeFraudProofType.DisputeFinalPointRegression
        ]);
        const counter = Codec.decode(
            kill.appliedEncodedProofs[0]!,
            DisputeFraudProofType.DisputeFinalPointRegression
        );
        expect(Number(counter.milestoneIndex)).to.equal(0);
        expect(
            hash(Codec.encode(counter.gSnapshot, Type.StateSnapshot)),
            "G is the hop's snapshot"
        ).to.equal(posted.hopSnapshot.hash);
        const final = await h.channelManager.verifyMilestones.staticCall(
            counter.finalProof
        );
        expect(
            final.finalizedSnapshot.snapshotData.latestInboundMessageBlockHash,
            "F is a final point of Charlie's history, past his JOIN"
        ).to.equal(joinHash);
        await h.assert.dispute.slashedOnChainExactly([alice.address]);
    });
});

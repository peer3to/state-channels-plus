import {
    DisputeFraudProofType,
    toSolidityDisputeFraudProofType
} from "@/types/sol-enums";
import { Codec } from "@/utils";
import { chainAcceptsDisputeProof } from "@test/fixtures/ChainProofVerdict";
import {
    postOmittedInboundJoinerDispute,
    readDisputeKill,
    readPredecessorHoldings,
    stageOmittedInboundJoinerHistory,
    withHopAlsoSignedBy
} from "@test/fixtures/OmittedInboundJoinerStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

// Plan 35 U122/E38/E44. Alice and Bob are participants with a chain anchor;
// Charlie synced as a spectator and joined (his JOIN is on chain, pending).
// Alice and Bob author a private block Charlie never receives, then Alice
// posts a dispute whose only hop re-signs the next private block (Alice and
// Bob only) with a snapshot that consumes Charlie's JOIN but leaves him out.
// Charlie lacks the hop's predecessor block and its application state.

const NOTHING_HELD = {
    block: false,
    blockAtHeight: false,
    snapshot: false,
    state: false
};
const EVERYTHING_HELD = {
    block: true,
    blockAtHeight: true,
    snapshot: true,
    state: true
};

describe("E2E: dispute validation / omitted inbound joiner", function () {
    it("E38, E44: Charlie, pending without the hop's predecessor state, kills the posted-data dispute that consumes his join without him through the invalid-state-proof counter pointed at that hop", async function () {
        const h = TestSession.getHarness();
        const history = await stageOmittedInboundJoinerHistory(h);
        const alice = h.getPeer(history.aliceIndex);
        const charlie = h.getPeer(history.charlieIndex);

        expect(
            await readPredecessorHoldings(h, charlie.index, history),
            "Charlie never received the predecessor"
        ).to.deep.equal(NOTHING_HELD);
        expect(
            await readPredecessorHoldings(h, alice.index, history),
            "the predecessor is real colluder history"
        ).to.deep.equal(EVERYTHING_HELD);
        expect(history.predecessor.height).to.be.greaterThan(
            history.anchorHeight
        );

        const posted = await postOmittedInboundJoinerDispute(h, history);
        expect(posted.dispute.postedAuditingData).to.equal(true);
        expect(
            [...posted.hopBlock.allSignerAddresses],
            "the hop is signed without Charlie"
        ).to.have.members([alice.address, h.getPeer(history.bobIndex).address]);
        expect(
            posted.auditingData.latestStateSnapshot.snapshotData.participants,
            "the hop's snapshot leaves Charlie out"
        ).to.not.include(charlie.address);
        expect(
            posted.outputParticipants,
            "the dispute output treats the join as consumed without Charlie"
        ).to.not.include(charlie.address);
        expect(
            await h.channelManager.getPendingParticipants(h.channelId),
            "Charlie's JOIN is still pending on chain"
        ).to.include(charlie.address);
        expect(
            await chainAcceptsDisputeProof(
                h.channelManager,
                await withHopAlsoSignedBy(h, posted, charlie.index),
                posted.auditingData
            ),
            "with Charlie's signature on the hop the same evidence passes: the consumed-joiner union is the only failure"
        ).to.equal(true);

        await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
            disputeFraudProofType:
                DisputeFraudProofType.DisputeInvalidStateProof,
            peerIndices: [charlie.index]
        });
        expect(
            await h.control(charlie).query.getDisputeFraudProofTypes().request()
        ).to.deep.equal([
            String(
                toSolidityDisputeFraudProofType(
                    DisputeFraudProofType.DisputeInvalidStateProof
                )
            )
        ]);
        await h.event.waitForPeers("onDisputeKilled", [charlie.index], 1, {
            mode: "atLeast"
        });

        const kill = await readDisputeKill(h, alice.address);
        expect(kill.killer).to.equal(charlie.address);
        expect(kill.appliedProofTypes).to.deep.equal([
            DisputeFraudProofType.DisputeInvalidStateProof
        ]);
        // the counter points at the only hop, the one consuming Charlie's join
        const counter = Codec.decode(
            kill.appliedEncodedProofs[0]!,
            DisputeFraudProofType.DisputeInvalidStateProof
        );
        expect(Number(counter.milestoneIndex)).to.equal(0);
        expect(counter.hasBlockIndex).to.equal(false);
        await h.assert.dispute.slashedOnChainExactly([alice.address]);
        expect(
            await readPredecessorHoldings(h, charlie.index, history),
            "the counter needed no predecessor, and the posted data supplied none"
        ).to.deep.equal(NOTHING_HELD);
    });

    it("E38: the same omitted-joiner hop as the second milestone, after the run holding the chain anchor → Charlie's invalid-state-proof counter points at milestone 1", async function () {
        const h = TestSession.getHarness();
        const history = await stageOmittedInboundJoinerHistory(h);
        const alice = h.getPeer(history.aliceIndex);
        const charlie = h.getPeer(history.charlieIndex);

        const posted = await postOmittedInboundJoinerDispute(h, history, {
            anchorRunFirst: true
        });
        expect(posted.dispute.input.stateProof.milestones).to.have.length(2);

        await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
            disputeFraudProofType:
                DisputeFraudProofType.DisputeInvalidStateProof,
            peerIndices: [charlie.index]
        });
        await h.event.waitForPeers("onDisputeKilled", [charlie.index], 1, {
            mode: "atLeast"
        });
        const kill = await readDisputeKill(h, alice.address);
        expect(kill.killer).to.equal(charlie.address);
        expect(kill.appliedProofTypes).to.deep.equal([
            DisputeFraudProofType.DisputeInvalidStateProof
        ]);
        const counter = Codec.decode(
            kill.appliedEncodedProofs[0]!,
            DisputeFraudProofType.DisputeInvalidStateProof
        );
        expect(Number(counter.milestoneIndex)).to.equal(1);
        expect(counter.hasBlockIndex).to.equal(false);
        await h.assert.dispute.slashedOnChainExactly([alice.address]);
    });
});

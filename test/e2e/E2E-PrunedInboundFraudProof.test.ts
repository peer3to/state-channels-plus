import { FraudProofType } from "@/types/sol-enums";
import * as factory from "@test/factory";
import { stagePrunedGenuineInbound } from "@test/fixtures/PrunedInboundStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expectDecodedError } from "@test/test_utils/customErrorAssertions";
import { expect } from "chai";

describe("E2E: Pruned inbound fraud proof", function () {
    it("genuine inbound pruned by a snapshot -> forged-inbound proof against its honest author reverts, nobody slashed, channel advances", async function () {
        const h = TestSession.getHarness();
        const { prunedInbound, snapshotInboundHeight, carrier } =
            await stagePrunedGenuineInbound();
        const submitter = h.getPeer(2);
        const proof = factory.forgedInboundFraudProof(
            carrier.signedBlock,
            carrier.author,
            prunedInbound
        );

        let revertError: unknown;
        try {
            const tx = await h.channelManager
                .connect(submitter.signer)
                .applyFraudProofs([proof], { channelId: h.channelId });
            await tx.wait();
        } catch (error) {
            revertError = error;
        }

        const customError = expectDecodedError(
            revertError,
            "RaceConditionBlockHeightTooOld",
            "a proof at or below the snapshot's inbound head must be refused"
        );
        const [snapshotHeight, forgedHeight] =
            customError.errorDescription.args;
        expect(Number(snapshotHeight)).to.equal(snapshotInboundHeight);
        expect(Number(forgedHeight)).to.equal(
            Number(prunedInbound.blockHeight)
        );
        await h.assert.dispute.slashedOnChainExactly([]);

        await h.transition.advanceState({ count: 1 });
        await h.assert.sync.peersInSyncWait();
    });

    it("fabricated inbound above the pruned head -> honest peers dispute, the forger is slashed", async function () {
        const h = TestSession.getHarness();
        const { forkId } = await stagePrunedGenuineInbound();
        // the forger must hold the next turn -> otherwise the wrong-leader gate fires first
        const maliciousPeerIndex = (await h.query.getNextPeerToWrite()).index;

        await h.byzantine.submitForgedInboundMessageBlock(maliciousPeerIndex);

        await h.assert.dispute.initiatedAndCommitedWait();
        await h.assert.storage.honestPeersStoredFraudProof({
            fraudProofType: FraudProofType.ForgedInboundMessageBlock,
            maliciousPeerIndex
        });
        await h.assert.dispute.slashedOnChain(
            h.getPeer(maliciousPeerIndex).address
        );

        await h.dispute.resolveDisputeWait({ forkId });
        await h.assert.sync.onlyHonestPeersInSync();
    });
});

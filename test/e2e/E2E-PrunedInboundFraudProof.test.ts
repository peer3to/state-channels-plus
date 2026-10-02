import { FraudProofType } from "@/types/sol-enums";
import * as factory from "@test/factory";
import { stagePrunedGenuineInbound } from "@test/fixtures/PrunedInboundStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expectDecodedError } from "@test/test_utils/customErrorAssertions";
import { waitFor } from "@test/utils/waitFor";
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

    // reduce after the prune -> the reduced fork keeps S, so the next top-up links and the old proof stays refused
    it("dispute resolved after a prune -> the reduced fork keeps the snapshot inbound height, the next top-up is adopted, the pruned proof stays refused", async function () {
        const h = TestSession.getHarness();
        const { prunedInbound, snapshotInboundHeight, carrier, forkId } =
            await stagePrunedGenuineInbound();
        const maliciousPeerIndex = (await h.query.getNextPeerToWrite()).index;
        const honest = h.peers.filter((p) => p.index !== maliciousPeerIndex);

        await h.byzantine.submitForgedInboundMessageBlock(maliciousPeerIndex);
        await h.assert.dispute.initiatedAndCommitedWait();
        await h.dispute.resolveDisputeWait({ forkId });
        await h.assert.sync.onlyHonestPeersInSync();

        // adopting the reduced fork carries its genesis inbound height on chain
        await h.transition.advanceState({
            count: 2,
            waitForFinalization: true
        });
        // the fork switch waits for the reduce challenge period -> post once it expired on chain
        await waitFor(() =>
            h.channelManager.isReduceChallengePeriodExpired(h.channelId, forkId)
        );
        await h.transition.postSnapshotWait({ peerIndex: honest[0].index });
        const adopted = await h.channelManager.getStateSnapshot(h.channelId);
        const honestForkId = await h
            .control(honest[0])
            .query.getForkId()
            .request();
        expect(adopted.forkId).to.equal(honestForkId);
        expect(adopted.forkId).to.not.equal(forkId);
        expect(
            Number(adopted.snapshotData.latestInboundMessageBlockHeight)
        ).to.equal(snapshotInboundHeight);

        await h.join.forceInboundJoinWait({
            participant: honest[0].address,
            observePeerIndices: honest.map((p) => p.index)
        });
        await h.transition.advanceState({
            count: 2,
            waitForFinalization: true
        });
        await h.transition.postSnapshotWait({ peerIndex: honest[0].index });
        const snapshot = await h.channelManager.getStateSnapshot(h.channelId);
        expect(
            Number(snapshot.snapshotData.latestInboundMessageBlockHeight)
        ).to.equal(snapshotInboundHeight + 1);
        await h.assert.sync.onlyHonestPeersInSync();

        let revertError: unknown;
        try {
            const tx = await h.channelManager
                .connect(honest[0].signer)
                .applyFraudProofs(
                    [
                        factory.forgedInboundFraudProof(
                            carrier.signedBlock,
                            carrier.author,
                            prunedInbound
                        )
                    ],
                    { channelId: h.channelId }
                );
            await tx.wait();
        } catch (error) {
            revertError = error;
        }
        const customError = expectDecodedError(
            revertError,
            "RaceConditionBlockHeightTooOld",
            "the pruned genuine block stays below the adopted snapshot's inbound head"
        );
        expect(Number(customError.errorDescription.args[0])).to.equal(
            snapshotInboundHeight + 1
        );
    });
});

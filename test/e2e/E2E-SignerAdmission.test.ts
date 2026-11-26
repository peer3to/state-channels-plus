import { BlockOrigin } from "@/storage/QueueStorage";
import {
    blockSnapshotHashAt,
    buildProofView,
    walkAllTiersView
} from "@test/fixtures/ProofOwnerStaging";
import {
    signStoredBlockAs,
    stageJoinAndExitInOneHop
} from "@test/fixtures/SignerAdmissionStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

/**
 * Signer admission across peers: a signature the chain counts for a hop's
 * finality is admitted from gossip and keeps the hop provable on chain.
 */
describe("E2E: Signer admission", function () {
    it("a joiner added and removed in one hop signs the block after its exit → peers admit its gossiped signature without cutting the sender, and the chain's walk from the genesis proves the hop final", async function () {
        const h = TestSession.getHarness();
        const { leaveHeight, joinerIndex } = await stageJoinAndExitInOneHop(h);
        const joiner = h.getPeer(joinerIndex).address;
        const { confirmation, blockHash, signature } = await signStoredBlockAs(
            h,
            0,
            leaveHeight + 1,
            joinerIndex
        );

        h.event.resetEventSpies();
        // peer 1 gossips the joiner's signature to peer 0
        await h.transition.ingestBlockConfirmationWait({
            peerIndex: 0,
            blockConfirmation: {
                signedBlock: confirmation.signedBlock,
                signatures: [...confirmation.signatures, signature]
            },
            ingestOptions: {
                origin: BlockOrigin.NETWORK,
                senderAddress: h.getPeer(1).address
            },
            keepConnection: true,
            processedKeepConnection: true
        });
        // peer 0 re-gossips the grown block; peer 1, whose final point is
        // past the exit, judges it without cutting peer 0
        await h.event.waitForBlockConfirmationProcessed({
            peerIndex: 1,
            blockHash,
            keepConnection: true
        });

        const proof = await buildProofView(h, 0, { finalizedOnly: true });
        const walks = await walkAllTiersView(h, 0, proof.stateProof);
        const genesisWalk = walks.find((walk) => walk.tier === "localDiamond");

        // one hop from the genesis spans the join and the exit
        expect(proof.start.hash).to.equal(proof.genesisHash);
        expect(proof.milestoneHeights.at(-1)![0]).to.equal(leaveHeight + 1);
        expect(proof.milestoneSigners.at(-1)![0]).to.include(joiner);
        // the chain's walk from the genesis needs and accepts that signature
        expect(genesisWalk!.start).to.equal(null);
        expect(genesisWalk!.valid).to.equal(true);
        expect(genesisWalk!.finalized.hash).to.equal(
            await blockSnapshotHashAt(h, 0, leaveHeight + 1)
        );
        expect(
            await h
                .control(h.getPeer(0))
                .query.isBlacklisted(h.getPeer(1).address)
                .request()
        ).to.equal(false);
        expect(
            await h
                .control(h.getPeer(1))
                .query.isBlacklisted(h.getPeer(0).address)
                .request()
        ).to.equal(false);
    });
});

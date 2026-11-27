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
    it("a joiner added and removed in one hop signs the block after its exit → peers admit its relayed signature without cutting the sender, and the chain's milestone walk from the genesis proves the hop final only with that signature", async function () {
        const h = TestSession.getHarness();
        // the exit never lands, so the chain's anchor stays the genesis
        const { leaveHeight, joinerIndex } = await stageJoinAndExitInOneHop(h, {
            exitPost: "suppressed"
        });
        const joiner = h.getPeer(joinerIndex).address;
        const { confirmation, blockHash, signature } = await signStoredBlockAs(
            h,
            0,
            leaveHeight + 1,
            joinerIndex
        );

        h.event.resetEventSpies();
        // peer 0 receives the joiner's signature as a network delivery from
        // peer 1
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
        const genesisWalk = walks.find((walk) => walk.tier === "chain");
        // the same proof without the joiner's signature on the hop's end
        const hopEnd =
            proof.stateProof.milestones.at(-1)!.blockConfirmations[0];
        const hopEndSignatures = hopEnd.signatures.map((hopSignature) =>
            String(hopSignature).toLowerCase()
        );
        expect(hopEndSignatures).to.include(signature.toLowerCase());
        const withoutJoiner = {
            milestones: [
                ...proof.stateProof.milestones.slice(0, -1),
                {
                    blockConfirmations: [
                        {
                            ...hopEnd,
                            signatures: hopEnd.signatures.filter(
                                (_, index) =>
                                    hopEndSignatures[index] !==
                                    signature.toLowerCase()
                            )
                        },
                        ...proof.stateProof.milestones
                            .at(-1)!
                            .blockConfirmations.slice(1)
                    ]
                }
            ]
        };
        const strippedGenesisWalk = (
            await walkAllTiersView(h, 0, withoutJoiner)
        ).find((walk) => walk.tier === "chain");

        // one hop from the genesis spans the join and the exit
        expect(proof.start.hash).to.equal(proof.genesisHash);
        expect(proof.milestoneHeights.at(-1)![0]).to.equal(leaveHeight + 1);
        expect(proof.milestoneSigners.at(-1)![0]).to.include(joiner);
        // the chain's walk from the genesis accepts that signature
        expect(genesisWalk!.start).to.equal(null);
        expect(genesisWalk!.valid).to.equal(true);
        const hopEndSnapshotHash = await blockSnapshotHashAt(
            h,
            0,
            leaveHeight + 1
        );
        expect(genesisWalk!.finalized.hash).to.equal(hopEndSnapshotHash);
        // without the joiner's signature the same walk does not prove the hop
        expect(strippedGenesisWalk!.start).to.equal(null);
        expect(strippedGenesisWalk!.finalized.height).to.be.lessThan(
            leaveHeight + 1
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

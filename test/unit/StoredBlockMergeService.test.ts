import { expect } from "chai";
import { ethers } from "ethers";
import { Codec, Type } from "@/utils";
import { BlockValidationResult } from "@/types";
import { MathTestSession as TestSession } from "@test/harness";

// the merge is driven directly through transition.runStoredBlockMerge, which
// runs tryMergeStoredBlockConfirmation on the host under the peer's live
// block-validation strategy.

// long chainFallbackTime keeps timeout disputes away while a peer's broadcast
// is suppressed to stage a missing signature
const MERGE_TIME_CONFIG = {
    p2pTime: 4,
    agreementTime: 8,
    chainFallbackTime: 30,
    evidenceTime: 6
};

describe("Unit: StoredBlockMergeService", function () {
    it("a block this peer never stored → undefined, nothing persisted", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
        const forkId = h.activeForkId!;

        const bundle = await h
            .control(h.getPeer(0))
            .query.getLatestBlockBundle(forkId)
            .request();
        // same block, nudged timestamp -> different hash the peer never stored
        const signedBlock = Codec.decode(
            bundle!.encodedSignedBlock,
            Type.SignedBlock
        );
        const blockStruct = Codec.decode(
            String(signedBlock.encodedBlock),
            Type.Block
        );
        blockStruct.transaction.header.timestamp =
            BigInt(blockStruct.transaction.header.timestamp) + 1n;
        const unknownConfirmation = {
            signedBlock: {
                encodedBlock: Codec.encode(blockStruct, Type.Block),
                signature: signedBlock.signature
            },
            signatures: [] as string[]
        };

        const r = await h.transition.runStoredBlockMerge({
            peerIndex: 0,
            confirmation: unknownConfirmation
        });
        expect(r.result).to.equal(null);
        expect(r.persistedSignatures).to.equal(null);
    });

    it("an identical stored confirmation → DUPLICATE, signature set untouched", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
        const forkId = h.activeForkId!;

        const bundle = await h
            .control(h.getPeer(0))
            .query.getLatestBlockBundle(forkId)
            .request();
        const confirmation = Codec.decode(
            bundle!.encodedBlockConfirmation,
            Type.BlockConfirmation
        );

        const r = await h.transition.runStoredBlockMerge({
            peerIndex: 0,
            confirmation: {
                signedBlock: confirmation.signedBlock,
                signatures: confirmation.signatures.map(String)
            }
        });
        expect(r.result).to.equal(BlockValidationResult.DUPLICATE);
        expect(r.persistedSignatures).to.have.members(
            bundle!.confirmationSignatures
        );
    });

    it("a genuine new participant signature → BROADCAST and the signature is persisted", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1, { timeConfig: MERGE_TIME_CONFIG });
        const forkId = h.activeForkId!;

        // silence a non-writer so its confirmation never reaches the writer
        const writer = await h.query.getNextPeerToWrite();
        const silenced = h.peers.find((p) => p.index !== writer.index)!;
        const heightBefore = await h
            .control(writer)
            .query.getNextBlockHeight(forkId)
            .request();
        await h.byzantine.stubBroadcast(silenced.index);
        // add() resolves after the writer's own playTransaction commit, so the
        // block is stored on the writer when this returns
        await h.getPeer(writer.index).p2pInstance.p2pContractInstance.add(1);
        const writerBundle = await h
            .control(writer)
            .query.getLatestBlockBundle(forkId)
            .request();
        expect(writerBundle!.height).to.equal(heightBefore);
        // the silenced peer signed its own copy; that signature is the one the
        // writer never saw
        await h.event.waitForBlockConfirmationProcessed({
            peerIndex: silenced.index,
            blockHash: writerBundle!.hash,
            keepConnection: true
        });
        const silencedBundle = await h
            .control(silenced)
            .query.getLatestBlockBundle(forkId)
            .request();
        await h.control(silenced).stub.restoreBroadcast().request();

        expect(writerBundle!.hash).to.equal(silencedBundle!.hash);
        const newSignatures = silencedBundle!.confirmationSignatures.filter(
            (s) => !writerBundle!.confirmationSignatures.includes(s)
        );
        expect(
            newSignatures.length,
            "silenced signature is missing on writer"
        ).to.be.greaterThan(0);

        const r = await h.transition.runStoredBlockMerge({
            peerIndex: writer.index,
            confirmation: {
                signedBlock: Codec.decode(
                    writerBundle!.encodedSignedBlock,
                    Type.SignedBlock
                ),
                signatures: silencedBundle!.confirmationSignatures.map(String)
            }
        });
        expect(r.result).to.equal(BlockValidationResult.BROADCAST);
        expect(r.persistedSignatures).to.include.members(newSignatures);
    });

    it("stray signature only → stripped, post-strip re-check lands DUPLICATE", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
        const forkId = h.activeForkId!;

        const bundle = await h
            .control(h.getPeer(0))
            .query.getLatestBlockBundle(forkId)
            .request();
        const outsider = ethers.Wallet.createRandom();
        const straySignature = await outsider.signMessage(
            ethers.getBytes(bundle!.hash)
        );

        const r = await h.transition.runStoredBlockMerge({
            peerIndex: 0,
            confirmation: {
                signedBlock: Codec.decode(
                    bundle!.encodedSignedBlock,
                    Type.SignedBlock
                ),
                signatures: [...bundle!.confirmationSignatures, straySignature]
            }
        });
        expect(r.result).to.equal(BlockValidationResult.DUPLICATE);
        expect(r.persistedSignatures).to.not.include(straySignature);
    });

    it("stray + a real new signature → stray stripped, the real one merges, BROADCAST", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1, { timeConfig: MERGE_TIME_CONFIG });
        const forkId = h.activeForkId!;

        const writer = await h.query.getNextPeerToWrite();
        const silenced = h.peers.find((p) => p.index !== writer.index)!;
        const heightBefore = await h
            .control(writer)
            .query.getNextBlockHeight(forkId)
            .request();
        await h.byzantine.stubBroadcast(silenced.index);
        await h.getPeer(writer.index).p2pInstance.p2pContractInstance.add(1);
        const writerBundle = await h
            .control(writer)
            .query.getLatestBlockBundle(forkId)
            .request();
        expect(writerBundle!.height).to.equal(heightBefore);
        await h.event.waitForBlockConfirmationProcessed({
            peerIndex: silenced.index,
            blockHash: writerBundle!.hash,
            keepConnection: true
        });
        const silencedBundle = await h
            .control(silenced)
            .query.getLatestBlockBundle(forkId)
            .request();
        await h.control(silenced).stub.restoreBroadcast().request();

        const newSignatures = silencedBundle!.confirmationSignatures.filter(
            (s) => !writerBundle!.confirmationSignatures.includes(s)
        );
        expect(newSignatures.length).to.be.greaterThan(0);
        const outsider = ethers.Wallet.createRandom();
        const straySignature = await outsider.signMessage(
            ethers.getBytes(writerBundle!.hash)
        );

        const r = await h.transition.runStoredBlockMerge({
            peerIndex: writer.index,
            confirmation: {
                signedBlock: Codec.decode(
                    writerBundle!.encodedSignedBlock,
                    Type.SignedBlock
                ),
                signatures: [
                    ...silencedBundle!.confirmationSignatures,
                    straySignature
                ]
            }
        });
        expect(r.result).to.equal(BlockValidationResult.BROADCAST);
        expect(r.persistedSignatures).to.include.members(newSignatures);
        expect(r.persistedSignatures).to.not.include(straySignature);
    });

    it("under DisputeValidationStrategy a genuine new signature → DUPLICATE, not re-gossiped", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1, { timeConfig: MERGE_TIME_CONFIG });
        const forkId = h.activeForkId!;

        // same staging as the live-strategy case: a signature the writer never
        // saw - the only difference is the strategy, so a BROADCAST here would
        // mean dispute replay leaks gossip
        const writer = await h.query.getNextPeerToWrite();
        const silenced = h.peers.find((p) => p.index !== writer.index)!;
        const heightBefore = await h
            .control(writer)
            .query.getNextBlockHeight(forkId)
            .request();
        await h.byzantine.stubBroadcast(silenced.index);
        await h.getPeer(writer.index).p2pInstance.p2pContractInstance.add(1);
        const writerBundle = await h
            .control(writer)
            .query.getLatestBlockBundle(forkId)
            .request();
        expect(writerBundle!.height).to.equal(heightBefore);
        await h.event.waitForBlockConfirmationProcessed({
            peerIndex: silenced.index,
            blockHash: writerBundle!.hash,
            keepConnection: true
        });
        const silencedBundle = await h
            .control(silenced)
            .query.getLatestBlockBundle(forkId)
            .request();
        await h.control(silenced).stub.restoreBroadcast().request();

        const newSignatures = silencedBundle!.confirmationSignatures.filter(
            (s) => !writerBundle!.confirmationSignatures.includes(s)
        );
        expect(newSignatures.length).to.be.greaterThan(0);

        const r = await h.transition.runStoredBlockMerge({
            peerIndex: writer.index,
            confirmation: {
                signedBlock: Codec.decode(
                    writerBundle!.encodedSignedBlock,
                    Type.SignedBlock
                ),
                signatures: silencedBundle!.confirmationSignatures.map(String)
            },
            strategy: "dispute"
        });
        expect(r.result).to.equal(BlockValidationResult.DUPLICATE);
        // the signature still merges - only the re-gossip is withheld
        expect(r.persistedSignatures).to.include.members(newSignatures);
    });
});

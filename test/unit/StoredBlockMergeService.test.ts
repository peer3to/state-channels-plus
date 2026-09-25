import { BlockValidationResult } from "@/types";
import { Codec, Type } from "@/utils";
import {
    signatureReencodings,
    signBlockVariant
} from "@test/fixtures/QueueAdmissionFixture";
import {
    assertStoredCopyQuota,
    assertStoredMalformedNetworkCopy
} from "@test/fixtures/QueueNetworkRetentionFixture";
import { assertSpectatorStoredMerge } from "@test/fixtures/SpectatorSilenceFixture";
import { MathTestSession as TestSession } from "@test/harness";
import { slotAccountIndex } from "@test/harness/core/slotAccounts";
import { expect } from "chai";
import { ethers } from "ethers";

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
    it("a real synced spectator persists late signatures without an outgoing confirmation", async () => {
        await assertSpectatorStoredMerge();
    });

    it("a pending joiner persists late signatures without relaying before participant promotion", async () => {
        await assertSpectatorStoredMerge(true);
    });

    it("each stored copy is bounded before ordinary signature validation", async () => {
        await assertStoredCopyQuota(false);
    });
    it("unrecoverable confirmations are removed while the stored block remains committed", async () => {
        await assertStoredMalformedNetworkCopy();
    });

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

    it("alternate signatures from a signer the block already holds → DUPLICATE, stored signatures unchanged", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
        await h.assert.sync.peersInSyncWait({ waitForFinalization: true });
        const bundle = await h
            .control(h.getPeer(0))
            .query.getLatestBlockBundle(h.activeForkId!)
            .request();
        const held = h.peers.find((peer) =>
            bundle!.confirmationSignerAddresses.includes(peer.address)
        )!;
        const wallet = h.signerFor(slotAccountIndex(held.index));
        const variants = [0, 1, 2].map((variant) =>
            signBlockVariant(wallet, bundle!.hash, variant)
        );

        const r = await h.transition.runStoredBlockMerge({
            peerIndex: 0,
            confirmation: {
                signedBlock: Codec.decode(
                    bundle!.encodedSignedBlock,
                    Type.SignedBlock
                ),
                signatures: variants
            }
        });
        expect(r.result).to.equal(BlockValidationResult.DUPLICATE);
        expect(r.persistedSignatures).to.have.members(
            bundle!.confirmationSignatures
        );
        expect(r.persistedSignatures).to.have.lengthOf(
            bundle!.confirmationSignatures.length
        );
    });

    it("an alternate signature that recovers to the block author → DUPLICATE, not stored", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
        await h.assert.sync.peersInSyncWait({ waitForFinalization: true });
        const bundle = await h
            .control(h.getPeer(0))
            .query.getLatestBlockBundle(h.activeForkId!)
            .request();
        const author = h.peers.find((peer) => peer.address === bundle!.author)!;
        const authorVariant = signBlockVariant(
            h.signerFor(slotAccountIndex(author.index)),
            bundle!.hash,
            0
        );

        const r = await h.transition.runStoredBlockMerge({
            peerIndex: 0,
            confirmation: {
                signedBlock: Codec.decode(
                    bundle!.encodedSignedBlock,
                    Type.SignedBlock
                ),
                signatures: [authorVariant]
            }
        });
        expect(r.result).to.equal(BlockValidationResult.DUPLICATE);
        expect(r.persistedSignatures).to.not.include(authorVariant);
        expect(r.persistedSignatures).to.have.members(
            bundle!.confirmationSignatures
        );
    });

    it("a mixed batch stores only the first signature of the new signer → BROADCAST", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1, { timeConfig: MERGE_TIME_CONFIG });
        const forkId = h.activeForkId!;

        // silence a non-writer so the writer never holds its signature
        const writer = await h.query.getNextPeerToWrite();
        const silenced = h.peers.find((p) => p.index !== writer.index)!;
        await h.byzantine.stubBroadcast(silenced.index);
        await h.getPeer(writer.index).p2pInstance.p2pContractInstance.add(1);
        const writerBundle = await h
            .control(writer)
            .query.getLatestBlockBundle(forkId)
            .request();
        await h.event.waitForBlockConfirmationProcessed({
            peerIndex: silenced.index,
            blockHash: writerBundle!.hash,
            keepConnection: true
        });
        await h.control(silenced).stub.restoreBroadcast().request();
        expect(writerBundle!.confirmationSignerAddresses).to.not.include(
            silenced.address
        );
        const silencedWallet = h.signerFor(slotAccountIndex(silenced.index));
        const newSignerVariants = [0, 1].map((variant) =>
            signBlockVariant(silencedWallet, writerBundle!.hash, variant)
        );
        const authorVariant = signBlockVariant(
            h.signerFor(slotAccountIndex(writer.index)),
            writerBundle!.hash,
            0
        );

        await h.control(writer).stub.observeAdmission().request();
        const r = await h.transition.runStoredBlockMerge({
            peerIndex: writer.index,
            confirmation: {
                signedBlock: Codec.decode(
                    writerBundle!.encodedSignedBlock,
                    Type.SignedBlock
                ),
                // held signatures, an author variant and two variants of
                // the one new signer
                signatures: [
                    ...writerBundle!.confirmationSignatures,
                    authorVariant,
                    ...newSignerVariants
                ]
            }
        });
        const observation = await h
            .control(writer)
            .stub.getAdmissionObservation()
            .request();
        await h.control(writer).stub.restoreAdmissionObservation().request();
        expect(r.result).to.equal(BlockValidationResult.BROADCAST);
        expect(r.persistedSignatures).to.include.members([
            ...writerBundle!.confirmationSignatures,
            newSignerVariants[0]
        ]);
        expect(r.persistedSignatures).to.not.include(newSignerVariants[1]);
        expect(r.persistedSignatures).to.not.include(authorVariant);
        // the relay carries only the new signer's first signature
        expect(observation.broadcastSignatures).to.deep.include([
            newSignerVariants[0]
        ]);
        expect(observation.broadcastSignatures.flat()).to.not.include.members([
            authorVariant,
            newSignerVariants[1]
        ]);
    });

    it("two variants of one outsider signer from two suppliers → both suppliers are disconnected", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
        await h.assert.sync.peersInSyncWait({ waitForFinalization: true });
        const observer = h.getPeer(0);
        const [firstSupplier, secondSupplier] = [h.getPeer(1), h.getPeer(2)];
        const bundle = await h
            .control(observer)
            .query.getLatestBlockBundle(h.activeForkId!)
            .request();
        const outsider = ethers.Wallet.createRandom();
        const outsiderVariants = [0, 1].map((variant) =>
            signBlockVariant(outsider, bundle!.hash, variant)
        );
        const signedBlock = Codec.decode(
            bundle!.encodedSignedBlock,
            Type.SignedBlock
        );

        // One queued entry supplied by both sources: the first supplier gave
        // the first variant, the second supplier only the later one.
        const r = await h.transition.runStoredBlockMerge({
            peerIndex: observer.index,
            confirmation: { signedBlock, signatures: [] },
            networkCopies: [
                {
                    sender: firstSupplier.address,
                    signatures: [outsiderVariants[0]]
                },
                {
                    sender: secondSupplier.address,
                    signatures: [outsiderVariants[1]]
                }
            ]
        });
        expect(r.result).to.equal(BlockValidationResult.DUPLICATE);
        expect(r.persistedSignatures).to.not.include.members(outsiderVariants);
        expect(
            await h
                .control(observer)
                .query.isBlacklisted(firstSupplier.address)
                .request()
        ).to.equal(true);
        expect(
            await h
                .control(observer)
                .query.isBlacklisted(secondSupplier.address)
                .request()
        ).to.equal(true);
    });

    it("re-encoded copies arriving before a signer's genuine signature → only the genuine signature is stored", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1, { timeConfig: MERGE_TIME_CONFIG });
        const forkId = h.activeForkId!;

        // silence a non-writer so the writer never holds its signature
        const writer = await h.query.getNextPeerToWrite();
        const silenced = h.peers.find((p) => p.index !== writer.index)!;
        await h.byzantine.stubBroadcast(silenced.index);
        await h.getPeer(writer.index).p2pInstance.p2pContractInstance.add(1);
        const writerBundle = await h
            .control(writer)
            .query.getLatestBlockBundle(forkId)
            .request();
        await h.event.waitForBlockConfirmationProcessed({
            peerIndex: silenced.index,
            blockHash: writerBundle!.hash,
            keepConnection: true
        });
        await h.control(silenced).stub.restoreBroadcast().request();
        expect(writerBundle!.confirmationSignerAddresses).to.not.include(
            silenced.address
        );
        const genuine = await silenced.signer.signMessage(
            ethers.getBytes(writerBundle!.hash)
        );
        const reencoded = Object.values(signatureReencodings(genuine));

        const r = await h.transition.runStoredBlockMerge({
            peerIndex: writer.index,
            confirmation: {
                signedBlock: Codec.decode(
                    writerBundle!.encodedSignedBlock,
                    Type.SignedBlock
                ),
                signatures: [...reencoded, genuine]
            }
        });
        expect(r.result).to.equal(BlockValidationResult.BROADCAST);
        expect(r.persistedSignatures).to.include(genuine);
        expect(r.persistedSignatures).to.not.include.members(reencoded);
    });

    it("a stored merge of a re-encoded copy disconnects its supplier", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
        await h.assert.sync.peersInSyncWait({ waitForFinalization: true });
        const observer = h.getPeer(0);
        const supplier = h.getPeer(1);
        const bundle = await h
            .control(observer)
            .query.getLatestBlockBundle(h.activeForkId!)
            .request();
        const { v0 } = signatureReencodings(bundle!.confirmationSignatures[0]);

        const r = await h.transition.runStoredBlockMerge({
            peerIndex: observer.index,
            confirmation: {
                signedBlock: Codec.decode(
                    bundle!.encodedSignedBlock,
                    Type.SignedBlock
                ),
                signatures: []
            },
            networkCopies: [{ sender: supplier.address, signatures: [v0] }]
        });
        expect(r.result).to.equal(BlockValidationResult.DUPLICATE);
        expect(r.persistedSignatures).to.have.members(
            bundle!.confirmationSignatures
        );
        expect(
            await h
                .control(observer)
                .query.isBlacklisted(supplier.address)
                .request()
        ).to.equal(true);
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

    it("a committed participant using SpectatingValidationStrategy broadcasts genuine signature growth", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1, { timeConfig: MERGE_TIME_CONFIG });
        const forkId = h.activeForkId!;

        // A committed participant delegates sync-replay growth to live gossip.
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

        await h.control(writer).stub.observeAdmission().request();
        const r = await h.transition.runStoredBlockMerge({
            peerIndex: writer.index,
            confirmation: {
                signedBlock: Codec.decode(
                    writerBundle!.encodedSignedBlock,
                    Type.SignedBlock
                ),
                signatures: silencedBundle!.confirmationSignatures.map(String)
            },
            strategy: "spectating"
        });
        expect(
            (await h.control(writer).stub.getAdmissionObservation().request())
                .broadcasts
        ).to.be.greaterThan(0);
        await h.control(writer).stub.restoreAdmissionObservation().request();
        expect(r.result).to.equal(BlockValidationResult.BROADCAST);
        expect(r.persistedSignatures).to.include.members(newSignatures);
    });

    it("under CalldataCommittedStrategy the event-shaped confirmation (no signatures) → DUPLICATE, the tripwire never fires", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
        const forkId = h.activeForkId!;

        const bundle = await h
            .control(h.getPeer(0))
            .query.getLatestBlockBundle(forkId)
            .request();

        // EventHandler always builds {signedBlock, signatures: []} from a
        // CalldataPosted event, so the merge must exit through
        // noNewSignaturesOnExistingBlock - not the unreachable-tripwire throw
        const r = await h.transition.runStoredBlockMerge({
            peerIndex: 0,
            confirmation: {
                signedBlock: Codec.decode(
                    bundle!.encodedSignedBlock,
                    Type.SignedBlock
                ),
                signatures: []
            },
            strategy: "calldata"
        });
        expect(r.result).to.equal(BlockValidationResult.DUPLICATE);
        expect(r.persistedSignatures).to.have.members(
            bundle!.confirmationSignatures
        );
    });

    it("under CalldataCommittedStrategy a genuine new signature → the unreachable tripwire throws", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1, { timeConfig: MERGE_TIME_CONFIG });
        const forkId = h.activeForkId!;

        // a signature the writer never saw, handed to the merge as if a
        // calldata event carried it - the event shape forbids this, so the
        // strategy's tripwire must fail loudly instead of gossiping
        const writer = await h.query.getNextPeerToWrite();
        const silenced = h.peers.find((p) => p.index !== writer.index)!;
        await h.byzantine.stubBroadcast(silenced.index);
        await h.getPeer(writer.index).p2pInstance.p2pContractInstance.add(1);
        const writerBundle = await h
            .control(writer)
            .query.getLatestBlockBundle(forkId)
            .request();
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
        expect(
            silencedBundle!.confirmationSignatures.filter(
                (s) => !writerBundle!.confirmationSignatures.includes(s)
            ).length
        ).to.be.greaterThan(0);

        let thrown: Error | undefined;
        try {
            await h.transition.runStoredBlockMerge({
                peerIndex: writer.index,
                confirmation: {
                    signedBlock: Codec.decode(
                        writerBundle!.encodedSignedBlock,
                        Type.SignedBlock
                    ),
                    signatures:
                        silencedBundle!.confirmationSignatures.map(String)
                },
                strategy: "calldata"
            });
        } catch (error) {
            thrown = error as Error;
        }
        expect(thrown, "the tripwire should reject the merge").to.not.be
            .undefined;
        expect(String(thrown)).to.contain("goodNewSignaturesOnExistingBlock");
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

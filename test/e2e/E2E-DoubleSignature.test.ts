import { Codec, Type } from "@/utils";
import { signBlockVariant } from "@test/fixtures/QueueAdmissionFixture";
import { reencodeSignature } from "@test/fixtures/SignatureEncodingFixture";
import { MathTestSession as TestSession } from "@test/harness";
import { slotAccountIndex } from "@test/harness/core/slotAccounts";
import { expect } from "chai";
import { ethers } from "ethers";

// Honest signers are deterministic, so a second distinct signature by one key
// over one block hash is a double signature. The receiving node blacklists the
// signer — never the peer that relayed it — and a re-encoding of an honest
// signature is the same signature.

describe("E2E: Double signature", function () {
    it("a participant gossiping a second valid signature for a stored block is blacklisted by the receiver", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
        const observer = h.getPeer(0);
        const signer = h.getPeer(1);
        const block = await h
            .control(observer)
            .query.getLatestBlockBundle(h.activeForkId!)
            .request();
        expect(block, "observer stored no block").to.not.equal(null);
        const wallet = h.signerFor(slotAccountIndex(signer.index));
        const honest = wallet.signMessageSync(ethers.getBytes(block!.hash));
        const second = signBlockVariant(wallet, block!.hash, 0);
        const confirmation = Codec.decode(
            block!.encodedBlockConfirmation,
            Type.BlockConfirmation
        );
        const expectedStatus = await h
            .control(observer)
            .query.getStatus()
            .request();

        await h
            .control(signer)
            .byzantine.sendBlockConfirmation(
                String(
                    Codec.encode(
                        {
                            signedBlock: confirmation.signedBlock,
                            signatures: [honest, second]
                        },
                        Type.BlockConfirmation
                    )
                ),
                observer.address
            )
            .request();

        await h.assert.rpc.peerBlacklistedAndDisconnected({
            observer,
            target: signer,
            expectedStatus
        });
    });

    it("a relayed double signature blacklists only its signer and relayed re-encodings of an honest signature frame nobody", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 1);
        const observer = h.getPeer(0);
        const honestSigner = h.getPeer(1);
        const relayer = h.getPeer(2);
        const doubleSigner = h.getPeer(3);
        const block = await h
            .control(observer)
            .query.getLatestBlockBundle(h.activeForkId!)
            .request();
        expect(block, "observer stored no block").to.not.equal(null);
        const hashBytes = ethers.getBytes(block!.hash);
        const honestWallet = h.signerFor(slotAccountIndex(honestSigner.index));
        const doubleWallet = h.signerFor(slotAccountIndex(doubleSigner.index));
        const honest = honestWallet.signMessageSync(hashBytes);
        const confirmation = Codec.decode(
            block!.encodedBlockConfirmation,
            Type.BlockConfirmation
        );
        const expectedStatus = await h
            .control(observer)
            .query.getStatus()
            .request();

        // The re-encodings come first, so the observer has recovered them by
        // the time the double signature later in the same copy is reported.
        await h
            .control(relayer)
            .byzantine.sendBlockConfirmation(
                String(
                    Codec.encode(
                        {
                            signedBlock: confirmation.signedBlock,
                            signatures: [
                                reencodeSignature(honest, "yParity"),
                                reencodeSignature(honest, "compact"),
                                doubleWallet.signMessageSync(hashBytes),
                                signBlockVariant(doubleWallet, block!.hash, 0)
                            ]
                        },
                        Type.BlockConfirmation
                    )
                ),
                observer.address
            )
            .request();

        await h.assert.rpc.peerBlacklistedAndDisconnected({
            observer,
            target: doubleSigner,
            expectedStatus
        });
        const query = h.control(observer).query;
        expect(
            await query.isBlacklisted(honestSigner.address).request(),
            "re-encoded honest signature blacklisted its signer"
        ).to.equal(false);
        expect(
            await query.isBlacklisted(relayer.address).request(),
            "relaying peer was blacklisted"
        ).to.equal(false);
    });

    it("a node that recovers its own double signature never blacklists itself", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
        const node = h.getPeer(0);
        const other = h.getPeer(1);
        const block = await h
            .control(node)
            .query.getLatestBlockBundle(h.activeForkId!)
            .request();
        expect(block, "node stored no block").to.not.equal(null);
        const hashBytes = ethers.getBytes(block!.hash);
        const ownWallet = h.signerFor(slotAccountIndex(node.index));
        const otherWallet = h.signerFor(slotAccountIndex(other.index));
        const confirmation = Codec.decode(
            block!.encodedBlockConfirmation,
            Type.BlockConfirmation
        );

        // The merge resolves after every signature in the copy was recovered;
        // the other signer's double signature proves detection ran.
        await h.transition.runStoredBlockMerge({
            peerIndex: node.index,
            confirmation: {
                signedBlock: confirmation.signedBlock,
                signatures: [
                    ownWallet.signMessageSync(hashBytes),
                    signBlockVariant(ownWallet, block!.hash, 0),
                    otherWallet.signMessageSync(hashBytes),
                    signBlockVariant(otherWallet, block!.hash, 0)
                ]
            }
        });

        const query = h.control(node).query;
        expect(await query.isBlacklisted(other.address).request()).to.equal(
            true
        );
        expect(await query.isBlacklisted(node.address).request()).to.equal(
            false
        );
    });

    it("ordinary block traffic blacklists no peer", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 3);

        for (const observer of h.peers) {
            const query = h.control(observer).query;
            for (const target of h.peers) {
                expect(
                    await query.isBlacklisted(target.address).request(),
                    `peer ${observer.index} blacklisted peer ${target.index}`
                ).to.equal(false);
            }
        }
    });
});

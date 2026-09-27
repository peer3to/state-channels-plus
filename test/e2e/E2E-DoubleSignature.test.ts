import { latestBlockCopy } from "@test/fixtures/DoubleSignatureFixture";
import { signBlockVariant } from "@test/fixtures/QueueAdmissionFixture";
import { reencodeSignature } from "@test/fixtures/SignatureEncodingFixture";
import { MathTestSession as TestSession } from "@test/harness";
import { slotAccountIndex } from "@test/harness/core/slotAccounts";
import { expect } from "chai";
import { ethers } from "ethers";

// Honest signers are deterministic, so a second distinct signature by one key
// over one block hash is a double signature. The receiving node blacklists the
// signer — never the peer that relayed it, never itself, and never an address
// that is not a channel member — and a re-encoding of an honest signature is
// the same signature.

describe("E2E: Double signature", function () {
    it("a participant gossiping a second valid signature for a stored block is blacklisted by the receiver", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
        const observer = h.getPeer(0);
        const signer = h.getPeer(1);
        const wallet = h.signerFor(slotAccountIndex(signer.index));
        const copy = await latestBlockCopy(observer, (hash) => [
            wallet.signMessageSync(ethers.getBytes(hash)),
            signBlockVariant(wallet, hash, 0)
        ]);
        const expectedStatus = await h
            .control(observer)
            .query.getStatus()
            .request();

        await h
            .control(signer)
            .byzantine.sendBlockConfirmation(
                copy.encodedBlockConfirmation,
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
        const honestWallet = h.signerFor(slotAccountIndex(honestSigner.index));
        const doubleWallet = h.signerFor(slotAccountIndex(doubleSigner.index));
        // The re-encodings come first, so the observer has recovered them by
        // the time the double signature later in the same copy is reported.
        const copy = await latestBlockCopy(observer, (hash) => {
            const honest = honestWallet.signMessageSync(ethers.getBytes(hash));
            return [
                reencodeSignature(honest, "yParity"),
                reencodeSignature(honest, "compact"),
                doubleWallet.signMessageSync(ethers.getBytes(hash)),
                signBlockVariant(doubleWallet, hash, 0)
            ];
        });
        const expectedStatus = await h
            .control(observer)
            .query.getStatus()
            .request();

        await h
            .control(relayer)
            .byzantine.sendBlockConfirmation(
                copy.encodedBlockConfirmation,
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
        const ownWallet = h.signerFor(slotAccountIndex(node.index));
        const otherWallet = h.signerFor(slotAccountIndex(other.index));
        const copy = await latestBlockCopy(node, (hash) => [
            ownWallet.signMessageSync(ethers.getBytes(hash)),
            signBlockVariant(ownWallet, hash, 0),
            otherWallet.signMessageSync(ethers.getBytes(hash)),
            signBlockVariant(otherWallet, hash, 0)
        ]);

        // The merge resolves after every signature in the copy was recovered;
        // the other signer's double signature proves detection ran.
        await h.transition.runStoredBlockMerge({
            peerIndex: node.index,
            confirmation: {
                signedBlock: copy.signedBlock,
                signatures: copy.signatures
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

    it("a double signature by a key outside the channel blacklists nobody while a member's still blacklists the member", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
        const node = h.getPeer(0);
        const member = h.getPeer(1);
        const memberWallet = h.signerFor(slotAccountIndex(member.index));
        const throwaway = ethers.Wallet.createRandom();
        const encodedMessage = ethers.hexlify(ethers.randomBytes(64));
        const digest = ethers.keccak256(encodedMessage);
        const digestBytes = ethers.getBytes(digest);

        // Recovery returns after every signature was recovered; the member's
        // double signature proves detection ran for this call.
        const recovered = await h
            .control(node)
            .byzantine.recoverSignatures(encodedMessage, [
                throwaway.signMessageSync(digestBytes),
                signBlockVariant(throwaway, digest, 0),
                memberWallet.signMessageSync(digestBytes),
                signBlockVariant(memberWallet, digest, 0)
            ])
            .request();

        expect(recovered).to.deep.equal([
            throwaway.address,
            throwaway.address,
            member.address,
            member.address
        ]);
        const query = h.control(node).query;
        expect(await query.isBlacklisted(throwaway.address).request()).to.equal(
            false
        );
        expect(await query.isBlacklisted(member.address).request()).to.equal(
            true
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

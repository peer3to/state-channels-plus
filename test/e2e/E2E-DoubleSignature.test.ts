import { Codec, Type } from "@/utils";
import { SignatureUtils } from "@/utils/SignatureUtils";
import * as factory from "@test/factory";
import {
    encodeJoinRequest,
    latestBlockCopy,
    sendJoinSignatureRequest
} from "@test/fixtures/DoubleSignatureFixture";
import { signBlockVariant } from "@test/fixtures/QueueAdmissionFixture";
import { stageQueueSlash } from "@test/fixtures/QueueSlashFixture";
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
        await h.control(observer).stub.observeDoubleSignatureLogs().request();

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
        // The blacklisting log keeps the full evidence: the digest and the
        // whole conflicting signature, which recovers to the blacklisted key.
        const warnings = (
            await h.control(observer).stub.getDoubleSignatureLogs().request()
        ).filter((entry) => entry.level === "warn");
        expect(warnings).to.have.length(1);
        const evidence = warnings[0].metadata;
        expect(evidence.message).to.equal(copy.hash);
        expect(evidence.secondSignature).to.equal(copy.signatures[1]);
        expect(
            ethers.verifyMessage(
                ethers.getBytes(evidence.message),
                evidence.secondSignature
            )
        ).to.equal(signer.address);
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

        await h.control(node).stub.observeDoubleSignatureLogs().request();

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
        const errors = (
            await h.control(node).stub.getDoubleSignatureLogs().request()
        ).filter((entry) => entry.level === "error");
        expect(errors).to.have.length(1);
        expect(errors[0].metadata.signer).to.equal(node.address);
    });

    it("a throwaway key's twice-signed join request blacklists neither the key nor its relayers while a member's double signature blacklists the member", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 1);
        const node = h.getPeer(0);
        const relayers = [h.getPeer(1), h.getPeer(2)];
        const member = h.getPeer(3);
        const memberWallet = h.signerFor(slotAccountIndex(member.index));
        const throwaway = ethers.Wallet.createRandom();
        const join = factory.joinChannel({
            channelId: h.channelId,
            participant: throwaway.address
        });
        const { encoded, signature } = await SignatureUtils.signJoinChannel(
            join,
            throwaway
        );
        const expectedStatus = await h
            .control(node)
            .query.getStatus()
            .request();
        await h.control(node).stub.observeDoubleSignatureLogs().request();

        // Each relayer carries one of the key's two signatures; the receiver
        // recovers the signer before it rejects the foreign participant.
        const rejections = [
            await sendJoinSignatureRequest(
                relayers[0],
                node.address,
                await encodeJoinRequest(join, String(signature))
            ),
            await sendJoinSignatureRequest(
                relayers[1],
                node.address,
                await encodeJoinRequest(
                    join,
                    signBlockVariant(throwaway, ethers.keccak256(encoded), 0)
                )
            )
        ];
        expect(rejections).to.deep.equal([
            "requestJoinSignature: invalid participant signature",
            "requestJoinSignature: invalid participant signature"
        ]);
        const copy = await latestBlockCopy(node, (hash) => [
            memberWallet.signMessageSync(ethers.getBytes(hash)),
            signBlockVariant(memberWallet, hash, 0)
        ]);
        await h
            .control(member)
            .byzantine.sendBlockConfirmation(
                copy.encodedBlockConfirmation,
                node.address
            )
            .request();

        await h.assert.rpc.peerBlacklistedAndDisconnected({
            observer: node,
            target: member,
            expectedStatus
        });
        const ignored = (
            await h.control(node).stub.getDoubleSignatureLogs().request()
        ).filter((entry) => entry.level === "debug");
        expect(ignored.map((entry) => entry.metadata.signer)).to.deep.equal([
            throwaway.address
        ]);
        expect(ignored[0].metadata.eligibility).to.equal("ABSENT");
        const query = h.control(node).query;
        expect(await query.isBlacklisted(throwaway.address).request()).to.equal(
            false
        );
        for (const relayer of relayers)
            expect(
                await query.isBlacklisted(relayer.address).request(),
                `relayer ${relayer.index} was blacklisted`
            ).to.equal(false);
    });

    it("a slashed identity's double signature is ignored while a member's double signature in the same copy blacklists the member", async () => {
        const { h, observer, spammer, killer, block } =
            await stageQueueSlash(false);
        // The slash itself blacklists the spammer; clear that verdict so only
        // the double-signature path could set it again.
        await h
            .control(observer)
            .network.unblacklistPeerByAddress(spammer.address)
            .request();
        await h.control(observer).stub.observeDoubleSignatureLogs().request();
        const spammerWallet = h.signerFor(slotAccountIndex(spammer.index));
        const killerWallet = h.signerFor(slotAccountIndex(killer.index));
        const { signedBlock } = Codec.decode(
            block.encodedBlockConfirmation,
            Type.BlockConfirmation
        );

        await h.transition.runStoredBlockMerge({
            peerIndex: observer.index,
            confirmation: {
                signedBlock,
                signatures: [
                    spammerWallet.signMessageSync(ethers.getBytes(block.hash)),
                    signBlockVariant(spammerWallet, block.hash, 0),
                    killerWallet.signMessageSync(ethers.getBytes(block.hash)),
                    signBlockVariant(killerWallet, block.hash, 0)
                ]
            }
        });

        const query = h.control(observer).query;
        expect(await query.isBlacklisted(killer.address).request()).to.equal(
            true
        );
        expect(await query.isBlacklisted(spammer.address).request()).to.equal(
            false
        );
        const ignored = (
            await h.control(observer).stub.getDoubleSignatureLogs().request()
        ).filter((entry) => entry.level === "debug");
        expect(
            ignored.map((entry) => [
                entry.metadata.signer,
                entry.metadata.eligibility
            ])
        ).to.deep.equal([[spammer.address, "SLASHED"]]);
    });

    it("a failing blacklist write is logged once and never fails the recovery that found the double signature", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
        const node = h.getPeer(0);
        const member = h.getPeer(1);
        const memberWallet = h.signerFor(slotAccountIndex(member.index));
        const copy = await latestBlockCopy(node, (hash) => [
            memberWallet.signMessageSync(ethers.getBytes(hash)),
            signBlockVariant(memberWallet, hash, 0)
        ]);
        const stub = h.control(node).stub;
        await stub.observeDoubleSignatureLogs().request();
        await stub.stubBlacklistWriteFailure().request();
        try {
            const merge = await h.transition.runStoredBlockMerge({
                peerIndex: node.index,
                confirmation: {
                    signedBlock: copy.signedBlock,
                    signatures: copy.signatures
                }
            });

            // The merge only persists the second signature after recovering
            // it to the member's address.
            expect(merge.persistedSignatures).to.include(copy.signatures[1]);
            const errors = (await stub.getDoubleSignatureLogs().request())
                .filter((entry) => entry.level === "error")
                .map((entry) => entry.message);
            expect(errors).to.deep.equal([
                "Failed to handle a double signature"
            ]);
            expect(
                await h
                    .control(node)
                    .query.isBlacklisted(member.address)
                    .request()
            ).to.equal(false);
        } finally {
            await stub.restoreBlacklistWriteFailure().request();
        }
    });

    it("a manager whose disposal has started ignores a member's double signature and disposal removes exactly its listener", async () => {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
        const node = h.getPeer(0);
        const member = h.getPeer(1);
        const memberWallet = h.signerFor(slotAccountIndex(member.index));
        const copy = await latestBlockCopy(node, (hash) => [
            memberWallet.signMessageSync(ethers.getBytes(hash)),
            signBlockVariant(memberWallet, hash, 0)
        ]);

        const result = await h
            .control(node)
            .byzantine.recoverDuringDisposal(
                String(copy.signedBlock.encodedBlock),
                copy.signatures
            )
            .request();

        expect(result.recovered).to.deep.equal([
            member.address,
            member.address
        ]);
        expect(result.blacklisted).to.deep.equal([false, false]);
        expect(result.removedListeners).to.equal(1);
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

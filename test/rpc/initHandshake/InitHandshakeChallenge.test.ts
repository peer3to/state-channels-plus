import { expect } from "chai";
import { ethers } from "ethers";

import InitHandshakeService from "@/rpc/services/initHandshake/InitHandshakeService";

/**
 * Regression: the init-handshake response endpoint must not be usable as a
 * signing oracle. Blocks/protocol messages are EIP-191 signatures over a raw
 * 32-byte keccak hash (see SignatureUtils / Block.hash). Before the fix the
 * responder signed the bare challenge hash, so a peer could set
 * challengeHash = keccak256(encodedBlock) and get back a valid block signature.
 * Domain-separating the signed message closes that collision.
 */
describe("InitHandshake challenge domain separation", function () {
    const wallet = ethers.Wallet.createRandom();

    it("round-trips: a domain-separated handshake signature recovers the signer", async function () {
        const challengeHash = ethers.keccak256(ethers.randomBytes(32));
        const message =
            InitHandshakeService.buildHandshakeChallengeMessage(challengeHash);

        const signature = await wallet.signMessage(message);

        expect(ethers.verifyMessage(message, signature)).to.equal(
            wallet.address
        );
    });

    it("does not collide with block signing: the handshake signature is not valid over the raw challenge hash", async function () {
        // Attack: the peer sets the challenge to a real block hash, hoping the
        // returned handshake signature doubles as a valid block signature.
        const encodedBlock = ethers.hexlify(ethers.randomBytes(128));
        const blockHash = ethers.keccak256(encodedBlock);

        const message =
            InitHandshakeService.buildHandshakeChallengeMessage(blockHash);
        const handshakeSignature = await wallet.signMessage(message);

        // Block verification recovers from the raw 32-byte hash. The
        // domain-separated handshake signature must NOT recover the signer here.
        const recoveredAsBlock = ethers.verifyMessage(
            ethers.getBytes(blockHash),
            handshakeSignature
        );
        expect(recoveredAsBlock).to.not.equal(wallet.address);
    });

    it("derives an identical message regardless of challenge-hash casing", function () {
        const lower = "0x" + "ab".repeat(32);
        const upper = "0x" + "AB".repeat(32);
        expect(
            InitHandshakeService.buildHandshakeChallengeMessage(lower)
        ).to.equal(InitHandshakeService.buildHandshakeChallengeMessage(upper));
    });
});

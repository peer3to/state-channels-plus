import { expect } from "chai";
import { describe, it, beforeEach } from "mocha";
import { ethers } from "hardhat";
import {
    recoverSigner,
    __resetSignerRecoveryCache,
    __signerRecoveryCacheSize
} from "@/cache";
import { config } from "@/utils/config";
import { Signature } from "@/types/types";

describe("SignerRecoveryCache", () => {
    beforeEach(() => __resetSignerRecoveryCache());

    async function signed() {
        const wallet = ethers.Wallet.createRandom();
        const message = ethers.randomBytes(32);
        const signature = (await wallet.signMessage(message)) as Signature;
        return { wallet, message, signature };
    }

    it("recovers the correct signer (matches verifyMessage)", async () => {
        const { wallet, message, signature } = await signed();
        expect(recoverSigner(message, signature)).to.equal(wallet.address);
        expect(recoverSigner(message, signature)).to.equal(
            ethers.verifyMessage(message, signature)
        );
    });

    it("memoizes by (message, signature) — repeats add no entries", async () => {
        const { message, signature } = await signed();
        await recoverSigner(message, signature);
        await recoverSigner(message, signature);
        await recoverSigner(message, signature);
        expect(__signerRecoveryCacheSize()).to.equal(1);

        const other = await signed();
        await recoverSigner(other.message, other.signature);
        expect(__signerRecoveryCacheSize()).to.equal(2);
    });

    it("keys on the message too — same signer, different message, distinct entries", async () => {
        const wallet = ethers.Wallet.createRandom();
        const m1 = ethers.randomBytes(32);
        const m2 = ethers.randomBytes(32);
        const s1 = (await wallet.signMessage(m1)) as Signature;
        const s2 = (await wallet.signMessage(m2)) as Signature;
        expect(recoverSigner(m1, s1)).to.equal(wallet.address);
        expect(recoverSigner(m2, s2)).to.equal(wallet.address);
        expect(__signerRecoveryCacheSize()).to.equal(2);
    });

    it("bounds size and evicts oldest past SIGNER_RECOVERY_CACHE_MAX", async () => {
        const prev = config.SIGNER_RECOVERY_CACHE_MAX;
        config.SIGNER_RECOVERY_CACHE_MAX = 3;
        try {
            const entries = [];
            for (let i = 0; i < 5; i++) entries.push(await signed());
            for (const e of entries)
                await recoverSigner(e.message, e.signature);
            expect(__signerRecoveryCacheSize()).to.equal(3);
            // oldest two evicted; newest three still resolve from cache correctly
            for (const e of entries.slice(2))
                expect(recoverSigner(e.message, e.signature)).to.equal(
                    e.wallet.address
                );
        } finally {
            config.SIGNER_RECOVERY_CACHE_MAX = prev;
        }
    });
});

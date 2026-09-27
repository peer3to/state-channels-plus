import {
    DoubleSignatureReport,
    onDoubleSignature,
    recoverSigner,
    __canonicalSignatureCacheSize,
    __resetSignerRecoveryCache,
    __signerRecoveryCacheSize
} from "@/cache";
import { Signature } from "@/types/types";
import { config } from "@/utils/config";
import { signBlockVariant } from "@test/fixtures/QueueAdmissionFixture";
import { reencodeSignature } from "@test/fixtures/SignatureEncodingFixture";
import { expect } from "chai";
import { ethers } from "hardhat";
import { describe, it, beforeEach } from "mocha";

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

    describe("double-signature detection", () => {
        // Records every report the cache publishes until `stop` is called.
        function listen() {
            const reports: DoubleSignatureReport[] = [];
            const stop = onDoubleSignature((report) => reports.push(report));
            return { reports, stop };
        }

        // An honest (RFC 6979) signature plus a valid second signature by the
        // same key on the same message, made with a different nonce.
        async function doubleSigned() {
            const { wallet, message, signature } = await signed();
            const second = signBlockVariant(
                wallet,
                ethers.hexlify(message),
                0
            ) as Signature;
            return { wallet, message, signature, second };
        }

        it("recovering the same signature twice reports nothing", async () => {
            const { message, signature } = await signed();
            const { reports, stop } = listen();
            try {
                recoverSigner(message, signature);
                recoverSigner(message, signature);
                expect(reports).to.have.length(0);
            } finally {
                stop();
            }
        });

        it("a second nonce signature by one signer on one message reports that signer", async () => {
            const { wallet, message, signature, second } =
                await doubleSigned();
            expect(second).to.not.equal(signature);
            const { reports, stop } = listen();
            try {
                recoverSigner(message, signature);
                expect(recoverSigner(message, second)).to.equal(
                    wallet.address
                );
                expect(reports).to.deep.equal([
                    {
                        signer: wallet.address,
                        message: ethers.hexlify(message),
                        firstSignature: signature,
                        secondSignature: second
                    }
                ]);
            } finally {
                stop();
            }
        });

        it("a v 0/1 re-encoding of a recovered signature reports nothing", async () => {
            const { wallet, message, signature } = await signed();
            const reencoded = reencodeSignature(signature, "yParity");
            expect(reencoded).to.not.equal(signature);
            const { reports, stop } = listen();
            try {
                recoverSigner(message, signature);
                expect(recoverSigner(message, reencoded)).to.equal(
                    wallet.address
                );
                expect(reports).to.have.length(0);
            } finally {
                stop();
            }
        });

        it("a v 35/36 re-encoding of a recovered signature reports nothing", async () => {
            const { wallet, message, signature } = await signed();
            const reencoded = reencodeSignature(signature, "eip155");
            expect(reencoded).to.not.equal(signature);
            const { reports, stop } = listen();
            try {
                recoverSigner(message, signature);
                expect(recoverSigner(message, reencoded)).to.equal(
                    wallet.address
                );
                expect(reports).to.have.length(0);
            } finally {
                stop();
            }
        });

        it("a 64-byte compact re-encoding of a recovered signature reports nothing", async () => {
            const { wallet, message, signature } = await signed();
            const reencoded = reencodeSignature(signature, "compact");
            expect(ethers.dataLength(reencoded)).to.equal(64);
            const { reports, stop } = listen();
            try {
                recoverSigner(message, signature);
                expect(recoverSigner(message, reencoded)).to.equal(
                    wallet.address
                );
                expect(reports).to.have.length(0);
            } finally {
                stop();
            }
        });

        it("the 65-byte signature after its compact re-encoding reports nothing", async () => {
            const { message, signature } = await signed();
            const { reports, stop } = listen();
            try {
                recoverSigner(message, reencodeSignature(signature, "compact"));
                recoverSigner(message, signature);
                expect(reports).to.have.length(0);
            } finally {
                stop();
            }
        });

        it("one signer's signatures on different messages report nothing", async () => {
            const wallet = ethers.Wallet.createRandom();
            const m1 = ethers.randomBytes(32);
            const m2 = ethers.randomBytes(32);
            const { reports, stop } = listen();
            try {
                recoverSigner(m1, (await wallet.signMessage(m1)) as Signature);
                recoverSigner(m2, (await wallet.signMessage(m2)) as Signature);
                expect(reports).to.have.length(0);
            } finally {
                stop();
            }
        });

        it("two signers' signatures on one message report nothing", async () => {
            const message = ethers.randomBytes(32);
            const a = ethers.Wallet.createRandom();
            const b = ethers.Wallet.createRandom();
            const { reports, stop } = listen();
            try {
                recoverSigner(
                    message,
                    (await a.signMessage(message)) as Signature
                );
                recoverSigner(
                    message,
                    (await b.signMessage(message)) as Signature
                );
                expect(reports).to.have.length(0);
            } finally {
                stop();
            }
        });

        it("the canonical-signature memo is bounded by SIGNER_RECOVERY_CACHE_MAX", async () => {
            const prev = config.SIGNER_RECOVERY_CACHE_MAX;
            config.SIGNER_RECOVERY_CACHE_MAX = 3;
            try {
                for (let i = 0; i < 5; i++) {
                    const e = await signed();
                    recoverSigner(e.message, e.signature);
                }
                expect(__canonicalSignatureCacheSize()).to.equal(3);
            } finally {
                config.SIGNER_RECOVERY_CACHE_MAX = prev;
            }
        });

        it("a conflict with an evicted signer entry goes unreported while a retained one is reported", async () => {
            const prev = config.SIGNER_RECOVERY_CACHE_MAX;
            config.SIGNER_RECOVERY_CACHE_MAX = 3;
            const { reports, stop } = listen();
            try {
                const entries = [];
                for (let i = 0; i < 4; i++) entries.push(await doubleSigned());
                for (const e of entries) recoverSigner(e.message, e.signature);
                // entry 0 is the oldest and was evicted by entry 3
                recoverSigner(entries[0].message, entries[0].second);
                expect(reports).to.have.length(0);
                recoverSigner(entries[3].message, entries[3].second);
                expect(reports.map((r) => r.signer)).to.deep.equal([
                    entries[3].wallet.address
                ]);
            } finally {
                stop();
                config.SIGNER_RECOVERY_CACHE_MAX = prev;
            }
        });

        it("every registered listener hears a report", async () => {
            const { wallet, message, signature, second } =
                await doubleSigned();
            const first = listen();
            const other = listen();
            try {
                recoverSigner(message, signature);
                recoverSigner(message, second);
                expect(first.reports.map((r) => r.signer)).to.deep.equal([
                    wallet.address
                ]);
                expect(other.reports.map((r) => r.signer)).to.deep.equal([
                    wallet.address
                ]);
            } finally {
                first.stop();
                other.stop();
            }
        });

        it("a removed listener hears no later report", async () => {
            const { wallet, message, signature, second } =
                await doubleSigned();
            const removed = listen();
            const kept = listen();
            try {
                removed.stop();
                recoverSigner(message, signature);
                recoverSigner(message, second);
                expect(removed.reports).to.have.length(0);
                expect(kept.reports.map((r) => r.signer)).to.deep.equal([
                    wallet.address
                ]);
            } finally {
                kept.stop();
            }
        });
    });
});

import {
    isContractAcceptedSignature,
    recoverSigner,
    __resetSignerRecoveryCache,
    __signerRecoveryCacheSize
} from "@/cache";
import { Address, Signature } from "@/types/types";
import { config } from "@/utils/config";
import {
    recordSignerRecoveries,
    signedMessage
} from "@test/fixtures/RecoveryCacheFixture";
import {
    contractRejectedEncodings,
    signedDigestEncodings
} from "@test/fixtures/SignatureEncodingFixture";
import { UtilityFacet, UtilityFacet__factory } from "@typechain-types";
import { expect } from "chai";
import { ethers } from "hardhat";
import { describe, it, beforeEach } from "mocha";

describe("SignerRecoveryCache", () => {
    beforeEach(() => __resetSignerRecoveryCache());

    it("recovers the correct signer (matches verifyMessage)", async () => {
        const { wallet, message, signature } = await signedMessage();
        expect(recoverSigner(message, signature)).to.equal(wallet.address);
        expect(recoverSigner(message, signature)).to.equal(
            ethers.verifyMessage(message, signature)
        );
    });

    it("memoizes by (message, signature) — repeats add no entries", async () => {
        const { message, signature } = await signedMessage();
        await recoverSigner(message, signature);
        await recoverSigner(message, signature);
        await recoverSigner(message, signature);
        expect(__signerRecoveryCacheSize()).to.equal(1);

        const other = await signedMessage();
        await recoverSigner(other.message, other.signature);
        expect(__signerRecoveryCacheSize()).to.equal(2);
    });

    it("keys on the message — one signature over two messages recovers each message's own signer", async () => {
        const { wallet, message, signature } = await signedMessage();
        const other = ethers.randomBytes(32);
        // the uncached oracle: over another message the same signature names
        // another key
        const signer = ethers.verifyMessage(message, signature);
        const otherSigner = ethers.verifyMessage(other, signature);
        expect(signer).to.equal(wallet.address);
        expect(otherSigner).to.not.equal(signer);
        const observed = recordSignerRecoveries();
        try {
            for (let i = 0; i < 2; i++) {
                expect(recoverSigner(message, signature as Signature)).to.equal(
                    signer
                );
                expect(recoverSigner(other, signature as Signature)).to.equal(
                    otherSigner
                );
            }
            expect(__signerRecoveryCacheSize()).to.equal(2);
            // one real recovery per message; the repeats were hits
            expect(observed.recoveries).to.deep.equal([
                ethers.hashMessage(message),
                ethers.hashMessage(other)
            ]);
        } finally {
            observed.restore();
        }
    });

    it("keys on the signature — one message signed by two signers recovers each signer", async () => {
        const first = await signedMessage();
        const second = await signedMessage(first.message);
        // the uncached oracle
        const firstSigner = ethers.verifyMessage(first.message, first.signature);
        const secondSigner = ethers.verifyMessage(
            second.message,
            second.signature
        );
        expect(firstSigner).to.equal(first.wallet.address);
        expect(secondSigner).to.equal(second.wallet.address);
        const observed = recordSignerRecoveries();
        try {
            for (let i = 0; i < 2; i++) {
                expect(
                    recoverSigner(first.message, first.signature as Signature)
                ).to.equal(firstSigner);
                expect(
                    recoverSigner(second.message, second.signature as Signature)
                ).to.equal(secondSigner);
            }
            expect(__signerRecoveryCacheSize()).to.equal(2);
            // one real recovery per signature; the repeats were hits
            expect(observed.recoveries).to.deep.equal([
                ethers.hashMessage(first.message),
                ethers.hashMessage(first.message)
            ]);
        } finally {
            observed.restore();
        }
    });

    it("evicts the oldest entry first at SIGNER_RECOVERY_CACHE_MAX and recomputes it correctly", async () => {
        const [a, b, c, d] = await Promise.all(
            [0, 1, 2, 3].map(() => signedMessage())
        );
        const digest = (entry: { message: Uint8Array }) =>
            ethers.hashMessage(entry.message);
        const prev = config.SIGNER_RECOVERY_CACHE_MAX;
        config.SIGNER_RECOVERY_CACHE_MAX = 3;
        const observed = recordSignerRecoveries();
        try {
            for (const e of [a, b, c])
                expect(recoverSigner(e.message, e.signature)).to.equal(
                    e.wallet.address
                );
            expect(__signerRecoveryCacheSize()).to.equal(3);
            // a hit does not refresh a's position: eviction is by insertion
            expect(recoverSigner(a.message, a.signature)).to.equal(
                a.wallet.address
            );
            expect(observed.recoveries).to.deep.equal([a, b, c].map(digest));

            // evicts a
            expect(recoverSigner(d.message, d.signature)).to.equal(
                d.wallet.address
            );
            expect(recoverSigner(b.message, b.signature)).to.equal(
                b.wallet.address
            ); // still cached
            // evicts b
            expect(recoverSigner(a.message, a.signature)).to.equal(
                a.wallet.address
            );
            expect(recoverSigner(c.message, c.signature)).to.equal(
                c.wallet.address
            ); // still cached
            expect(observed.recoveries).to.deep.equal(
                [a, b, c, d, a].map(digest)
            );
            expect(__signerRecoveryCacheSize()).to.equal(3);
        } finally {
            observed.restore();
            config.SIGNER_RECOVERY_CACHE_MAX = prev;
        }
    });

    it("every contract-rejected encoding throws before the memo and leaves it unchanged", async () => {
        const { wallet, message, signature } = await signedMessage();
        const rejected = contractRejectedEncodings(signature);
        const observed = recordSignerRecoveries();
        try {
            expect(recoverSigner(message, signature)).to.equal(wallet.address);
            expect(__signerRecoveryCacheSize()).to.equal(1);
            for (const [name, encoding] of Object.entries(rejected)) {
                expect(
                    () => recoverSigner(message, encoding as Signature),
                    name
                ).to.throw("signature is not accepted by the contracts");
                expect(__signerRecoveryCacheSize(), name).to.equal(1);
            }
            // only the accepted signature was ever recovered
            expect(observed.recoveries).to.deep.equal([
                ethers.hashMessage(message)
            ]);
            expect(Object.keys(rejected).length).to.equal(10);
        } finally {
            observed.restore();
        }
    });

    describe("contract acceptance parity", () => {
        let utilityFacet: UtilityFacet;

        before(async () => {
            const [deployer] = await ethers.getSigners();
            utilityFacet = await new UtilityFacet__factory(deployer).deploy();
        });

        it("accepts exactly the encodings the contracts accept, recovering the same signer", async () => {
            const { wallet, encodedData, digest, cases } =
                await signedDigestEncodings();
            const verdicts: Record<string, string> = {};
            for (const [name, signature] of Object.entries(cases)) {
                const [onChainSigner, onChainValid] =
                    await utilityFacet.retrieveSignerAddress(
                        encodedData,
                        signature
                    );
                let localSigner: Address | undefined;
                try {
                    localSigner = recoverSigner(digest, signature as Signature);
                } catch {
                    localSigner = undefined;
                }
                expect(
                    isContractAcceptedSignature(signature as Signature),
                    name
                ).to.equal(onChainValid);
                expect(localSigner, name).to.equal(
                    onChainValid ? onChainSigner : undefined
                );
                verdicts[name] = onChainValid ? "accepted" : "rejected";
            }
            expect(verdicts).to.deep.equal({
                ordinary: "accepted",
                "compact 64-byte": "rejected",
                "v of 0/1": "rejected",
                "EIP-155 v": "rejected",
                "high s": "rejected",
                "zero r": "rejected",
                "zero s": "rejected",
                "r at the group order": "rejected",
                "66 bytes": "rejected",
                "63 bytes": "rejected",
                empty: "rejected"
            });
            expect(recoverSigner(digest, cases.ordinary as Signature)).to.equal(
                wallet.address
            );
        });
    });
});

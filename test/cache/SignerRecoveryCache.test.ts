import * as factory from "../factory";
import {
    isContractAcceptedSignature,
    onDoubleSignature,
    recoverSigner,
    __canonicalSignatureCacheSize,
    __resetSignerRecoveryCache,
    __signerRecoveryCacheSize
} from "@/cache";
import { Address, Signature } from "@/types/types";
import { config } from "@/utils/config";
import { SignatureUtils } from "@/utils/SignatureUtils";
import { codecValues } from "@test/fixtures/CodecFixtures";
import { signBlockVariant } from "@test/fixtures/QueueAdmissionFixture";
import {
    recordSignerRecoveries,
    signedMessage
} from "@test/fixtures/RecoveryCacheFixture";
import {
    contractRejectedEncodings,
    doubleSignedMessage,
    recordDoubleSignatureReports,
    reencodeSignature,
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

    describe("double-signature detection", () => {
        it("recovering the same signature twice reports nothing", async () => {
            const { message, signature } = await signedMessage();
            const { reports, stop } = recordDoubleSignatureReports();
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
                await doubleSignedMessage();
            expect(second).to.not.equal(signature);
            const { reports, stop } = recordDoubleSignatureReports();
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
            const { message, signature } = await signedMessage();
            const reencoded = reencodeSignature(signature, "yParity");
            expect(reencoded).to.not.equal(signature);
            const { reports, stop } = recordDoubleSignatureReports();
            try {
                recoverSigner(message, signature);
                // the contracts reject this encoding, so it never reaches
                // the double-signature memo
                expect(() => recoverSigner(message, reencoded)).to.throw(
                    "signature is not accepted by the contracts"
                );
                expect(reports).to.have.length(0);
            } finally {
                stop();
            }
        });

        it("a v 35/36 re-encoding of a recovered signature reports nothing", async () => {
            const { message, signature } = await signedMessage();
            const reencoded = reencodeSignature(signature, "eip155");
            expect(reencoded).to.not.equal(signature);
            const { reports, stop } = recordDoubleSignatureReports();
            try {
                recoverSigner(message, signature);
                // the contracts reject this encoding, so it never reaches
                // the double-signature memo
                expect(() => recoverSigner(message, reencoded)).to.throw(
                    "signature is not accepted by the contracts"
                );
                expect(reports).to.have.length(0);
            } finally {
                stop();
            }
        });

        it("a 64-byte compact re-encoding of a recovered signature reports nothing", async () => {
            const { message, signature } = await signedMessage();
            const reencoded = reencodeSignature(signature, "compact");
            expect(ethers.dataLength(reencoded)).to.equal(64);
            const { reports, stop } = recordDoubleSignatureReports();
            try {
                recoverSigner(message, signature);
                // the contracts reject this encoding, so it never reaches
                // the double-signature memo
                expect(() => recoverSigner(message, reencoded)).to.throw(
                    "signature is not accepted by the contracts"
                );
                expect(reports).to.have.length(0);
            } finally {
                stop();
            }
        });

        it("the 65-byte signature after its compact re-encoding reports nothing", async () => {
            const { message, signature } = await signedMessage();
            const { reports, stop } = recordDoubleSignatureReports();
            try {
                expect(() =>
                    recoverSigner(
                        message,
                        reencodeSignature(signature, "compact")
                    )
                ).to.throw("signature is not accepted by the contracts");
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
            const { reports, stop } = recordDoubleSignatureReports();
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
            const { reports, stop } = recordDoubleSignatureReports();
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
                    const e = await signedMessage();
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
            const { reports, stop } = recordDoubleSignatureReports();
            try {
                const entries = [];
                for (let i = 0; i < 4; i++) entries.push(await doubleSignedMessage());
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
                await doubleSignedMessage();
            const first = recordDoubleSignatureReports();
            const other = recordDoubleSignatureReports();
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
                await doubleSignedMessage();
            const removed = recordDoubleSignatureReports();
            const kept = recordDoubleSignatureReports();
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

        it("a throwing listener neither fails recovery nor starves another listener", async () => {
            const { wallet, message, signature, second } =
                await doubleSignedMessage();
            const stopThrowing = onDoubleSignature(() => {
                throw new Error("listener failure");
            });
            const kept = recordDoubleSignatureReports();
            try {
                recoverSigner(message, signature);
                expect(recoverSigner(message, second)).to.equal(
                    wallet.address
                );
                expect(kept.reports.map((r) => r.signer)).to.deep.equal([
                    wallet.address
                ]);
            } finally {
                stopThrowing();
                kept.stop();
            }
        });

        it("a join signature re-signed with another nonce reports its signer", async () => {
            const wallet = ethers.Wallet.createRandom();
            const join = factory.joinChannel();
            const { encoded, signature } =
                await SignatureUtils.signJoinChannel(join, wallet);
            const second = signBlockVariant(wallet, ethers.keccak256(encoded), 0);
            const { reports, stop } = recordDoubleSignatureReports();
            try {
                SignatureUtils.getSignerAddressJoinChannel(join, signature);
                SignatureUtils.getSignerAddressJoinChannel(join, second);
                expect(reports.map((r) => r.signer)).to.deep.equal([
                    wallet.address
                ]);
            } finally {
                stop();
            }
        });

        it("a transaction signature re-signed with another nonce reports its signer", async () => {
            const wallet = ethers.Wallet.createRandom();
            const transaction = factory.transaction();
            const { encoded, signature } =
                await SignatureUtils.signTransaction(transaction, wallet);
            const second = signBlockVariant(wallet, ethers.keccak256(encoded), 0);
            const { reports, stop } = recordDoubleSignatureReports();
            try {
                SignatureUtils.getSignerAddressTransaction(
                    transaction,
                    signature
                );
                SignatureUtils.getSignerAddressTransaction(transaction, second);
                expect(reports.map((r) => r.signer)).to.deep.equal([
                    wallet.address
                ]);
            } finally {
                stop();
            }
        });

        it("a dispute signature re-signed with another nonce reports its signer", async () => {
            const wallet = ethers.Wallet.createRandom();
            const dispute = factory.dispute();
            const { encoded, signature } = await SignatureUtils.signDispute(
                dispute,
                wallet
            );
            const second = signBlockVariant(wallet, ethers.keccak256(encoded), 0);
            const { reports, stop } = recordDoubleSignatureReports();
            try {
                SignatureUtils.getSignerAddressDispute(dispute, signature);
                SignatureUtils.getSignerAddressDispute(dispute, second);
                expect(reports.map((r) => r.signer)).to.deep.equal([
                    wallet.address
                ]);
            } finally {
                stop();
            }
        });

        it("an open-channel signature re-signed with another nonce reports its signer", async () => {
            const wallet = ethers.Wallet.createRandom();
            const { encoded, signature } =
                await SignatureUtils.signOpenChannel(
                    codecValues.openChannel(),
                    wallet
                );
            const second = signBlockVariant(wallet, ethers.keccak256(encoded), 0);
            const { reports, stop } = recordDoubleSignatureReports();
            try {
                SignatureUtils.getSignerAddress(encoded, signature);
                SignatureUtils.getSignerAddress(encoded, second);
                expect(reports.map((r) => r.signer)).to.deep.equal([
                    wallet.address
                ]);
            } finally {
                stop();
            }
        });

        it("the SDK signing path signs one message to identical bytes twice", async () => {
            // The runtime host signs with an ethers Wallet built from its secret.
            const wallet = new ethers.Wallet(
                ethers.Wallet.createRandom().privateKey
            );
            const block = factory.block();
            const first = await SignatureUtils.signBlock(block, wallet);
            const again = await SignatureUtils.signBlock(block, wallet);
            expect(again.signature).to.equal(first.signature);
            const join = factory.joinChannel();
            const joinFirst = await SignatureUtils.signJoinChannel(
                join,
                wallet
            );
            const joinAgain = await SignatureUtils.signJoinChannel(
                join,
                wallet
            );
            expect(joinAgain.signature).to.equal(joinFirst.signature);
        });
    });
});

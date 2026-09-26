import {
    getChainSignatureVerdict,
    setChainSignatureVerdict,
    __chainSignatureVerdictCacheSize,
    __resetChainSignatureVerdictCache
} from "@/cache";
import { Signature } from "@/types/types";
import { config } from "@/utils/config";
import { expect } from "chai";
import { ethers } from "hardhat";
import { describe, it, beforeEach } from "mocha";

describe("ChainSignatureVerdictCache", () => {
    beforeEach(() => __resetChainSignatureVerdictCache());

    function signed() {
        const wallet = ethers.Wallet.createRandom();
        const message = ethers.randomBytes(32);
        const signature = wallet.signMessageSync(message) as Signature;
        return { message, signature };
    }

    it("has no verdict for a pair it was never told about", () => {
        const { message, signature } = signed();
        expect(getChainSignatureVerdict(message, signature)).to.equal(
            undefined
        );
    });

    it("returns the stored verdict for its own pair, rejected and accepted alike", () => {
        const accepted = signed();
        const rejected = signed();
        setChainSignatureVerdict(accepted.message, accepted.signature, true);
        setChainSignatureVerdict(rejected.message, rejected.signature, false);
        expect(
            getChainSignatureVerdict(accepted.message, accepted.signature)
        ).to.equal(true);
        expect(
            getChainSignatureVerdict(rejected.message, rejected.signature)
        ).to.equal(false);
    });

    it("keys on the message too: the same signature over another message has no verdict", () => {
        const { message, signature } = signed();
        setChainSignatureVerdict(message, signature, true);
        expect(
            getChainSignatureVerdict(ethers.randomBytes(32), signature)
        ).to.equal(undefined);
    });

    it("bounds size and evicts the oldest past SIGNER_RECOVERY_CACHE_MAX", () => {
        const previous = config.SIGNER_RECOVERY_CACHE_MAX;
        config.SIGNER_RECOVERY_CACHE_MAX = 3;
        try {
            const entries = [signed(), signed(), signed(), signed(), signed()];
            for (const entry of entries)
                setChainSignatureVerdict(entry.message, entry.signature, true);
            expect(__chainSignatureVerdictCacheSize()).to.equal(3);
            expect(
                getChainSignatureVerdict(
                    entries[1].message,
                    entries[1].signature
                )
            ).to.equal(undefined);
            expect(
                getChainSignatureVerdict(
                    entries[2].message,
                    entries[2].signature
                )
            ).to.equal(true);
        } finally {
            config.SIGNER_RECOVERY_CACHE_MAX = previous;
        }
    });
});

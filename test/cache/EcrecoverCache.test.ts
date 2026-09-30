import { __ecrecoverCacheSize, __resetEcrecoverCache } from "@/cache";
import { config } from "@/utils/config";
import { ecrecover, hexToBytes } from "@ethereumjs/util";
import {
    cachedAndPlainEvm,
    createRecordingEcrecoverEvm,
    ECRECOVER_PRECOMPILE_GAS,
    installedEcrecover,
    runEcrecover,
    signedDigest
} from "@test/fixtures/RecoveryCacheFixture";
import { expect } from "chai";
import { ethers } from "ethers";
import { beforeEach, describe, it } from "mocha";

// secp256k1 group order.
const SECP256K1_N =
    0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

describe("EcrecoverCache", function () {
    beforeEach(() => __resetEcrecoverCache());

    it("recovers the same signer as an EVM without the memo", async function () {
        const { cached, plain } = await cachedAndPlainEvm();
        const { wallet, input } = signedDigest();

        const run = await runEcrecover(cached, input);
        expect(run).to.deep.equal(await runEcrecover(plain, input));
        expect(run.executionGasUsed).to.equal(ECRECOVER_PRECOMPILE_GAS);
        expect(
            ethers.getAddress(ethers.dataSlice(run.returnValue, 12))
        ).to.equal(wallet.address);
    });

    it("memoizes by (digest, signature) — repeats add no entries and return the same signer", async function () {
        const { evm } = await createRecordingEcrecoverEvm();
        const { input } = signedDigest();
        const outputs = [];
        for (let i = 0; i < 3; i++)
            outputs.push((await runEcrecover(evm, input)).returnValue);
        expect(new Set(outputs).size).to.equal(1);
        expect(__ecrecoverCacheSize()).to.equal(1);

        await runEcrecover(evm, signedDigest().input);
        expect(__ecrecoverCacheSize()).to.equal(2);
    });

    it("repeated calls after a cache fill match the plain EVM in output and gas, with one real recovery", async function () {
        const { plain } = await cachedAndPlainEvm();
        const { evm, recoveries } = await createRecordingEcrecoverEvm();
        const { input } = signedDigest();
        const expected = await runEcrecover(plain, input);

        const runs = [];
        for (let i = 0; i < 3; i++) runs.push(await runEcrecover(evm, input));
        expect(runs).to.deep.equal([expected, expected, expected]);
        expect(recoveries).to.deep.equal([input.digest]);
    });

    it("keys on the digest — one signature under two digests matches the plain EVM for each in a filled cache", async function () {
        const { plain } = await cachedAndPlainEvm();
        const { evm, recoveries } = await createRecordingEcrecoverEvm();
        const filler = [0, 1].map(() => signedDigest().input);
        for (const input of filler) await runEcrecover(evm, input);
        const signed = signedDigest().input;
        const otherDigest = {
            ...signed,
            digest: ethers.hexlify(ethers.randomBytes(32))
        };
        const expected = await runEcrecover(plain, signed);
        const expectedOther = await runEcrecover(plain, otherDigest);
        // the same signature names another key under another digest
        expect(expectedOther.returnValue).to.not.equal(expected.returnValue);

        for (let i = 0; i < 2; i++) {
            expect(await runEcrecover(evm, signed)).to.deep.equal(expected);
            expect(await runEcrecover(evm, otherDigest)).to.deep.equal(
                expectedOther
            );
        }
        expect(__ecrecoverCacheSize()).to.equal(4);
        // one real recovery per digest; the repeats were hits
        expect(recoveries).to.deep.equal([
            ...filler.map((input) => input.digest),
            signed.digest,
            otherDigest.digest
        ]);
    });

    it("keys on the signature — two signatures under one digest match the plain EVM for each in a filled cache", async function () {
        const { plain } = await cachedAndPlainEvm();
        const { evm, recoveries } = await createRecordingEcrecoverEvm();
        const filler = [0, 1].map(() => signedDigest().input);
        for (const input of filler) await runEcrecover(evm, input);
        const first = signedDigest();
        const second = signedDigest(first.input.digest);
        const expected = await runEcrecover(plain, first.input);
        const expectedSecond = await runEcrecover(plain, second.input);
        expect(
            ethers.getAddress(ethers.dataSlice(expected.returnValue, 12))
        ).to.equal(first.wallet.address);
        expect(
            ethers.getAddress(ethers.dataSlice(expectedSecond.returnValue, 12))
        ).to.equal(second.wallet.address);

        for (let i = 0; i < 2; i++) {
            expect(await runEcrecover(evm, first.input)).to.deep.equal(
                expected
            );
            expect(await runEcrecover(evm, second.input)).to.deep.equal(
                expectedSecond
            );
        }
        expect(__ecrecoverCacheSize()).to.equal(4);
        // one real recovery per signature; the repeats were hits
        expect(recoveries).to.deep.equal([
            ...filler.map((input) => input.digest),
            first.input.digest,
            first.input.digest
        ]);
    });

    it("a high-s signature matches the plain EVM in output and gas", async function () {
        const { cached, plain } = await cachedAndPlainEvm();
        const { wallet, input } = signedDigest();
        // The malleable twin (r, n - s, flipped v): the precompile accepts it,
        // unlike the contracts' OpenZeppelin author check.
        const highS = {
            ...input,
            v: input.v === 27 ? 28 : 27,
            s: ethers.toBeHex(SECP256K1_N - BigInt(input.s), 32)
        };

        const run = await runEcrecover(cached, highS);
        expect(run).to.deep.equal(await runEcrecover(plain, highS));
        expect(
            ethers.getAddress(ethers.dataSlice(run.returnValue, 12))
        ).to.equal(wallet.address);
        // a repeat is served from the memo and still matches
        expect(await runEcrecover(cached, highS)).to.deep.equal(run);
        expect(__ecrecoverCacheSize()).to.equal(1);
    });

    it("an invalid v matches the plain EVM in output and gas, and keeps no entry", async function () {
        const { plain } = await cachedAndPlainEvm();
        const { evm, recoveries } = await createRecordingEcrecoverEvm();
        const input = { ...signedDigest().input, v: 29 };

        const run = await runEcrecover(evm, input);
        expect(run).to.deep.equal(await runEcrecover(plain, input));
        expect(run.returnValue).to.equal("0x");
        expect(run.executionGasUsed).to.equal(ECRECOVER_PRECOMPILE_GAS);
        expect(recoveries).to.deep.equal([]);
        expect(__ecrecoverCacheSize()).to.equal(0);
    });

    it("a signature that recovers no key matches the plain EVM in output and gas, and keeps no entry", async function () {
        const { plain } = await cachedAndPlainEvm();
        const { evm, recoveries } = await createRecordingEcrecoverEvm();
        const input = { ...signedDigest().input, r: ethers.ZeroHash };

        const run = await runEcrecover(evm, input);
        expect(run).to.deep.equal(await runEcrecover(plain, input));
        expect(run.returnValue).to.equal("0x");
        expect(run.executionGasUsed).to.equal(ECRECOVER_PRECOMPILE_GAS);
        // the failed recovery ran for real and was not memoized: a repeat
        // recovers again
        expect(await runEcrecover(evm, input)).to.deep.equal(run);
        expect(recoveries).to.deep.equal([input.digest, input.digest]);
        expect(__ecrecoverCacheSize()).to.equal(0);
    });

    it("insufficient precompile gas matches the plain EVM on both sides of the precompile cost", async function () {
        const { plain } = await cachedAndPlainEvm();
        const { evm, recoveries } = await createRecordingEcrecoverEvm();
        const { wallet, input } = signedDigest();

        const short = await runEcrecover(
            evm,
            input,
            ECRECOVER_PRECOMPILE_GAS - 1n
        );
        expect(short).to.deep.equal(
            await runEcrecover(plain, input, ECRECOVER_PRECOMPILE_GAS - 1n)
        );
        expect(short.exceptionError).to.equal("out of gas");
        expect(short.executionGasUsed).to.equal(ECRECOVER_PRECOMPILE_GAS - 1n);
        expect(recoveries).to.deep.equal([]);
        expect(__ecrecoverCacheSize()).to.equal(0);

        const exact = await runEcrecover(evm, input, ECRECOVER_PRECOMPILE_GAS);
        expect(exact).to.deep.equal(
            await runEcrecover(plain, input, ECRECOVER_PRECOMPILE_GAS)
        );
        expect(exact.exceptionError).to.equal(null);
        expect(
            ethers.getAddress(ethers.dataSlice(exact.returnValue, 12))
        ).to.equal(wallet.address);
        // a memo hit is still refused below the precompile cost
        expect(
            await runEcrecover(evm, input, ECRECOVER_PRECOMPILE_GAS - 1n)
        ).to.deep.equal(short);
        expect(recoveries).to.deep.equal([input.digest]);
    });

    it("evicts the oldest entry first at SIGNER_RECOVERY_CACHE_MAX and recomputes it correctly", async function () {
        const prev = config.SIGNER_RECOVERY_CACHE_MAX;
        config.SIGNER_RECOVERY_CACHE_MAX = 3;
        try {
            const { plain } = await cachedAndPlainEvm();
            const { evm, recoveries } = await createRecordingEcrecoverEvm();
            const [a, b, c, d] = [0, 1, 2, 3].map(() => signedDigest().input);

            for (const input of [a, b, c]) await runEcrecover(evm, input);
            expect(__ecrecoverCacheSize()).to.equal(3);
            // a hit does not refresh a's position: eviction is by insertion
            await runEcrecover(evm, a);
            expect(recoveries).to.deep.equal([a.digest, b.digest, c.digest]);

            await runEcrecover(evm, d); // evicts a
            await runEcrecover(evm, b); // still cached
            const recomputed = await runEcrecover(evm, a); // evicts b
            await runEcrecover(evm, c); // still cached
            expect(recoveries).to.deep.equal([
                a.digest,
                b.digest,
                c.digest,
                d.digest,
                a.digest
            ]);
            expect(__ecrecoverCacheSize()).to.equal(3);
            expect(recomputed).to.deep.equal(await runEcrecover(plain, a));
        } finally {
            config.SIGNER_RECOVERY_CACHE_MAX = prev;
        }
    });

    it("mutating a returned public key does not change a later recovery", async function () {
        const { evm } = await createRecordingEcrecoverEvm();
        const recover = installedEcrecover(evm);
        const { input } = signedDigest();
        const args = [
            hexToBytes(input.digest),
            BigInt(input.v),
            hexToBytes(input.r),
            hexToBytes(input.s)
        ] as const;
        const expected = ecrecover(...args);

        const miss = recover(...args);
        expect(miss).to.deep.equal(expected);
        miss.fill(0);
        const hit = recover(...args);
        expect(hit).to.deep.equal(expected);
        hit.fill(0);
        expect(recover(...args)).to.deep.equal(expected);
        expect(__ecrecoverCacheSize()).to.equal(1);
    });
});

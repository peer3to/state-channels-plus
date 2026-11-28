import Clock from "@/Clock";
import { createZeroGenesisChain } from "@test/fixtures/node/ZeroGenesisChain";
import { expect } from "chai";
import { BrowserProvider } from "ethers";
import { ethers, network } from "hardhat";

// A second real ethers provider over the same in-process hardhat network:
// distinct instance, live chain reads, no mocking.
function createSecondProvider(): BrowserProvider {
    return new BrowserProvider(network.provider);
}

describe("Clock", () => {
    it("initializes idempotently when real-provider calls overlap", async () => {
        await Promise.all([
            Clock.init(ethers.provider),
            Clock.init(ethers.provider),
            Clock.init(ethers.provider)
        ]);
        const firstTime = await Clock.getBlockchainTime();

        await Clock.init(ethers.provider);
        const secondTime = await Clock.getBlockchainTime();

        expect(secondTime.blockNumber).to.equal(firstTime.blockNumber);
        expect(Clock.getAverageOnChainBlockTime()).to.be.greaterThanOrEqual(0);
        expect(Clock.ownsProvider(ethers.provider)).to.equal(true);
    });

    it("re-initializes when a different provider arrives", async () => {
        await Clock.init(ethers.provider);
        const replacement = createSecondProvider();

        await Clock.init(replacement);

        expect(Clock.ownsProvider(replacement)).to.equal(true);
        expect(Clock.ownsProvider(ethers.provider)).to.equal(false);
        // Reads go through the new live provider, not the replaced one.
        const time = await Clock.getBlockchainTime();
        expect(time.blockNumber).to.be.greaterThanOrEqual(0);
    });

    it("destroys a released provider once a replacement takes over", async () => {
        const released = createSecondProvider();
        await Clock.init(released);
        Clock.releaseProvider(released);
        expect(released.destroyed).to.equal(false);

        await Clock.init(createSecondProvider());

        expect(released.destroyed).to.equal(true);
    });

    it("keeps a replaced provider its runtime still owns", async () => {
        const owned = createSecondProvider();
        await Clock.init(owned);

        await Clock.init(createSecondProvider());

        expect(owned.destroyed).to.equal(false);
        owned.destroy();
    });

    it("recovers with a live provider after a failed replacement", async () => {
        await Clock.init(ethers.provider);
        const destroyed = createSecondProvider();
        destroyed.destroy();

        let failed = false;
        try {
            await Clock.init(destroyed);
        } catch {
            failed = true;
        }
        expect(failed).to.equal(true);
        expect(Clock.ownsProvider(destroyed)).to.equal(false);

        const live = createSecondProvider();
        await Clock.init(live);
        expect(Clock.ownsProvider(live)).to.equal(true);
        const time = await Clock.getBlockchainTime();
        expect(time.blockNumber).to.be.greaterThanOrEqual(0);
    });

    it("measures a young chain's block time without its zero-timestamp genesis", async () => {
        const young = await createZeroGenesisChain([2, 2, 2]);

        await Clock.init(young);

        expect(Clock.getAverageOnChainBlockTime()).to.equal(2);
        young.destroy();
    });

    it("measures no block time on a chain one block past genesis", async () => {
        const fresh = await createZeroGenesisChain([]);

        await Clock.init(fresh);

        expect(Clock.getAverageOnChainBlockTime()).to.equal(0);
        fresh.destroy();
    });

    it("measures an older chain's block time over its last ten blocks", async () => {
        // blocks 1-5 are 10 s apart, blocks 5-15 2 s apart -> an uncapped window averages ~4.29
        const older = await createZeroGenesisChain([
            10, 10, 10, 10, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2
        ]);

        await Clock.init(older);

        expect(Clock.getAverageOnChainBlockTime()).to.equal(2);
        older.destroy();
    });

    it("spans blocks at the measured block time", async () => {
        const young = await createZeroGenesisChain([2, 2, 2]);

        await Clock.init(young);

        expect(Clock.getBlockSpanMs(3)).to.equal(6_000);
        young.destroy();
    });

    it("keeps the latest block its synchronization read", async () => {
        const young = await createZeroGenesisChain([2, 2, 2]);

        await Clock.init(young);

        const latest = await young.getBlock("latest");
        expect(Clock.getSyncedBlockchainTime()).to.deep.equal({
            timestamp: latest!.timestamp,
            blockNumber: latest!.number
        });
        young.destroy();
    });

    it("spans blocks at one second each before a block time is measured", async () => {
        const fresh = await createZeroGenesisChain([]);

        await Clock.init(fresh);

        expect(Clock.getBlockSpanMs(3)).to.equal(3_000);
        fresh.destroy();
    });

    it("settles overlapping different-provider initializations on one live owner", async () => {
        const first = createSecondProvider();
        const second = createSecondProvider();

        await Promise.all([Clock.init(first), Clock.init(second)]);

        // Exactly one of the two owns the singleton, and reads work on it.
        expect(
            Clock.ownsProvider(first) !== Clock.ownsProvider(second)
        ).to.equal(true);
        const time = await Clock.getBlockchainTime();
        expect(time.blockNumber).to.be.greaterThanOrEqual(0);
    });
});

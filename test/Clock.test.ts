import { expect } from "chai";
import { BrowserProvider } from "ethers";
import { ethers, network } from "hardhat";

import Clock from "@/Clock";

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

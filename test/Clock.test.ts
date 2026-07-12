import { expect } from "chai";
import { ethers } from "hardhat";

import Clock from "@/Clock";

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
});

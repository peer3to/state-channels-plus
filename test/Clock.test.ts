import Clock from "@/Clock";
import { BLOCK_TIME_MS } from "@/types";
import {
    mineBlocks,
    withIsolatedHardhatNode
} from "@test/fixtures/node/IsolatedHardhatNode";
import { waitFor } from "@test/utils/waitFor";
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

    it("adjusts to a head more than one block time ahead of the wall clock", async () => {
        try {
            await withIsolatedHardhatNode(
                async (node) => {
                    await mineBlocks(node, 5);
                    const head = (await node.getBlock("latest"))!;

                    await Clock.init(node);

                    expect(Clock.getClockAdjustmentSeconds()).to.be.greaterThan(
                        BLOCK_TIME_MS / 1000
                    );
                    expect(
                        Math.abs(Clock.getTimeInSeconds() - head.timestamp)
                    ).to.be.at.most(BLOCK_TIME_MS / 1000);
                },
                { seal: "manual" }
            );
        } finally {
            await Clock.init(ethers.provider);
        }
    });

    it("adjusts back to a head more than one block time behind the wall clock", async () => {
        const blockSeconds = BLOCK_TIME_MS / 1000;
        try {
            await withIsolatedHardhatNode(
                async (node) => {
                    await mineBlocks(node, 1);
                    const head = (await node.getBlock("latest"))!;
                    await waitFor(
                        () =>
                            Math.floor(Date.now() / 1000) - head.timestamp >
                            2 * blockSeconds
                    );

                    await Clock.init(node);

                    expect(Clock.getClockAdjustmentSeconds()).to.be.lessThan(
                        -blockSeconds
                    );
                    expect(
                        Math.abs(Clock.getTimeInSeconds() - head.timestamp)
                    ).to.be.at.most(blockSeconds);
                },
                { seal: "manual" }
            );
        } finally {
            await Clock.init(ethers.provider);
        }
    });

    it("keeps no adjustment for a head within one block time of the wall clock", async () => {
        try {
            await withIsolatedHardhatNode(
                async (node) => {
                    await mineBlocks(node, 1);

                    await Clock.init(node);

                    expect(Clock.getClockAdjustmentSeconds()).to.equal(0);
                },
                { seal: "manual" }
            );
        } finally {
            await Clock.init(ethers.provider);
        }
    });
});

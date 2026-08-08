import { ethers } from "ethers";

// Tolerance policy for syncClock: re-adjust only when local time and the latest
// block timestamp disagree by more than one averageBlockTime. The predicate
// cannot tell real skew from ordinary "no block yet" lag, so this is a budget
// for undetected skew, not a classifier. One interval and not two because both
// avoid correcting when simply no block has landed, but 1x leaves less real skew
// uncorrected, and an occasional needless correction costs less than running on
// a wrong clock.
// Known limit: averageBlockTime is a trailing mean and does not bound the gap
// still open after the latest block, so an unusually late block reads as a
// disagreement and pulls local time back to that block. Narrowing that needs an
// asymmetric or gap-aware rule — a behaviour change, out of scope here.
export function isBeyondBlockIntervalTolerance(
    differenceSeconds: number,
    averageBlockTimeSeconds: number
): boolean {
    return Math.abs(differenceSeconds) > averageBlockTimeSeconds;
}

class Clock {
    private static instance: Clock | undefined;
    private static initialization: Promise<void> | undefined;
    private clockAdjustmentSeconds: number;
    private provider: ethers.Provider;
    private averageBlockTime: number | undefined; // in seconds

    private constructor(runner: ethers.Provider) {
        this.provider = runner;
        this.clockAdjustmentSeconds = 0;
    }

    public static async init(provider: ethers.Provider): Promise<void> {
        // A fresh session brings a fresh provider and may have destroyed the
        // old one; re-initialize instead of serving stale chain reads.
        if (Clock.instance && Clock.instance.provider !== provider) {
            Clock.instance = undefined;
            Clock.initialization = undefined;
        }
        if (!Clock.initialization) {
            const instance = new Clock(provider);
            Clock.initialization = instance
                .syncClock()
                .then(() => {
                    Clock.instance = instance;
                })
                .catch((error) => {
                    Clock.initialization = undefined;
                    throw error;
                });
        }
        await Clock.initialization;
    }
    public static ownsProvider(provider: ethers.Provider): boolean {
        return Clock.instance?.provider === provider;
    }
    public static getTimeInSeconds(): number {
        return (
            Math.floor(new Date().getTime() / 1000) +
            Clock.getInstance().clockAdjustmentSeconds
        );
    }
    public static getAverageOnChainBlockTime(): number {
        const averageBlockTime = Clock.getInstance().averageBlockTime;
        if (averageBlockTime === undefined) {
            throw new Error("CLock - Average block time not set");
        }
        return averageBlockTime;
    }

    public static async getBlockchainTime(): Promise<{
        timestamp: number;
        blockNumber: number;
    }> {
        const provider = Clock.getInstance().provider;
        const latestBlock = await provider.getBlock("latest");
        if (!latestBlock) throw new Error("Could not get latest block");
        return {
            timestamp: latestBlock.timestamp,
            blockNumber: latestBlock.number
        };
    }

    public static async getBlockchainNetwork() {
        const provider = Clock.getInstance().provider;
        return await provider.getNetwork();
    }

    private static getInstance(): Clock {
        if (!Clock.instance) throw new Error("Clock not initialized!");
        return Clock.instance;
    }
    private async syncClock() {
        const currentTime =
            Math.floor(new Date().getTime() / 1000) +
            this.clockAdjustmentSeconds;

        const latestBlock = await this.provider.getBlock("latest");
        if (!latestBlock) throw new Error("Could not get latest block");
        const latestTimestamp = latestBlock.timestamp;

        const difference = latestTimestamp - currentTime;

        const blockCnt = Math.min(latestBlock.number, 10);
        if (blockCnt === 0) {
            this.averageBlockTime = 0;
            this.clockAdjustmentSeconds += difference;
            return;
        }
        const pastBlock = await this.provider.getBlock(
            latestBlock.number - blockCnt
        );
        if (!pastBlock) throw new Error("Could not get past block");
        const pastTimestamp = pastBlock.timestamp;

        this.averageBlockTime = (latestTimestamp - pastTimestamp) / blockCnt;
        if (!this.averageBlockTime) {
            this.clockAdjustmentSeconds += difference;
            return;
        }
        if (isBeyondBlockIntervalTolerance(difference, this.averageBlockTime)) {
            this.clockAdjustmentSeconds += difference;
            await this.syncClock(); // Recursively call syncClock until condition is satisfied
        }
    }
}

export default Clock;

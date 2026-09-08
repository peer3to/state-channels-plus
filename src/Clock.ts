import { ethers } from "ethers";

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
        // old one; re-initialize instead of serving stale chain reads. Keep
        // the old instance serving until the replacement has synced: code
        // already running in this process (e.g. an in-flight spectate sync)
        // reads the clock concurrently, and a hard "not initialized" throw
        // there aborts live work over a sub-second adjustment refresh.
        if (Clock.instance && Clock.instance.provider !== provider) {
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
    public static isInitialized(): boolean {
        return Clock.instance !== undefined;
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
    /**
     * The adjustment from wall time to estimated chain time, for a context
     * without this singleton (a contract-executor worker) to keep the same
     * perception: `floor(wallTime / 1000) + adjustment`.
     */
    public static getClockAdjustmentSeconds(): number {
        return Clock.getInstance().clockAdjustmentSeconds;
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
        // console.log(
        //     `Average block time calculated: ${this.averageBlockTime}s over ${blockCnt} blocks`,
        //     `past block timestamp: ${pastTimestamp}, latest block timestamp: ${latestTimestamp}`,
        //     `current time: ${currentTime}, difference: ${difference}s`
        // );
        if (!this.averageBlockTime) {
            this.clockAdjustmentSeconds += difference;
            return;
        }
        //TODO - think - should it be 2* or 1* or something else?
        if (Math.abs(difference) > this.averageBlockTime) {
            this.clockAdjustmentSeconds += difference;
            await this.syncClock(); // Recursively call syncClock until condition is satisfied
        }
    }
}

export default Clock;

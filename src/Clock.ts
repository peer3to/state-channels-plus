import { ethers } from "ethers";

class Clock {
    private static instance: Clock;
    private clockAdjustmentSeconds: number;
    private provider: ethers.Provider;
    private averageBlockTime: number | undefined; // in seconds

    private constructor(runner: ethers.Provider) {
        this.provider = runner;
        this.clockAdjustmentSeconds = 0;
    }

    public static async init(provider: ethers.Provider) {
        Clock.instance = new Clock(provider);
        await Clock.instance.syncClock();
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
    private static getInstance(): Clock {
        if (!Clock.instance) throw new Error("Clock not initialized!");
        return Clock.instance;
    }
    private async syncClock() {
        const currentTime = Clock.getTimeInSeconds();

        const latestBlock = await this.provider.getBlock("latest");
        if (!latestBlock) throw new Error("Could not get latest block");
        const latestTimestamp = latestBlock.timestamp;

        const difference = latestTimestamp - currentTime;

        const blockCnt = latestBlock.number;
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
        //TODO - think - should it be 2* or 1* or something else?
        if (difference > 2 * this.averageBlockTime) {
            this.clockAdjustmentSeconds += difference;
            await this.syncClock(); // Recursively call syncClock until condition is satisfied
        }
    }
}

export default Clock;

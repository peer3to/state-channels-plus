import { ethers } from "ethers";

class Clock {
    private static instance: Clock;
    private clockAjustmentSeconds: number;
    private provider: ethers.Provider;

    private constructor(runner: ethers.Provider) {
        this.provider = runner;
        this.clockAjustmentSeconds = 0;
    }

    public static async init(provider: ethers.Provider) {
        Clock.instance = new Clock(provider);
        await Clock.instance.syncClock();
    }
    public static getTimeInSeconds(): number {
        return (
            Math.floor(new Date().getTime() / 1000) +
            Clock.getInstance().clockAjustmentSeconds
        );
    }
    private static getInstance(): Clock {
        if (!Clock.instance) throw new Error("Clock not initialized!");
        return Clock.instance;
    }
    private async syncClock() {
        let currentTime = Clock.getTimeInSeconds();

        const latestBlock = await this.provider.getBlock("latest");
        if (!latestBlock) throw new Error("Could not get latest block");
        let latestTimestamp = latestBlock.timestamp;

        const difference = latestTimestamp - currentTime;

        let blockCnt = latestBlock.number >= 100 ? 100 : 0;
        let pastBlock = await this.provider.getBlock(
            latestBlock.number - blockCnt
        );
        if (!pastBlock) throw new Error("Could not get past block");
        let pastTimestamp = pastBlock.timestamp;

        let averageBlockTime = (latestTimestamp - pastTimestamp) / blockCnt;
        if (!averageBlockTime) {
            this.clockAjustmentSeconds += difference;
            return;
        }
        //TODO - think - shouit it be 2* or 1* or something else?
        if (difference > 2 * averageBlockTime) {
            this.clockAjustmentSeconds += difference;
            await this.syncClock(); // Recursively call syncClock until condition is satisfied
        }
    }
}

export default Clock;

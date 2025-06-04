import { BigNumberish, ethers } from "ethers";
import { IStorage } from "./IStorage";
import { StateSnapshotStruct } from "@typechain-types/contracts/V1/DataTypes";
import { UnrolledSignedBlock } from "@/types/storage";

export class Storage implements IStorage {
    private static instance: Storage;

    private latestOnChainStateSnapshot: {
        stateSnapshot: StateSnapshotStruct;
        timestamp: number;
    } = {
        timestamp: 0,
        //  junk to keep ts happy, this should be initialized with channel creation with genesis state
        stateSnapshot: null as unknown as StateSnapshotStruct
    };

    private constructor() {}

    public static getInstance(): Storage {
        if (!Storage.instance) {
            Storage.instance = new Storage();
        }
        return Storage.instance;
    }

    getLatestJoinChannelBlockHash(): string {
        // TODO
        return ethers.ZeroHash;
    }

    getLatestExitChannelBlockHash(): string {
        // TODO
        return ethers.ZeroHash;
    }

    getTotalDeposits(): { amount: BigNumberish; data: string } {
        // TODO
        return { amount: 0, data: "0x" };
    }

    getTotalWithdrawals(): { amount: BigNumberish; data: string } {
        // TODO
        return { amount: 0, data: "0x" };
    }

    getPreviousBlockHash(
        forkCnt: number,
        transactionCnt: number
    ): string | undefined {
        // TODO
        return ethers.ZeroHash;
    }

    getLatestBlock(): UnrolledSignedBlock {
        return null as unknown as UnrolledSignedBlock;
    }

    getLatestOnChainStateSnapshot(): {
        stateSnapshot: StateSnapshotStruct;
        timestamp: number;
    } {
        return this.latestOnChainStateSnapshot;
    }

    setLatestOnChainStateSnapshot(
        stateSnapshot: StateSnapshotStruct,
        timestamp: number
    ): void {
        this.latestOnChainStateSnapshot = { stateSnapshot, timestamp };
    }
}

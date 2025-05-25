import { EvmUtils } from "@/utils";
import { BigNumberish, BytesLike, toBeHex } from "ethers";
import {
    JoinChannelBlockStruct,
    StateSnapshotStruct,
    BalanceStruct
} from "@typechain-types/contracts/V1/DataTypes";
import { EVM } from "@ethereumjs/evm";

/**
 * StateSnapshotStorage provides persistent storage for state snapshots
 * organized by fork count and block height.
 */
export default class StateSnapshotStorage {
    // map [fork count, block height] => struct
    // we make the key a string to avoid double mapping
    private stateSnapshotStructsMap: Map<string, StateSnapshotStruct>;

    //TODO; technically speaking all blockStructs have the hash of the previous one inside
    // so we could store only the latest one
    // but then if we want to fetch a specific block hash, we would need to traverse the chain
    // and that would be inefficient, but at the same time we are not supposed to
    // have a lot of join/exit channel blocks
    private joinChannelBlockHashesMap: Map<string, BytesLike>;
    private latestJoinChannelBlockHash: BytesLike | undefined;
    private exitChannelBlockHashesMap: Map<string, BytesLike>;
    private latestExitChannelBlockHash: BytesLike | undefined;

    private totalDeposits: BalanceStruct;
    private totalWithdrawals: BalanceStruct;

    constructor() {
        this.stateSnapshotStructsMap = new Map();
        this.joinChannelBlockHashesMap = new Map();
        this.exitChannelBlockHashesMap = new Map();
        this.totalDeposits = {
            amount: BigInt(0),
            data: "0x"
        };
        this.totalWithdrawals = {
            amount: BigInt(0),
            data: "0x"
        };
        this.latestJoinChannelBlockHash = undefined;
        this.latestExitChannelBlockHash = undefined;
        console.log("StateSnapshotStorage initialized");
    }

    // State snapshot management methods

    /**
     * Store a state snapshot
     */
    store(
        forkCnt: number, //might get that from the snapshot itself later on
        blockHeight: number,
        snapshot: StateSnapshotStruct
    ) {
        const key = this.makeKey(forkCnt, blockHeight);
        this.stateSnapshotStructsMap.set(key, snapshot);

        console.log(
            `Stored snapshot for fork ${forkCnt}, height ${blockHeight}`
        );
    }

    /**
     * Retrieve a state snapshot
     */
    get(forkCnt: number, blockHeight: number): StateSnapshotStruct | undefined {
        const key = this.makeKey(forkCnt, blockHeight);
        return this.stateSnapshotStructsMap.get(key);
    }

    /**
     * Clear all mapped state snapshots and block hashes
     */
    clear() {
        this.stateSnapshotStructsMap.clear();
        this.joinChannelBlockHashesMap.clear();
        this.exitChannelBlockHashesMap.clear();
        console.log("Cleared all state snapshots");
    }

    // Join/Exit channel block hash management methods

    /**
     * Store the block hash for a join channel block
     */
    storeJoinChannelBlockHash(
        forkCnt: number,
        blockHeight: number,
        blockHash: string
    ) {
        const key = this.makeKey(forkCnt, blockHeight);
        this.joinChannelBlockHashesMap.set(key, blockHash);
        this.latestJoinChannelBlockHash = blockHash;

        // Update total deposits
        const joinChannelBlock = EvmUtils.decodeJoinChannelBlock(blockHash);
        if (joinChannelBlock && joinChannelBlock.joinChannels.length > 0) {
            this.addToTotalDeposits(joinChannelBlock.joinChannels[0].balance);
        }

        console.log(
            `Stored join channel block hash for fork ${forkCnt}, height ${blockHeight}`
        );
    }

    /**
     * Retrieve the block hash for a join channel block
     */
    getJoinChannelBlockHash(
        forkCnt: number,
        blockHeight: number
    ): BytesLike | undefined {
        const key = this.makeKey(forkCnt, blockHeight);
        return this.joinChannelBlockHashesMap.get(key);
    }

    getLatestJoinChannelBlockHash(): BytesLike | undefined {
        return this.latestJoinChannelBlockHash;
    }

    /**
     * Store the block hash for an exit channel block
     */
    storeExitChannelBlockHash(
        forkCnt: number,
        blockHeight: number,
        blockHash: string
    ) {
        const key = this.makeKey(forkCnt, blockHeight);
        this.exitChannelBlockHashesMap.set(key, blockHash);
        this.latestExitChannelBlockHash = blockHash;
        console.log(
            `Stored exit channel block hash for fork ${forkCnt}, height ${blockHeight}`
        );
    }

    /**
     * Retrieve the block hash for an exit channel block
     */
    getExitChannelBlockHash(
        forkCnt: number,
        blockHeight: number
    ): BytesLike | undefined {
        const key = this.makeKey(forkCnt, blockHeight);
        return this.exitChannelBlockHashesMap.get(key);
    }

    getLatestExitChannelBlockHash(): BytesLike | undefined {
        return this.latestExitChannelBlockHash;
    }

    // Total deposits and withdrawals management methods

    /**
     * Add to the total deposits
     * Doesn't handle data yet, just the amount
     */
    private addToTotalDeposits(balance: BalanceStruct) {
        //TODO: create a method to add two balances together
        this.totalDeposits.amount += toBeHex(balance.amount);
        console.log(`Total deposits updated: ${this.totalDeposits}`);
    }

    /**
     * Get the total deposits
     */
    getTotalDeposits(): BalanceStruct {
        return this.totalDeposits;
    }

    /**
     * Add to the total withdrawals
     * Doesnt handle data yet, just the amount
     */
    addToTotalWithdrawals(balance: BalanceStruct) {
        this.totalWithdrawals.amount += toBeHex(balance.amount);
        console.log(`Total withdrawals updated: ${this.totalWithdrawals}`);
    }

    /**
     * Get the total withdrawals
     */
    getTotalWithdrawals(): BalanceStruct {
        return this.totalWithdrawals;
    }

    // Helper methods

    private makeKey(forkCnt: number, blockHeight: number): string {
        return `${forkCnt}-${blockHeight}`;
    }

    private parseKey(key: string): [number | undefined, number | undefined] {
        const parts = key.split("-");
        if (parts.length !== 2) {
            return [undefined, undefined];
        }

        const forkCnt = parseInt(parts[0], 10);
        const blockHeight = parseInt(parts[1], 10);

        if (isNaN(forkCnt) || isNaN(blockHeight)) {
            return [undefined, undefined];
        }

        return [forkCnt, blockHeight];
    }
}

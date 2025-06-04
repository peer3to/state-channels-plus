import { EvmUtils } from "@/utils";
import { BigNumberish, BytesLike, toBeHex, hexlify } from "ethers";
import {
    JoinChannelBlockStruct,
    StateSnapshotStruct,
    BalanceStruct,
    BlockConfirmationStruct
} from "@typechain-types/contracts/V1/DataTypes";
import { EVM } from "@ethereumjs/evm";

/**
 * StateSnapshotStorage provides persistent storage for state snapshots
 * organized by fork count and block height.
 */
export default class StateSnapshotStorage {
    //BlockConfirmationStruct => SignedBlockStruct => encodedBlock => BlockStruct
    private blockConfirmationStructsMap: Map<string, BlockConfirmationStruct>;

    // map [fork count, block height] => struct
    // we make the key a string to avoid double mapping
    private stateSnapshotStructsMap: Map<string, StateSnapshotStruct>;
    //could be replaced with a key, but we would need some computation
    private latestOnChainStateSnapshot: {
        stateSnapshot: StateSnapshotStruct;
        timestamp: number;
    };

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
        //TODO: This should be replaced by the actual genesis state snapshot
        this.latestOnChainStateSnapshot = {
            stateSnapshot: {
                stateMachineStateHash: "0x",
                participants: [],
                forkCnt: 0,
                latestJoinChannelBlockHash: "0x",
                latestExitChannelBlockHash: "0x",
                totalDeposits: {
                    amount: BigInt(0),
                    data: "0x"
                },
                totalWithdrawals: {
                    amount: BigInt(0),
                    data: "0x"
                }
            },
            timestamp: 0
        };
        this.blockConfirmationStructsMap = new Map();
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

    //#region Block confirmation management methods

    //#endregion

    //#region State snapshot management methods

    /**
     * Store a state snapshot
     */
    store(blockHeight: number, snapshot: StateSnapshotStruct) {
        const key = this.makeKey(Number(snapshot.forkCnt), blockHeight);
        this.stateSnapshotStructsMap.set(key, snapshot);

        console.log(
            `Stored snapshot for fork ${snapshot.forkCnt}, height ${blockHeight}`
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
        this.latestOnChainStateSnapshot = {
            stateSnapshot,
            timestamp
        };
    }
    //#endregion

    //#region Join/Exit channel block hash management methods

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
    //#endregion

    //#region Total deposits and withdrawals management methods

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
    getTotalDeposits(): { amount: BigNumberish; data: string } {
        return {
            amount: this.totalDeposits.amount,
            data: hexlify(this.totalDeposits.data)
        };
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
    getTotalWithdrawals(): { amount: BigNumberish; data: string } {
        return {
            amount: this.totalWithdrawals.amount,
            data: hexlify(this.totalWithdrawals.data)
        };
    }
    //#endregion

    //#region Helper methods

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
    //#endregion
}

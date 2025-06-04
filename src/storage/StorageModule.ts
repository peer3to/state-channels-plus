import { BigNumberish, ethers, BytesLike, toBeHex, hexlify } from "ethers";
import { IStorageModule } from "./IStorageModule";
import { Codec, EvmUtils, Type } from "@/utils";
import {
    StateSnapshotStruct,
    BalanceStruct,
    BlockConfirmationStruct
} from "@typechain-types/contracts/V1/DataTypes";
import { UnrolledBlock, UnrolledSignedBlock } from "@/types/storage";

export class StorageModule implements IStorageModule {
    //BlockConfirmationStruct => SignedBlockStruct => encodedBlock => BlockStruct
    private blockConfirmationStructsMap: Map<string, BlockConfirmationStruct>;
    private latestBlockConfirmationKey: string;

    // map [fork count, block height] => struct
    // we make the key a string to avoid double mapping
    private stateSnapshotStructsMap: Map<string, StateSnapshotStruct>;
    //map [stateSnapshotHash] => [fork count, block height]
    private hashToStateSnapshotKeyMap: Map<BytesLike, string>;
    //could be replaced with a key, but we would need some computation
    private latestOnChainStateSnapshot: {
        stateSnapshot: StateSnapshotStruct;
        timestamp: number;
    };

    private joinChannelBlockHashesMap: Map<string, BytesLike>;
    //TODO: check if BytesLike is more efficient than string
    // we can either store the hash or the key to the joinChannelBlockHashesMap data
    private latestJoinChannelBlockHash: BytesLike;

    private exitChannelBlockHashesMap: Map<string, BytesLike>;
    //TODO: check if BytesLike is more efficient than string
    // we can either store the hash or the key to the exitChannelBlockHashesMap data
    private latestExitChannelBlockHash: BytesLike;

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
        this.latestJoinChannelBlockHash = ethers.ZeroHash;
        this.latestExitChannelBlockHash = ethers.ZeroHash;
        this.hashToStateSnapshotKeyMap = new Map();
        this.latestBlockConfirmationKey = "0";
        console.log("StateSnapshotStorage initialized");
    }

    //#region Block confirmation management methods
    getPreviousBlockHash(
        forkCnt: number,
        transactionCnt: number
    ): string | undefined {
        // TODO
        return ethers.ZeroHash;
    }

    getLatestBlock(): UnrolledSignedBlock {
        const latestBlockConfirmation = this.getLatestBlockConfirmation();
        const latestSignedBlock = latestBlockConfirmation.signedBlock;
        const latestBlock = EvmUtils.decodeBlock(
            latestSignedBlock.encodedBlock
        );
        const stateSnapshot = this.getStateSnapshotByHash(
            latestBlock.stateSnapshotHash
        );

        const unrolledBlock: UnrolledBlock = {
            transaction: latestBlock.transaction,
            stateSnapshot: stateSnapshot,
            previousBlockHash: latestBlock.previousBlockHash
        };

        return {
            block: unrolledBlock,
            signature: latestSignedBlock.signature
        };
    }

    getLatestBlockConfirmation(): BlockConfirmationStruct {
        const confirmation = this.blockConfirmationStructsMap.get(
            this.latestBlockConfirmationKey
        );
        if (!confirmation) {
            throw new Error("No latest block confirmation found");
        }
        return confirmation;
    }

    getStateSnapshotByHash(hash: BytesLike): StateSnapshotStruct {
        const key = this.hashToStateSnapshotKeyMap.get(hash);
        if (!key) {
            throw new Error("No state snapshot key found for hash");
        }

        const snapshot = this.stateSnapshotStructsMap.get(key);
        if (!snapshot) {
            throw new Error("No state snapshot found for key");
        }

        return snapshot;
    }
    //#endregion

    //#region State snapshot management methods

    /**
     * Store a state snapshot
     */
    store(blockHeight: number, snapshot: StateSnapshotStruct) {
        const key = this.makeKey(Number(snapshot.forkCnt), blockHeight);
        this.stateSnapshotStructsMap.set(key, snapshot);
        const encodedStateSnapshot = Codec.encode(snapshot, Type.StateSnapshot);
        this.hashToStateSnapshotKeyMap.set(encodedStateSnapshot, key);

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

    getLatestJoinChannelBlockHash(): string {
        return hexlify(this.latestJoinChannelBlockHash);
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

    getLatestExitChannelBlockHash(): string {
        return hexlify(this.latestExitChannelBlockHash);
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

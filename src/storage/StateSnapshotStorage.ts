import { StateSnapshotStruct } from "@typechain-types/contracts/V1/DataTypes";

/**
 * StateSnapshotStorage provides persistent storage for state snapshots
 * organized by fork count and block height.
 */
export default class StateSnapshotStorage {
    // map [fork count, block height] => struct
    // we make the key a string to avoid double mapping
    private stateSnapshotStructsMap: Map<string, StateSnapshotStruct> =
        new Map();
    private joinChannelBlockHashesMap: Map<string, string> = new Map();
    private exitChannelBlockHashesMap: Map<string, string> = new Map();

    constructor() {
        this.stateSnapshotStructsMap = new Map();
        this.joinChannelBlockHashesMap = new Map();
        this.exitChannelBlockHashesMap = new Map();
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
    ): string | undefined {
        const key = this.makeKey(forkCnt, blockHeight);
        return this.joinChannelBlockHashesMap.get(key);
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
    ): string | undefined {
        const key = this.makeKey(forkCnt, blockHeight);
        return this.exitChannelBlockHashesMap.get(key);
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

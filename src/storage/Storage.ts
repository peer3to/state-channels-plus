import {
    StateSnapshotStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { BlockStorage } from "./BlockStorage";
import { JoinChannelBlockStorage } from "./JoinChannelBlockStorage";
import { ExitChannelBlockStorage } from "./ExitChannelBlockStorage";
import { StateSnapshotStorage } from "./StateSnapshotStorage";

import { Timestamp } from "@/types/types";

export class Storage {
    private blockStorage = new BlockStorage();
    private joinChannelBlockStorage = new JoinChannelBlockStorage();
    private exitChannelBlockStorage = new ExitChannelBlockStorage();
    private stateSnapshotStorage = new StateSnapshotStorage();

    private _cachedOnChainStateSnapshot:
        | {
              stateSnapshot: StateSnapshotStruct;
              timestamp: Timestamp;
          }
        | undefined;

    private latestSignedBlock: SignedBlockStruct | undefined;

    constructor() {
        // Auto-bind all methods
        this.bindMethods(this.blockStorage);
        this.bindMethods(this.joinChannelBlockStorage);
        this.bindMethods(this.exitChannelBlockStorage);
        this.bindMethods(this.stateSnapshotStorage);
    }

    private bindMethods(source: any) {
        Object.getOwnPropertyNames(Object.getPrototypeOf(source))
            .filter(
                (name) =>
                    typeof source[name] === "function" && name !== "constructor"
            )
            .forEach((name) => {
                (this as any)[name] = source[name].bind(source);
            });
    }

    // getLatestBlock(): {
    //     stateSnapshot: StateSnapshotStruct;
    //     block: BlockStruct;
    //     signature: BytesLike;
    // } {
    //     if (!this.latestSignedBlock) {
    //         throw new Error("No latest signed block found");
    //     }
    //     const block = Codec.decode(
    //         this.latestSignedBlock.encodedBlock,
    //         Type.Block
    //     );
    //     const stateSnapshotHash = block.stateSnapshotHash;
    //     const stateSnapshot = this.getStateSnapshotByHash(
    //         stateSnapshotHash as Hash
    //     );
    //     if (!stateSnapshot) {
    //         throw new Error("State snapshot not found");
    //     }
    //     return {
    //         stateSnapshot,
    //         block,
    //         signature: this.latestSignedBlock.signature
    //     };
    // }

    // getPreviousBlockHash(
    //     forkCnt: number,
    //     transactionCnt: number
    // ): BlockHash | undefined {
    //     return this.blockStorageModule.getPreviousBlockHash(
    //         forkCnt,
    //         transactionCnt
    //     );
    // }

    // ====================================
    // Cached on chain state snapshot
    // ====================================

    getCachedOnChainStateSnapshot() {
        return this._cachedOnChainStateSnapshot;
    }

    setCachedOnChainStateSnapshot(
        stateSnapshot: StateSnapshotStruct,
        timestamp: Timestamp
    ): void {
        this._cachedOnChainStateSnapshot = {
            stateSnapshot,
            timestamp
        };
    }
}

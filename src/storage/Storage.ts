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
    public readonly blocks = new BlockStorage();
    public readonly joinChannelBlocks = new JoinChannelBlockStorage();
    public readonly exitChannelBlocks = new ExitChannelBlockStorage();
    public readonly stateSnapshots = new StateSnapshotStorage();

    private _cachedOnChainStateSnapshot:
        | {
              stateSnapshot: StateSnapshotStruct;
              timestamp: Timestamp;
          }
        | undefined;

    private latestSignedBlock: SignedBlockStruct | undefined;

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

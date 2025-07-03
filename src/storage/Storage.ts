import {
    StateSnapshotStruct,
    BlockConfirmationStruct,
    ExitChannelBlockStruct,
    JoinChannelBlockStruct,
    SignedBlockStruct,
    BlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { BlockStorage } from "./BlockStorage";
import { JoinChannelBlockStorage } from "./JoinChannelBlockStorage";
import { ExitChannelBlockStorage } from "./ExitChannelBlockStorage";
import { StateSnapshotStorage } from "./StateSnapshotStorage";
import { Codec } from "@/utils";
import { Type } from "@/utils";
import { Hash, BlockHeight, ForkId } from "@/types/types";

export class Storage {
    private blockStorage = new BlockStorage();
    private joinChannelBlockStorage = new JoinChannelBlockStorage();
    private exitChannelBlockStorage = new ExitChannelBlockStorage();
    private stateSnapshotStorage = new StateSnapshotStorage();

    private _cachedOnChainStateSnapshot:
        | {
              stateSnapshot: StateSnapshotStruct;
              timestamp: number;
          }
        | undefined;

    private latestSignedBlock: SignedBlockStruct | undefined;

    // ====================================
    // BlockStorage
    // ====================================

    // C
    insertBlock = this.blockStorage.insertBlock.bind(this.blockStorage);

    // R
    getBlockConfirmation = this.blockStorage.getBlockConfirmation.bind(
        this.blockStorage
    );

    // U
    insertSignature = this.blockStorage.insertSignature.bind(this.blockStorage);

    // D
    deleteBlock = this.blockStorage.deleteBlock.bind(this.blockStorage);

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

    // ====================================
    // JoinChannelBlockStorage
    // ====================================

    // C
    storeJoinChannelBlock =
        this.joinChannelBlockStorage.storeJoinChannelBlock.bind(
            this.joinChannelBlockStorage
        );
    setTotalDeposits = this.joinChannelBlockStorage.setTotalDeposits.bind(
        this.joinChannelBlockStorage
    );

    // R
    getJoinChannelBlock = this.joinChannelBlockStorage.getJoinChannelBlock.bind(
        this.joinChannelBlockStorage
    );
    getLatestJoinChannelBlock =
        this.joinChannelBlockStorage.getLatestJoinChannelBlock.bind(
            this.joinChannelBlockStorage
        );
    getLatestJoinChannelBlockHash =
        this.joinChannelBlockStorage.getLatestJoinChannelBlockHash.bind(
            this.joinChannelBlockStorage
        );
    getTotalDeposits = this.joinChannelBlockStorage.getTotalDeposits.bind(
        this.joinChannelBlockStorage
    );

    // ====================================
    // ExitChannelBlockStorage
    // ====================================

    // C
    storeExitChannelBlock =
        this.exitChannelBlockStorage.storeExitChannelBlock.bind(
            this.exitChannelBlockStorage
        );
    setTotalWithdrawals = this.exitChannelBlockStorage.setTotalWithdrawals.bind(
        this.exitChannelBlockStorage
    );

    // R
    getExitChannelBlock = this.exitChannelBlockStorage.getExitChannelBlock.bind(
        this.exitChannelBlockStorage
    );
    getLatestExitChannelBlock =
        this.exitChannelBlockStorage.getLatestExitChannelBlock.bind(
            this.exitChannelBlockStorage
        );
    getLatestExitChannelBlockHash =
        this.exitChannelBlockStorage.getLatestExitChannelBlockHash.bind(
            this.exitChannelBlockStorage
        );
    getTotalWithdrawals = this.exitChannelBlockStorage.getTotalWithdrawals.bind(
        this.exitChannelBlockStorage
    );

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
    // StateSnapshotStorage
    // ====================================

    // C
    storeStateSnapshot = this.stateSnapshotStorage.storeStateSnapshot.bind(
        this.stateSnapshotStorage
    );

    // R
    getStateSnapshotByHash =
        this.stateSnapshotStorage.getStateSnapshotByHash.bind(
            this.stateSnapshotStorage
        );
    getPosteriorStateSnapshot =
        this.stateSnapshotStorage.getPosteriorStateSnapshot.bind(
            this.stateSnapshotStorage
        );

    // ====================================
    // Cached on chain state snapshot
    // ====================================

    getCachedOnChainStateSnapshot() {
        return this._cachedOnChainStateSnapshot;
    }

    setCachedOnChainStateSnapshot(
        stateSnapshot: StateSnapshotStruct,
        timestamp: number
    ): void {
        this._cachedOnChainStateSnapshot = {
            stateSnapshot,
            timestamp
        };
    }
}

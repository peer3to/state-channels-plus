import { BigNumberish, BytesLike } from "ethers";
import { IStorageModule } from "./interfaces/IStorageManager";
import {
    StateSnapshotStruct,
    BlockConfirmationStruct,
    ExitChannelBlockStruct,
    JoinChannelBlockStruct,
    SignedBlockStruct,
    BlockStruct
} from "@typechain-types/contracts/V1/DataTypes";
import { BlockStorageModule } from "./BlockStorage";
import { JoinChannelStorageModule } from "./JoinChannelStorage";
import { ExitChannelStorageModule } from "./ExitChannelStorage";
import { StateSnapshotStorageModule } from "./StateSnapshotStorage";
import { BlockHash, StateSnapshotHash } from "@/types/storage";
import { Codec } from "@/utils";
import { Type } from "@/utils";

export class StorageModule implements IStorageModule {
    //#region Global variables
    private blockStorageModule: BlockStorageModule = new BlockStorageModule();
    private joinChannelStorageModule: JoinChannelStorageModule =
        new JoinChannelStorageModule();
    private exitChannelStorageModule: ExitChannelStorageModule =
        new ExitChannelStorageModule();
    private stateSnapshotStorageModule: StateSnapshotStorageModule =
        new StateSnapshotStorageModule();

    private cachedOnChainStateSnapshot:
        | {
              stateSnapshot: StateSnapshotStruct;
              timestamp: number;
          }
        | undefined;

    private latestSignedBlock: SignedBlockStruct | undefined;

    //#endregion

    //#region BlockStorageModule

    insertBlock(signedBlock: SignedBlockStruct): void;
    insertBlock(
        signedBlock: SignedBlockStruct,
        blockHash: BlockHash,
        fork: number,
        height: number
    ): void;
    insertBlock(blockConfirmation: BlockConfirmationStruct): void;
    insertBlock(
        blockConfirmation: BlockConfirmationStruct,
        blockHash: BlockHash,
        fork: number,
        height: number
    ): void;
    insertBlock(
        blockData: SignedBlockStruct | BlockConfirmationStruct,
        blockHash?: BlockHash,
        fork?: number,
        height?: number
    ): void {
        const hasKeys =
            blockHash !== undefined &&
            fork !== undefined &&
            height !== undefined;
        if ("signedBlock" in blockData && "signatures" in blockData) {
            return hasKeys
                ? this.blockStorageModule.insertBlock(
                      blockData,
                      blockHash,
                      fork,
                      height
                  )
                : this.blockStorageModule.insertBlock(blockData);
        }

        return hasKeys
            ? this.blockStorageModule.insertBlock(
                  blockData,
                  blockHash,
                  fork,
                  height
              )
            : this.blockStorageModule.insertBlock(blockData);
    }

    getBlockConfirmation(
        blockHash: BlockHash
    ): BlockConfirmationStruct | undefined;
    getBlockConfirmation(
        fork: number,
        height: number
    ): BlockConfirmationStruct | undefined;
    getBlockConfirmation(
        blockHashOrFork: BlockHash | number,
        height?: number
    ): BlockConfirmationStruct | undefined {
        if (typeof blockHashOrFork === "string") {
            return this.blockStorageModule.getBlockConfirmation(
                blockHashOrFork
            );
        }

        if (typeof blockHashOrFork === "number" && height) {
            return this.blockStorageModule.getBlockConfirmation(
                blockHashOrFork,
                height
            );
        }

        return undefined;
    }

    deleteBlockConfirmation(blockHash: BlockHash): void;
    deleteBlockConfirmation(fork: number, height: number): void;
    deleteBlockConfirmation(
        blockHashOrFork: BlockHash | number,
        height?: number
    ): void {
        if (typeof blockHashOrFork === "string") {
            this.blockStorageModule.deleteBlockConfirmation(blockHashOrFork);
            return;
        }

        if (typeof blockHashOrFork === "number" && height) {
            this.blockStorageModule.deleteBlockConfirmation(
                blockHashOrFork,
                height
            );
        }
    }

    getLatestBlock(): {
        stateSnapshot: StateSnapshotStruct;
        block: BlockStruct;
        signature: BytesLike;
    } {
        if (!this.latestSignedBlock) {
            throw new Error("No latest signed block found");
        }
        const block = Codec.decode(
            this.latestSignedBlock.encodedBlock,
            Type.Block
        );
        const stateSnapshotHash = block.stateSnapshotHash;
        const stateSnapshot = this.getStateSnapshotByHash(
            stateSnapshotHash as StateSnapshotHash
        );
        if (!stateSnapshot) {
            throw new Error("State snapshot not found");
        }
        return {
            stateSnapshot,
            block,
            signature: this.latestSignedBlock.signature
        };
    }

    //#endregion

    //#region JoinChannelStorageModule

    storeJoinChannelBlockHash(
        blockHash: BlockHash,
        joinChannelBlock: JoinChannelBlockStruct
    ): void {
        this.joinChannelStorageModule.storeJoinChannelBlockHash(
            blockHash,
            joinChannelBlock
        );
    }

    getJoinChannelBlock(
        blockHash: BlockHash
    ): JoinChannelBlockStruct | undefined {
        return this.joinChannelStorageModule.getJoinChannelBlock(blockHash);
    }
    getLatestJoinChannelBlockHash(): BlockHash {
        return this.joinChannelStorageModule.getLatestJoinChannelBlockHash();
    }
    getTotalDeposits(): { amount: BigNumberish; data: string } {
        return this.joinChannelStorageModule.getTotalDeposits();
    }

    //#endregion

    //#region ExitChannelStorageModule

    storeExitChannelBlockHash(
        blockHash: BlockHash,
        exitChannelBlock: ExitChannelBlockStruct
    ): void {
        this.exitChannelStorageModule.storeExitChannelBlockHash(
            blockHash,
            exitChannelBlock
        );
    }
    getExitChannelBlock(
        blockHash: BlockHash
    ): ExitChannelBlockStruct | undefined {
        return this.exitChannelStorageModule.getExitChannelBlock(blockHash);
    }
    getLatestExitChannelBlockHash(): BlockHash {
        return this.exitChannelStorageModule.getLatestExitChannelBlockHash();
    }
    getTotalWithdrawals(): { amount: BigNumberish; data: string } {
        return this.exitChannelStorageModule.getTotalWithdrawals();
    }
    getPreviousBlockHash(
        forkCnt: number,
        transactionCnt: number
    ): BlockHash | undefined {
        return this.blockStorageModule.getPreviousBlockHash(
            forkCnt,
            transactionCnt
        );
    }

    //#endregion

    //#region StateSnapshotStorageModule

    storeStateSnapshot(snapshot: StateSnapshotStruct): void {
        this.stateSnapshotStorageModule.storeStateSnapshot(snapshot);
    }
    getStateSnapshot(
        forkCnt: number,
        blockHeight: number
    ): StateSnapshotStruct | undefined {
        return this.stateSnapshotStorageModule.getStateSnapshot(
            forkCnt,
            blockHeight
        );
    }
    getStateSnapshotByHash(
        stateSnapshotHash: StateSnapshotHash
    ): StateSnapshotStruct | undefined {
        return this.stateSnapshotStorageModule.getStateSnapshotByHash(
            stateSnapshotHash
        );
    }

    //#endregion

    //#region Cached on chain state snapshot

    getCachedOnChainStateSnapshot():
        | {
              stateSnapshot: StateSnapshotStruct;
              timestamp: number;
          }
        | undefined {
        return this.cachedOnChainStateSnapshot;
    }

    setCachedOnChainStateSnapshot(
        stateSnapshot: StateSnapshotStruct,
        timestamp: number
    ): void {
        if (!this.cachedOnChainStateSnapshot) {
            throw new Error("No cached on chain state snapshot found");
        }
        this.cachedOnChainStateSnapshot = {
            stateSnapshot,
            timestamp
        };
    }

    //#endregion
}

import type {
    Address,
    BlockHeight,
    ForkId,
    Hash,
    Timestamp
} from "@/types/types";
import type {
    BlockConfirmationStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";

export interface BlocksInterface {
    // --- reads: tip & lookup ---

    queryLatestBlock(
        forkId: ForkId
    ): Promise<{ hash: Hash; height: BlockHeight } | undefined>;

    queryBlockAt(req: {
        forkId: ForkId;
        height: BlockHeight;
    }): Promise<
        { hash: Hash; height: BlockHeight; author: Address } | undefined
    >;

    queryBlockByHash(hash: Hash): Promise<
        | {
              blockConfirmation: BlockConfirmationStruct;
              onChainTimestamp?: Timestamp;
              confirmationSignatures: string[];
          }
        | undefined
    >;

    // --- reads: confirmations ---

    queryBlockConfirmationAt(req: {
        forkId: ForkId;
        height: BlockHeight;
    }): Promise<
        | {
              blockConfirmation: BlockConfirmationStruct;
              onChainTimestamp?: Timestamp;
          }
        | undefined
    >;

    queryLatestBlockConfirmation(
        forkId: ForkId
    ): Promise<BlockConfirmationStruct | undefined>;

    queryPreviousBlockHash(req: {
        forkId: ForkId;
        height?: BlockHeight;
    }): Promise<Hash>;

    queryNextBlockHeight(forkId: ForkId): Promise<BlockHeight>;

    queryDidEveryoneSignBlock(blockHash: Hash): Promise<boolean>;

    // --- reads: inbound ---

    queryInboundLatestBlockHash(): Promise<Hash | undefined>;

    queryInboundLatestBlockHeight(): Promise<BlockHeight | undefined>;

    // --- writes ---

    queueBlock(req: {
        blockConfirmation: BlockConfirmationStruct;
        onChainTimestamp?: Timestamp;
    }): Promise<void>;

    postBlockCalldata(req: {
        signedBlock: SignedBlockStruct;
        maxTimestamp: Timestamp;
    }): Promise<void>;

    ingestBlockConfirmation(req: {
        blockConfirmation: BlockConfirmationStruct;
        ingestOptions?: { onChainTimestamp?: Timestamp };
    }): Promise<boolean>;
}

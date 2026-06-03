import type {
    Address,
    BlockHeight,
    ForkId,
    Hash,
    Signature,
    Timestamp
} from "@/types/types";
import type {
    BlockConfirmationStruct,
    SignedBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import type Block from "@/models/Block";

export interface BlocksInterface {
    // --- reads: tip & lookup ---

    queryLatestBlock(forkId: ForkId): Promise<Block | undefined>;

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
              confirmationSignatures: Signature[];
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

    queryBlockFullAt(req: {
        forkId: ForkId;
        height: BlockHeight;
    }): Promise<Block | undefined>;

    queryPreviousBlockHash(req: {
        forkId: ForkId;
        height?: BlockHeight;
    }): Promise<Hash>;

    queryNextBlockHeight(forkId: ForkId): Promise<BlockHeight>;

    // --- reads: inbound ---

    queryDidEveryoneSignBlock(blockHash: Hash): Promise<boolean>;

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

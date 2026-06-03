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
import type { BlocksInterface } from "../interfaces/BlocksInterface";
import type { PeerCaller } from "../../threaded/rpc/PeerCaller";
import { ROUTES } from "../../threaded/worker/routeNames";
import { Block } from "@/models";

export class WorkerBlocksHandle implements BlocksInterface {
    constructor(private readonly rpc: PeerCaller) {}

    async queryLatestBlock(forkId: ForkId): Promise<Block | undefined> {
        const confirmation = await this.queryLatestBlockConfirmation(forkId);
        return confirmation
            ? Block.fromBlockConfirmation(confirmation)
            : undefined;
    }

    queryBlockAt(req: {
        forkId: ForkId;
        height: BlockHeight;
    }): Promise<
        { hash: Hash; height: BlockHeight; author: Address } | undefined
    > {
        return this.rpc.call(ROUTES.query.blockAt, req) as Promise<
            { hash: Hash; height: BlockHeight; author: Address } | undefined
        >;
    }

    queryBlockByHash(hash: Hash): Promise<
        | {
              blockConfirmation: BlockConfirmationStruct;
              onChainTimestamp?: Timestamp;
              confirmationSignatures: Signature[];
          }
        | undefined
    > {
        return this.rpc.call(ROUTES.query.blockByHash, { hash }) as Promise<
            | {
                  blockConfirmation: BlockConfirmationStruct;
                  onChainTimestamp?: Timestamp;
                  confirmationSignatures: Signature[];
              }
            | undefined
        >;
    }

    queryBlockConfirmationAt(req: {
        forkId: ForkId;
        height: BlockHeight;
    }): Promise<
        | {
              blockConfirmation: BlockConfirmationStruct;
              onChainTimestamp?: Timestamp;
          }
        | undefined
    > {
        return this.rpc.call(ROUTES.query.blockConfirmationAt, req) as Promise<
            | {
                  blockConfirmation: BlockConfirmationStruct;
                  onChainTimestamp?: Timestamp;
              }
            | undefined
        >;
    }

    queryLatestBlockConfirmation(
        forkId: ForkId
    ): Promise<BlockConfirmationStruct | undefined> {
        return this.rpc.call(ROUTES.query.latestBlockConfirmation, {
            forkId
        }) as Promise<BlockConfirmationStruct | undefined>;
    }

    async queryBlockFullAt(req: {
        forkId: ForkId;
        height: BlockHeight;
    }): Promise<Block | undefined> {
        const r = await this.queryBlockConfirmationAt(req);
        return r
            ? Block.fromBlockConfirmation(
                  r.blockConfirmation,
                  r.onChainTimestamp
              )
            : undefined;
    }

    queryPreviousBlockHash(req: {
        forkId: ForkId;
        height?: BlockHeight;
    }): Promise<Hash> {
        return this.rpc.call(
            ROUTES.query.previousBlockHash,
            req
        ) as Promise<Hash>;
    }

    queryNextBlockHeight(forkId: ForkId): Promise<BlockHeight> {
        return this.rpc.call(ROUTES.query.nextBlockHeight, {
            forkId
        }) as Promise<BlockHeight>;
    }

    queryDidEveryoneSignBlock(blockHash: Hash): Promise<boolean> {
        return this.rpc.call(ROUTES.query.didEveryoneSignBlock, {
            blockHash
        }) as Promise<boolean>;
    }

    queryInboundLatestBlockHash(): Promise<Hash | undefined> {
        return this.rpc.call(
            ROUTES.query.inboundLatestBlockHash,
            {}
        ) as Promise<Hash | undefined>;
    }

    queryInboundLatestBlockHeight(): Promise<BlockHeight | undefined> {
        return this.rpc.call(
            ROUTES.query.inboundLatestBlockHeight,
            {}
        ) as Promise<BlockHeight | undefined>;
    }

    queueBlock(req: {
        blockConfirmation: BlockConfirmationStruct;
        onChainTimestamp?: Timestamp;
    }): Promise<void> {
        return this.rpc.call(ROUTES.queue.block, req) as Promise<void>;
    }

    postBlockCalldata(req: {
        signedBlock: SignedBlockStruct;
        maxTimestamp: Timestamp;
    }): Promise<void> {
        return this.rpc.call(
            ROUTES.contract.postBlockCalldata,
            req
        ) as Promise<void>;
    }

    ingestBlockConfirmation(req: {
        blockConfirmation: BlockConfirmationStruct;
        ingestOptions?: { onChainTimestamp?: Timestamp };
    }): Promise<boolean> {
        return this.rpc.call(
            ROUTES.ingest.blockConfirmation,
            req
        ) as Promise<boolean>;
    }
}

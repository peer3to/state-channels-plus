import { ZeroHash } from "ethers";
import { Block } from "@/models";
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
import type { TestPeer } from "../types";

export class InlineBlocksHandle implements BlocksInterface {
    constructor(private readonly peer: TestPeer) {}

    async queryLatestBlock(forkId: ForkId): Promise<Block | undefined> {
        return this.peer.stateManager.storage.blocks.getLatestBlock(forkId);
    }

    async queryBlockAt(req: {
        forkId: ForkId;
        height: BlockHeight;
    }): Promise<
        { hash: Hash; height: BlockHeight; author: Address } | undefined
    > {
        const block = this.peer.stateManager.storage.blocks.getBlock(
            req.forkId,
            req.height
        );
        if (!block) return undefined;
        return { hash: block.hash, height: block.height, author: block.author };
    }

    async queryBlockByHash(hash: Hash): Promise<
        | {
              blockConfirmation: BlockConfirmationStruct;
              onChainTimestamp?: Timestamp;
              confirmationSignatures: Signature[];
          }
        | undefined
    > {
        const block = this.peer.stateManager.storage.blocks.getBlock(hash);
        if (!block) return undefined;
        return {
            blockConfirmation: block.blockConfirmationStruct,
            onChainTimestamp: block.onChainTimestamp,
            confirmationSignatures: Array.from(
                block.confirmationSignatures
            ).map((s) => String(s))
        };
    }

    async queryBlockConfirmationAt(req: {
        forkId: ForkId;
        height: BlockHeight;
    }): Promise<
        | {
              blockConfirmation: BlockConfirmationStruct;
              onChainTimestamp?: Timestamp;
          }
        | undefined
    > {
        const block = this.peer.stateManager.storage.blocks.getBlock(
            req.forkId,
            req.height
        );
        if (!block) return undefined;
        return {
            blockConfirmation: block.blockConfirmationStruct,
            onChainTimestamp: block.onChainTimestamp
        };
    }

    async queryLatestBlockConfirmation(
        forkId: ForkId
    ): Promise<BlockConfirmationStruct | undefined> {
        return this.peer.stateManager.storage.blocks.getLatestBlock(forkId)
            ?.blockConfirmationStruct;
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

    async queryPreviousBlockHash(req: {
        forkId: ForkId;
        height?: BlockHeight;
    }): Promise<Hash> {
        const storage = this.peer.stateManager.storage;
        if (req.height !== undefined) {
            const prev = storage.getPreviousBlockOrSnapshot({
                forkId: req.forkId,
                height: req.height
            });
            return prev.block?.hash ?? prev.stateSnapshot!.hash;
        }
        const previousBlock = storage.blocks.getLatestBlock(req.forkId);
        if (previousBlock?.hash) return previousBlock.hash;
        const genesis = storage.stateSnapshots.getGenesisSnapshotByForkId(
            req.forkId
        );
        return genesis?.hash ?? ZeroHash;
    }

    async queryNextBlockHeight(forkId: ForkId): Promise<BlockHeight> {
        return this.peer.stateManager.storage.blocks.getNextBlockHeight(forkId);
    }

    async queryDidEveryoneSignBlock(blockHash: Hash): Promise<boolean> {
        const block = this.peer.stateManager.storage.blocks.getBlock(blockHash);
        if (!block) return false;
        return this.peer.stateManager.agreementManager.didEveryoneSignBlock(
            block
        );
    }

    async queryInboundLatestBlockHash(): Promise<Hash | undefined> {
        return this.peer.stateManager.storage.inboundMessages.getLatestBlockHash();
    }

    async queryInboundLatestBlockHeight(): Promise<BlockHeight | undefined> {
        return this.peer.stateManager.storage.inboundMessages.getLatestBlockHeight();
    }

    async queueBlock(req: {
        blockConfirmation: BlockConfirmationStruct;
        onChainTimestamp?: Timestamp;
    }): Promise<void> {
        const block = Block.fromBlockConfirmation(
            req.blockConfirmation,
            req.onChainTimestamp
        );
        this.peer.stateManager.storage.queues.queueBlock(block);
    }

    async postBlockCalldata(req: {
        signedBlock: SignedBlockStruct;
        maxTimestamp: Timestamp;
    }): Promise<void> {
        const tx =
            await this.peer.stateManager.stateChannelManagerContract.postBlockCalldata(
                req.signedBlock,
                req.maxTimestamp
            );
        await tx.wait();
    }

    async ingestBlockConfirmation(req: {
        blockConfirmation: BlockConfirmationStruct;
        ingestOptions?: { onChainTimestamp?: Timestamp };
    }): Promise<boolean> {
        return await this.peer.stateManager.ingestBlockConfirmation(
            req.blockConfirmation,
            req.ingestOptions
        );
    }
}

import { Block } from "@/models";
import type {
    Address,
    BlockCalldata,
    BlockHeight,
    ForkId
} from "@/types/types";

import {
    PersistentCollection,
    type PersistenceController
} from "./persistence";

type CalldataCoordinateKey = string;

export class BlockCalldataStorage {
    // ====================================
    // STORAGE MAPS
    // ====================================
    private readonly blocks: PersistentCollection<
        CalldataCoordinateKey,
        BlockCalldata
    >;

    constructor(controller?: PersistenceController) {
        this.blocks = new PersistentCollection("blockCalldata", controller);
    }

    // ====================================
    // CREATE
    // ====================================

    public storeBlockCalldata(
        blockCalldata: BlockCalldata
    ): CalldataCoordinateKey {
        const block = Block.fromSignedBlock(
            blockCalldata.signedBlock,
            blockCalldata.onChainTimestamp
        );
        const coordinateKey = this.buildCoordinateKey(
            block.forkId,
            block.height,
            block.author
        );
        this.blocks.set(coordinateKey, blockCalldata);
        return coordinateKey;
    }

    // ====================================
    // READ
    // ====================================

    public getBlockCalldata(
        forkId: ForkId,
        height: BlockHeight,
        blockAuthor: Address
    ): BlockCalldata | undefined {
        return this.blocks.get(
            this.buildCoordinateKey(forkId, height, blockAuthor)
        );
    }

    public getMatchingBlockCalldata(block: Block): BlockCalldata | undefined {
        const calldata = this.getBlockCalldata(
            block.forkId,
            block.height,
            block.author
        );
        if (!calldata) return undefined;
        return Block.fromSignedBlock(calldata.signedBlock).hash === block.hash
            ? calldata
            : undefined;
    }

    private buildCoordinateKey(
        forkId: ForkId,
        height: BlockHeight,
        blockAuthor: Address
    ): CalldataCoordinateKey {
        return `${forkId}:${height}:${blockAuthor}`;
    }
}

import { ForkId, BlockHeight, BlockCalldata, Address } from "@/types/types";
import { Block } from "@/models";

type CalldataCoordinateKey = string;

export class BlockCalldataStorage {
    // ====================================
    // STORAGE MAPS
    // ====================================
    private coordinatesToBlockMap: Map<CalldataCoordinateKey, BlockCalldata>;

    constructor() {
        this.coordinatesToBlockMap = new Map();
    }

    // ====================================
    // CREATE
    // ====================================

    storeBlockCalldata(blockCalldata: BlockCalldata): CalldataCoordinateKey {
        const block: Block = Block.fromSignedBlock(
            blockCalldata.signedBlock,
            blockCalldata.onChainTimestamp
        );
        const coordinateKey = this.buildCoordinateKey(
            block.forkId,
            block.height,
            block.author
        );
        this.coordinatesToBlockMap.set(coordinateKey, blockCalldata);
        return coordinateKey;
    }

    // ====================================
    // READ
    // ====================================

    getBlockCalldata(
        forkId: ForkId,
        height: BlockHeight,
        blockAuthor: Address
    ): BlockCalldata | undefined {
        const coordinateKey = this.buildCoordinateKey(
            forkId,
            height,
            blockAuthor
        );
        return this.coordinatesToBlockMap.get(coordinateKey);
    }

    getMatchingBlockCalldata(block: Block): BlockCalldata | undefined {
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

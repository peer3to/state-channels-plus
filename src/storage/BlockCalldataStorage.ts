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
        const coordinateKey = `${block.forkId}:${block.height}:${block.author}`;
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
        const coordinateKey = `${forkId}:${height}:${blockAuthor}`;
        return this.coordinatesToBlockMap.get(coordinateKey);
    }
}

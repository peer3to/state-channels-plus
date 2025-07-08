import { BlockHeight, ForkId } from "@/types/types";

export class ExitPointsStorage {
    private map: Map<ForkId, Set<BlockHeight>>;

    constructor() {
        this.map = new Map();
    }

    // ====================================
    // CREATE
    // ====================================

    storeExitPoint(forkId: ForkId, blockHeight: BlockHeight): Set<BlockHeight> {
        const exitPoints = this.map.get(forkId) ?? new Set();
        exitPoints.add(blockHeight);
        this.map.set(forkId, exitPoints);

        return this.map.get(forkId) as Set<BlockHeight>;
    }

    // ====================================
    // READ
    // ====================================

    getExitPointsInRange(
        forkId: ForkId,
        start?: BlockHeight,
        end?: BlockHeight
    ): BlockHeight[] {
        const exitPoints = this.map.get(forkId);
        if (!exitPoints?.size) {
            return [];
        }

        // invalid range
        if (start !== undefined && end !== undefined && end <= start) {
            return [];
        }
        const list = Array.from(exitPoints).sort(
            (a, b) => Number(a) - Number(b)
        );

        if (start === undefined && end === undefined) {
            return list;
        }

        const actualStart = start ?? list[0];
        const actualEnd = end ?? list[list.length - 1] + 1;

        const filteredExitPoints = list.filter(
            (height) => height >= actualStart && height < actualEnd
        );

        return filteredExitPoints;
    }
}

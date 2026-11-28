import { BlockHeight, ForkId } from "@/types/types";

export class ParticipantSetChangeStorage {
    private map: Map<ForkId, Set<BlockHeight>>;

    constructor() {
        this.map = new Map();
    }

    // ====================================
    // CREATE
    // ====================================

    storeChangePoint(
        forkId: ForkId,
        blockHeight: BlockHeight
    ): Set<BlockHeight> {
        const changePoints = this.map.get(forkId) ?? new Set();
        changePoints.add(blockHeight);
        this.map.set(forkId, changePoints);

        return this.map.get(forkId) as Set<BlockHeight>;
    }

    // ====================================
    // READ
    // ====================================

    getChangePointsInRange(
        forkId: ForkId,
        start?: BlockHeight,
        end?: BlockHeight
    ): BlockHeight[] {
        const changePoints = this.map.get(forkId);
        if (!changePoints?.size) {
            return [];
        }

        // invalid range
        if (start !== undefined && end !== undefined && end <= start) {
            return [];
        }
        const list = Array.from(changePoints).sort(
            (a, b) => Number(a) - Number(b)
        );

        if (start === undefined && end === undefined) {
            return list;
        }

        const actualStart = start ?? list[0];
        const actualEnd = end ?? list[list.length - 1] + 1;

        const filteredChangePoints = list.filter(
            (height) => height >= actualStart && height <= actualEnd
        );

        return filteredChangePoints;
    }

    // ====================================
    // DELETE
    // ====================================

    /** Deletes the change points of `forkId` below `height`; returns how many. */
    deleteChangePointsBelow(forkId: ForkId, height: BlockHeight): number {
        const changePoints = this.map.get(forkId);
        if (!changePoints) return 0;
        let deletedCount = 0;
        for (const changeHeight of changePoints)
            if (changeHeight < height) {
                changePoints.delete(changeHeight);
                deletedCount++;
            }
        return deletedCount;
    }

    /** Deletes every change point of `forkId`; returns how many. */
    deleteFork(forkId: ForkId): number {
        const deletedCount = this.map.get(forkId)?.size ?? 0;
        this.map.delete(forkId);
        return deletedCount;
    }
}

import { BlockHeight, ForkId } from "@/types/types";

export class ParticipantSetChangeStorage {
    private map: Map<ForkId, Set<BlockHeight>>;

    constructor() {
        this.map = new Map();
    }

    // ====================================
    // PERSISTENCE
    // ====================================

    /** The persistence engine's view of this store's PRIMARY map. */
    *persistableEntries(): Iterable<[ForkId, Set<BlockHeight>]> {
        yield* this.map;
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
}

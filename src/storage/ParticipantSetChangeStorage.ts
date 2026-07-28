import type { BlockHeight, ForkId } from "@/types/types";

import {
    PersistentCollection,
    type PersistenceController
} from "./persistence";

export class ParticipantSetChangeStorage {
    private readonly changes: PersistentCollection<ForkId, Set<BlockHeight>>;

    constructor(controller?: PersistenceController) {
        this.changes = new PersistentCollection(
            "participantSetChanges",
            controller
        );
    }

    // ====================================
    // CREATE
    // ====================================

    public storeChangePoint(
        forkId: ForkId,
        blockHeight: BlockHeight
    ): Set<BlockHeight> {
        const updated = this.changes.update(forkId, (changePoints) => {
            const next = changePoints ?? new Set<BlockHeight>();
            next.add(blockHeight);
            return next;
        });
        return updated!;
    }

    // ====================================
    // READ
    // ====================================

    public getChangePointsInRange(
        forkId: ForkId,
        start?: BlockHeight,
        end?: BlockHeight
    ): BlockHeight[] {
        const changePoints = this.changes.get(forkId);
        if (!changePoints?.size) return [];

        // invalid range
        if (start !== undefined && end !== undefined && end <= start) return [];

        const list = [...changePoints].sort((a, b) => a - b);
        if (start === undefined && end === undefined) return list;

        const actualStart = start ?? list[0];
        const actualEnd = end ?? list[list.length - 1] + 1;
        return list.filter(
            (height) => height >= actualStart && height <= actualEnd
        );
    }
}

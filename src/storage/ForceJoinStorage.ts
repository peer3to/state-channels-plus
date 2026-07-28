import type { BlockHeight } from "@/types/types";

import {
    PersistentCollection,
    type PersistenceController
} from "./persistence";

type ForceJoinKey = "value";

export class ForceJoinStorage {
    private readonly value: PersistentCollection<ForceJoinKey, BlockHeight>;

    constructor(controller?: PersistenceController) {
        this.value = new PersistentCollection("forceJoin", controller);
    }

    public setJoinSubmissionBlockHeight(height: BlockHeight): void {
        this.value.set("value", height);
    }

    public getJoinSubmissionBlockHeight(): BlockHeight | undefined {
        return this.value.get("value");
    }

    public clear(): void {
        this.value.delete("value");
    }
}

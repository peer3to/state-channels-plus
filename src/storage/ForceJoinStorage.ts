import {
    PersistentCollection,
    type PersistenceController
} from "./persistence";
import { BlockHeight } from "@/types/types";

/** This runtime's submitted join, until it is seated or ends. */
export type JoinRecord = {
    /** Identifies one submission: an update for an earlier one changes nothing. */
    id: number;
    submissionHeight: BlockHeight;
    /** Chain seconds after which no block admits the join. */
    authorizationDeadline: number;
    /** Set once the join is observed on chain: blocks committed from then count toward the force-join bound. */
    countingStartsAt?: number;
    /** The first and the latest block counted toward the bound. */
    countingFromHeight?: BlockHeight;
    latestCountedHeight?: BlockHeight;
    isForceJoinDeadlinePassed: boolean;
    isDisputeStarted: boolean;
    /** A refused submission whose retry is being decided or collected: its expiry and checks are retired. */
    isRetrying?: boolean;
};

export type JoinUpdate = Partial<
    Omit<JoinRecord, "id" | "submissionHeight" | "authorizationDeadline">
>;

type ForceJoinKey = "value";

export class ForceJoinStorage {
    private readonly value: PersistentCollection<ForceJoinKey, JoinRecord>;
    private nextJoinId = 0;

    constructor(controller?: PersistenceController) {
        // a new join never reuses a loaded join's id
        this.value = new PersistentCollection("forceJoin", controller, () => {
            const join = this.value.get("value");
            if (join) this.nextJoinId = join.id + 1;
        });
    }

    startJoin(
        submissionHeight: BlockHeight,
        authorizationDeadline: number
    ): JoinRecord {
        return this.value.set("value", {
            id: this.nextJoinId++,
            submissionHeight,
            authorizationDeadline,
            isForceJoinDeadlinePassed: false,
            isDisputeStarted: false
        });
    }

    getJoin(): JoinRecord | undefined {
        return this.value.get("value");
    }

    /** Applies `update` to the join `id`; false when it is no longer the current join. */
    updateJoin(id: number, update: JoinUpdate): boolean {
        if (this.value.get("value")?.id !== id) return false;
        this.value.update("value", (join) => join && { ...join, ...update });
        return true;
    }

    clear(): void {
        this.value.delete("value");
    }
}

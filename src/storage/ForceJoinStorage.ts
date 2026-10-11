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

export class ForceJoinStorage {
    private join?: JoinRecord;
    private nextJoinId = 0;

    startJoin(
        submissionHeight: BlockHeight,
        authorizationDeadline: number
    ): JoinRecord {
        this.join = {
            id: this.nextJoinId++,
            submissionHeight,
            authorizationDeadline,
            isForceJoinDeadlinePassed: false,
            isDisputeStarted: false
        };
        return this.join;
    }

    getJoin(): JoinRecord | undefined {
        return this.join;
    }

    /** Applies `update` to the join `id`; false when it is no longer the current join. */
    updateJoin(id: number, update: JoinUpdate): boolean {
        if (this.join?.id !== id) return false;
        Object.assign(this.join, update);
        return true;
    }

    clear(): void {
        this.join = undefined;
    }
}

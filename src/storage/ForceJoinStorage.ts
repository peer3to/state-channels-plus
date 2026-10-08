import { BlockHeight } from "@/types/types";

export class ForceJoinStorage {
    private joinSubmissionBlockHeight?: BlockHeight;
    /** Chain seconds of the join authorization's deadlineTimestamp; no block after it admits the join. */
    private joinAuthorizationDeadline?: number;
    /** Seconds from which committed blocks count toward the block bound, once the join is on chain. */
    private countingStartsAt?: number;
    /** The first block counted once counting started; the bound counts from it. */
    private countingFromHeight?: BlockHeight;
    private disputeStarted = false;

    setJoinSubmissionBlockHeight(height: BlockHeight): void {
        this.joinSubmissionBlockHeight = height;
    }

    getJoinSubmissionBlockHeight(): BlockHeight | undefined {
        return this.joinSubmissionBlockHeight;
    }

    setJoinAuthorizationDeadline(seconds: number): void {
        this.joinAuthorizationDeadline = seconds;
    }

    getJoinAuthorizationDeadline(): number | undefined {
        return this.joinAuthorizationDeadline;
    }

    setCountingStartsAt(seconds: number): void {
        this.countingStartsAt = seconds;
    }

    getCountingStartsAt(): number | undefined {
        return this.countingStartsAt;
    }

    setCountingFromHeight(height: BlockHeight): void {
        this.countingFromHeight = height;
    }

    getCountingFromHeight(): BlockHeight | undefined {
        return this.countingFromHeight;
    }

    setDisputeStarted(): void {
        this.disputeStarted = true;
    }

    hasDisputeStarted(): boolean {
        return this.disputeStarted;
    }

    clear(): void {
        this.joinSubmissionBlockHeight = undefined;
        this.joinAuthorizationDeadline = undefined;
        this.countingStartsAt = undefined;
        this.countingFromHeight = undefined;
        this.disputeStarted = false;
    }
}

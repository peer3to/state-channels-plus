import { BlockHeight } from "@/types/types";

export class ForceJoinStorage {
    private joinSubmissionBlockHeight?: BlockHeight;
    /** Chain seconds of the join authorization's deadlineTimestamp; no block after it admits the join. */
    private joinAuthorizationDeadline?: number;
    /** Seconds from which a block's timestamp counts toward the block bound, once the join is on chain. */
    private countingStartsAt?: number;
    /** The first block counted once counting started; the bound counts from it. */
    private countingFromHeight?: BlockHeight;
    /** A bound fired: the dispute was requested, or the chain's evidence window refused it. */
    private boundFired = false;

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

    setBoundFired(): void {
        this.boundFired = true;
    }

    hasBoundFired(): boolean {
        return this.boundFired;
    }

    clear(): void {
        this.joinSubmissionBlockHeight = undefined;
        this.joinAuthorizationDeadline = undefined;
        this.countingStartsAt = undefined;
        this.countingFromHeight = undefined;
        this.boundFired = false;
    }
}

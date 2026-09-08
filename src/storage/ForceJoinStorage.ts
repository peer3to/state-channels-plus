import { BlockHeight } from "@/types/types";

export class ForceJoinStorage {
    private joinSubmissionBlockHeight?: BlockHeight;
    private disputeStarted = false;

    setJoinSubmissionBlockHeight(height: BlockHeight): void {
        this.joinSubmissionBlockHeight = height;
    }

    getJoinSubmissionBlockHeight(): BlockHeight | undefined {
        return this.joinSubmissionBlockHeight;
    }

    setDisputeStarted(): void {
        this.disputeStarted = true;
    }

    hasDisputeStarted(): boolean {
        return this.disputeStarted;
    }

    clear(): void {
        this.joinSubmissionBlockHeight = undefined;
        this.disputeStarted = false;
    }
}

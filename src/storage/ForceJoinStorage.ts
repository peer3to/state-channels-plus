import { BlockHeight } from "@/types/types";

export class ForceJoinStorage {
    private joinSubmissionBlockHeight?: BlockHeight;

    setJoinSubmissionBlockHeight(height: BlockHeight): void {
        this.joinSubmissionBlockHeight = height;
    }

    getJoinSubmissionBlockHeight(): BlockHeight | undefined {
        return this.joinSubmissionBlockHeight;
    }

    clear(): void {
        this.joinSubmissionBlockHeight = undefined;
    }
}

import type { ChecksumAddress } from "@/types/types";

/**
 * Why a threshold participant gave no valid join countersignature:
 * "unreachable": no transport after the reachability grace;
 * "no-answer": the request failed (timeout, disconnect, remote error);
 * "wrong-signer": the answer is not this participant's signature.
 */
export type JoinCollectionFailureReason =
    | "unreachable"
    | "no-answer"
    | "wrong-signer";

export type JoinCollectionFailure = {
    participant: ChecksumAddress;
    reason: JoinCollectionFailureReason;
    detail: string;
};

/**
 * The network gave no valid countersignature from one or more threshold
 * participants, so no join confirmation exists. Chain reads and local
 * signing never raise this error.
 */
export class JoinCollectionError extends Error {
    constructor(readonly failures: JoinCollectionFailure[]) {
        super(
            `collectJoinChannelConfirmation: collection failed: ${failures
                .map(
                    ({ participant, reason, detail }) =>
                        `${participant} (${reason}: ${detail})`
                )
                .join(", ")}`
        );
        this.name = "JoinCollectionError";
    }
}

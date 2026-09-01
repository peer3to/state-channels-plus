export enum BlockValidationResult {
    SUCCESS,
    NOT_READY,
    DISCONNECT,
    DISPUTE,
    BROADCAST,
    NOT_ENOUGH_TIME,
    DUPLICATE
}

export enum Status {
    /** Active caller-owned lobby topic with no selected channel ID. */
    DISCOVERING,
    /** No open channel; may hold one concrete pre-open channel target. */
    NOT_OPENED,
    /** The selected channel is open on-chain but not yet locally synced. */
    OPENED,
    /** The selected channel is synced; the signer is not a participant. */
    SYNCED,
    /** An on-chain join is waiting for inclusion in channel state. */
    PENDING_PARTICIPANT,
    /** The selected channel is synced and the signer participates. */
    PARTICIPATING
}

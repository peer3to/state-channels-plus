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
    NOT_OPENED,
    OPENED,
    SYNCED,
    PENDING_PARTICIPANT, // initiated join on-chain, waiting for inclusion in the state
    PARTICIPATING
}

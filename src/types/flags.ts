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
    PARTICIPATING
}

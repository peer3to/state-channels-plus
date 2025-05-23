export enum ExecutionFlags {
    SUCCESS,
    NOT_READY,
    DUPLICATE,
    DISCONNECT,
    DISPUTE,
    TIMESTAMP_IN_FUTURE,
    NOT_ENOUGH_TIME,
    PAST_FORK
}

export enum AgreementFlag {
    INVALID_SIGNATURE,
    READY,
    DUPLICATE,
    INCORRECT_DATA,
    DOUBLE_SIGN,
    NOT_READY
}

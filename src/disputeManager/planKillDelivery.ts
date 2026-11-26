/** How a kill sent with our own dispute upload goes out. */
export enum KillDelivery {
    /** first in the upload's multicall */
    InMulticall,
    /** alone ahead of the upload: both do not fit one transaction */
    Alone,
    /** not at all: the kill alone does not fit one transaction */
    NotSent
}

/**
 * Where the kill goes, from the calldata bytes of the kill alone and of the
 * multicall that holds the kill and the upload. Our upload lists none of the
 * kill's slashes, so it never depends on the kill landing.
 */
export function planKillDelivery(
    killBytes: number,
    multicallBytes: number,
    maxTransactionBytes: number
): KillDelivery {
    if (killBytes > maxTransactionBytes) return KillDelivery.NotSent;
    if (multicallBytes > maxTransactionBytes) return KillDelivery.Alone;
    return KillDelivery.InMulticall;
}

const ERROR_PEER_ADDRESS_KEY = Symbol.for("peer3.errorOriginPeerAddress");

/** Read the originating peer address previously stamped onto an error. */
export function getErrorPeerAddress(error: unknown): string | undefined {
    if (typeof error !== "object" || error === null) return undefined;
    const value = (error as Record<symbol, unknown>)[ERROR_PEER_ADDRESS_KEY];
    return typeof value === "string" ? value : undefined;
}

/**
 * Stamp `error` with the originating peer address. No-op when the address is
 * missing, the error isn't an object, or a stamp already exists — an existing
 * stamp is never overwritten, so the true origin wins over a later fallback.
 */
export function maybeStampErrorWithPeerAddress(
    error: unknown,
    peerAddress: string | undefined
): void {
    if (!peerAddress) return;
    if (typeof error !== "object" || error === null) return;
    if (getErrorPeerAddress(error) !== undefined) return;
    Object.defineProperty(error, ERROR_PEER_ADDRESS_KEY, {
        value: peerAddress,
        enumerable: false,
        configurable: true,
        writable: true
    });
}

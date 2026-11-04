/** The mirror cannot answer now; the request goes to the RPC node. */
export class MirrorUnavailableError extends Error {
    /** What made the mirror unavailable, if something failed. */
    readonly cause?: unknown;

    constructor(message: string, options?: { cause?: unknown }) {
        super(message);
        this.cause = options?.cause;
    }
}

/**
 * The call would run here differently from the node (PolkaVM code, or an
 * address the chain serves with its own precompile): the whole top-level call
 * goes to the node.
 */
export class NotLocalError extends MirrorUnavailableError {}

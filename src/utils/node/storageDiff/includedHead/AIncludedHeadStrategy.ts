import type { Logger } from "@/utils";

/** An upstream (eth) block the included-head strategy reports. */
export interface IncludedHead {
    number: bigint;
    /** Lower-case eth block hash. */
    hash: string;
}

/** What the service offers a strategy; the strategy never sees the service. */
export interface IncludedHeadHost {
    logger: Logger;
    /** A request to the service's upstream node. */
    request: (method: string, params: unknown[]) => Promise<unknown>;
    /** Reports the included head; resolves once the service applied it. */
    advance: (head: IncludedHead) => Promise<void>;
    /** The strategy cannot continue: the service fails. */
    fail: (error: Error) => void;
}

/**
 * Where the "included" level comes from: the newest block the chain treats as
 * final for events and irreversible actions. Inclusion of a block covers all
 * its ancestors. Strategies only report heads; the service owns what a head
 * means for peers (push, catch-up) and for the best chain (ancestry check).
 */
export default abstract class AIncludedHeadStrategy {
    /**
     * Starts following. Resolves after the first included head was reported,
     * so catch-up can answer with it at once. Rejects when it cannot start.
     */
    public abstract start(host: IncludedHeadHost): Promise<void>;

    /** Idempotent: stops following and drops connections. */
    public abstract close(): void;

    /**
     * The service committed a new best head. Strategies derived from the
     * upstream's own head react here; those fed by another chain ignore it.
     * Must not block: it runs inside the service's reconciliation.
     */
    public abstract bestHeadCommitted(head: IncludedHead): void;
}

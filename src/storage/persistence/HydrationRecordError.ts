export type HydrationRecordFailure = {
    namespace: string;
    key: string;
    err: unknown;
};

/**
 * Thrown by PersistenceEngine.hydrateAll() when one or more durable records
 * failed to decode/replay. Fail-closed (FR2): a commit is one durable
 * transaction, so a record that fails to decode is corruption of already-
 * committed state, not an incomplete write - it is never safe to infer
 * "recoverable crash-truncation" and resume anyway. Propagates through
 * Storage.hydrate() so the caller (P2pRuntimeHost.ensurePersistenceForChannel)
 * fails the channel bind.
 */
export class HydrationRecordError extends Error {
    public readonly failures: HydrationRecordFailure[];

    constructor(failures: HydrationRecordFailure[]) {
        super(
            `Hydration failed to decode/replay ${failures.length} record(s): ${failures
                .map((f) => `${f.namespace}/${f.key}`)
                .join(", ")}`
        );
        this.name = "HydrationRecordError";
        this.failures = failures;
    }
}

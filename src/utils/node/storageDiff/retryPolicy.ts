import {
    UpstreamRequestError,
    UpstreamTimeoutError
} from "./UpstreamRpcClient";

/** Retries of a failed head reconciliation before the service fails. */
export const RECONCILE_RETRY_LIMIT = 3;
/** Delay before the first retry; each further retry doubles it. */
export const RECONCILE_RETRY_BACKOFF_MS = 250;
/** Reconnects to a lost upstream before the service fails. */
export const UPSTREAM_RECONNECT_LIMIT = 5;
/** Delay before the first reconnect; each further one doubles it. */
export const UPSTREAM_RECONNECT_BACKOFF_MS = 200;
/** The upstream chain moved while a reconciliation read it. */
export class HeadChangedError extends Error {}

/** Whether a failure is worth another try: the chain moved, or the upstream answered with an error or too late. */
export function isTransient(error: unknown): boolean {
    return (
        error instanceof HeadChangedError ||
        error instanceof UpstreamRequestError ||
        error instanceof UpstreamTimeoutError
    );
}

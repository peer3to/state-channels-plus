// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
/** The thread name StartupTrapRootEntry starts its worker with; its log chunks are filed under it. */
export const STARTUP_TRAP_THREAD = "startup-trap";

/**
 * The failing worker's upload jitter, pinned: its error line's upload is
 * still in this wait when the worker reports the failure, unless it waits
 * for the upload first. Far below the flush bound.
 */
export const STARTUP_TRAP_UPLOAD_JITTER_MS = 1_000;

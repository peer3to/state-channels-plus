import { Logger } from "./logging";

export type EventBarrierOptions = {
    timeoutMs?: number;
    timeoutMessage?: string;
    timeoutMessageFn?: () => Promise<string> | string;
    timeoutMeta?: object;
    timeoutMetaFn?: () => object;
    label?: string;
};

export type EventBarrierCapturedError = Error & {
    capturedBarrierStack?: string;
};

type Waiter = {
    condition: () => boolean | Promise<boolean>;
    resolve: () => void;
    reject: (error: Error) => void;
    timeoutId: NodeJS.Timeout;
    capturedStack?: string;
};

/**
 * Event-driven barrier that resolves waiters when their condition becomes true.
 * Call `signal()` when relevant events occur so pending waiters re-check.
 */
export class EventBarrier {
    /** Upper bound for the single deadline condition check. */
    private static readonly DEADLINE_CHECK_BUDGET_MS = 1000;

    private waiters: Set<Waiter> = new Set();

    constructor(private readonly logger: Logger) {}

    async waitFor(
        condition: () => boolean | Promise<boolean>,
        options: EventBarrierOptions = {}
    ): Promise<void> {
        const {
            timeoutMs = 5000,
            timeoutMessage,
            timeoutMeta,
            timeoutMessageFn,
            timeoutMetaFn
        } = options;
        const capturedStack = new Error("EventBarrier.waitFor called").stack;

        return new Promise<void>((resolve, reject) => {
            // One settle guard shared by the initial check, signals, and the
            // deadline path: Promise settlement is idempotent, but the
            // deadline's side effects (logs, diagnostics) are not — they must
            // not run after another path already settled the waiter.
            let isSettled = false;
            // The timer starts BEFORE any condition evaluation, so a hanging
            // condition can never keep the wait pending past its deadline.
            const timeoutId = setTimeout(async () => {
                this.waiters.delete(waiter);
                // Final check at the deadline: if the condition is true NOW,
                // the state arrived but no signal woke this waiter — resolve,
                // and log it loudly: a wait that only completes here means a
                // state-change path is missing its signal (that log is the
                // diagnosis, not noise). The check itself is bounded so a
                // hung condition still rejects with the original timeout.
                try {
                    const finalResult = await Promise.race([
                        Promise.resolve().then(condition),
                        new Promise<false>((resolveBudget) =>
                            setTimeout(
                                () => resolveBudget(false),
                                EventBarrier.DEADLINE_CHECK_BUDGET_MS
                            )
                        )
                    ]);
                    if (isSettled) {
                        return;
                    }
                    if (finalResult) {
                        this.logger.error(
                            "EventBarrier condition was true at the timeout deadline but no signal woke the waiter",
                            { timeoutMs, capturedStack: waiter.capturedStack }
                        );
                        waiter.resolve();
                        return;
                    }
                } catch {
                    // fall through to the timeout rejection below
                }
                if (isSettled) {
                    return;
                }
                // Timeout diagnostics are bounded best-effort: a hanging or
                // throwing diagnostic must never keep the wait pending — the
                // waiter always settles with the original timeout error.
                let timeoutDetail = timeoutMessage || "Condition not met";
                if (timeoutMessageFn) {
                    try {
                        const detail = await Promise.race([
                            Promise.resolve().then(timeoutMessageFn),
                            new Promise<undefined>((resolveBudget) =>
                                setTimeout(
                                    () => resolveBudget(undefined),
                                    EventBarrier.DEADLINE_CHECK_BUDGET_MS
                                )
                            )
                        ]);
                        if (detail !== undefined) {
                            timeoutDetail = detail;
                        }
                    } catch {
                        // keep the default detail
                    }
                }
                let timeoutMetaResolved = timeoutMeta;
                if (timeoutMetaFn) {
                    try {
                        timeoutMetaResolved = timeoutMetaFn();
                    } catch {
                        // keep the static meta
                    }
                }
                if (isSettled) {
                    return;
                }
                const errorMessage = `EventBarrier timeout after ${timeoutMs}ms: ${timeoutDetail}`;
                const error = this.createErrorWithCapturedStack(
                    errorMessage,
                    undefined,
                    waiter.capturedStack
                );
                this.logger.error(errorMessage, {
                    timeoutMeta: timeoutMetaResolved,
                    timeoutMs,
                    capturedStack: waiter.capturedStack
                });
                waiter.reject(error);
            }, timeoutMs);

            const waiter: Waiter = {
                condition,
                resolve: () => {
                    if (isSettled) return;
                    isSettled = true;
                    clearTimeout(timeoutId);
                    this.waiters.delete(waiter);
                    resolve();
                },
                reject: (err: Error) => {
                    if (isSettled) return;
                    isSettled = true;
                    clearTimeout(timeoutId);
                    this.waiters.delete(waiter);
                    reject(err);
                },
                timeoutId,
                capturedStack
            };

            // Register FIRST, then run the initial check: a signal arriving
            // while the initial check is in flight finds the waiter and can
            // resolve it — there is no registration gap for a real signal to
            // fall into. resolve/reject are idempotent (first settle wins).
            this.waiters.add(waiter);
            void (async () => {
                try {
                    if (await condition()) {
                        waiter.resolve();
                    }
                } catch (err) {
                    const message =
                        err instanceof Error ? err.message : String(err);
                    waiter.reject(
                        this.createErrorWithCapturedStack(
                            `EventBarrier condition evaluation failed: ${message}`,
                            err,
                            waiter.capturedStack
                        )
                    );
                }
            })();
        });
    }

    /**
     * Signal that state may have changed; re-evaluates all waiters.
     */
    async signal(): Promise<void> {
        const waiters = Array.from(this.waiters);
        await Promise.allSettled(
            waiters.map(async (waiter) => {
                try {
                    if (await waiter.condition()) {
                        waiter.resolve();
                    }
                } catch (err) {
                    const message =
                        err instanceof Error ? err.message : String(err);
                    const wrappedError = this.createErrorWithCapturedStack(
                        `EventBarrier condition evaluation failed: ${message}`,
                        err,
                        waiter.capturedStack
                    );
                    this.logger.error(
                        `EventBarrier - signal - Error evaluating condition: ${message}`
                    );
                    waiter.reject(wrappedError);
                }
            })
        );
    }

    private createErrorWithCapturedStack(
        message: string,
        cause: unknown,
        capturedStack?: string
    ): Error {
        const error = new Error(message) as EventBarrierCapturedError;

        if (capturedStack) {
            error.capturedBarrierStack = capturedStack;
        }

        if (capturedStack) {
            const stackParts = [`${error.name}: ${error.message}`];
            stackParts.push("Barrier initialized at:");
            stackParts.push(capturedStack);

            if (cause instanceof Error && cause.stack) {
                stackParts.push("Cause stack:");
                stackParts.push(cause.stack);
            }

            error.stack = stackParts.join("\n");
        }

        return error;
    }

    /**
     * Clear all pending waiters without resolving them.
     */
    clear(): void {
        const waiters = Array.from(this.waiters);
        const clearedError = new Error(
            "EventBarrier cleared while waitFor condition was still pending (expected during harness cleanup)"
        );
        for (const waiter of waiters) {
            waiter.reject(clearedError);
        }
        this.waiters.clear();
    }
}

export default EventBarrier;

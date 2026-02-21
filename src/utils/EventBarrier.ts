import { Logger } from "./logging";

export type EventBarrierOptions = {
    timeoutMs?: number;
    timeoutMessage?: string;
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
    private waiters: Set<Waiter> = new Set();

    constructor(private readonly logger: Logger) {}

    async waitFor(
        condition: () => boolean | Promise<boolean>,
        options: EventBarrierOptions = {}
    ): Promise<void> {
        const { timeoutMs = 5000, timeoutMessage } = options;
        const capturedStack = new Error("EventBarrier.waitFor called").stack;

        // Fast path: resolve immediately if condition already satisfied.
        if (await condition()) {
            return;
        }

        return new Promise<void>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                this.waiters.delete(waiter);
                const errorMessage =
                    "EventBarrier timeout: " +
                    (timeoutMessage ||
                        `Condition not met within ${timeoutMs}ms`);
                const error = this.createErrorWithCapturedStack(
                    errorMessage,
                    undefined,
                    waiter.capturedStack
                );
                this.logger.error(errorMessage, {
                    capturedStack: waiter.capturedStack
                });
                reject(error);
            }, timeoutMs);

            const waiter: Waiter = {
                condition,
                resolve: () => {
                    clearTimeout(timeoutId);
                    this.waiters.delete(waiter);
                    resolve();
                },
                reject: (err: Error) => {
                    clearTimeout(timeoutId);
                    this.waiters.delete(waiter);
                    reject(err);
                },
                timeoutId,
                capturedStack
            };

            this.waiters.add(waiter);
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
        for (const waiter of this.waiters) {
            clearTimeout(waiter.timeoutId);
        }
        this.waiters.clear();
    }
}

export default EventBarrier;

import { Logger } from "./PeerLogger";

export type EventBarrierOptions = {
    timeoutMs?: number;
    timeoutMessage?: string;
    label?: string;
};

type Waiter = {
    condition: () => boolean | Promise<boolean>;
    resolve: () => void;
    reject: (error: Error) => void;
    timeoutId: NodeJS.Timeout;
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
                this.logger.error(errorMessage);
                reject(new Error(errorMessage));
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
                timeoutId
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
                    this.logger.error(
                        `EventBarrier - signal - Error evaluating condition: ${(err as Error).message}`
                    );
                    waiter.reject(err as Error);
                }
            })
        );
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

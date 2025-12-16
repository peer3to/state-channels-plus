import { Logger } from "./PeerLogger";

export type EventBarrierOptions = {
    timeoutMs?: number;
    timeoutMessage?: string;
};

type Waiter = {
    condition: () => boolean | Promise<boolean>;
    done: (err?: Error) => void;
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
            const finish = (err?: Error) => {
                clearTimeout(waiter.timeoutId);
                this.waiters.delete(waiter);
                err ? reject(err) : resolve();
            };
            const timeoutId = setTimeout(() => {
                const errorMessage =
                    "EventBarrier timeout: " +
                    (timeoutMessage ||
                        `Condition not met within ${timeoutMs}ms`);
                this.logger.error(errorMessage);
                finish(new Error(errorMessage));
            }, timeoutMs);

            const waiter: Waiter = {
                condition,
                done: finish,
                timeoutId
            };

            this.waiters.add(waiter);
        });
    }

    /**
     * Signal that state may have changed; re-evaluates all waiters.
     */
    signal(): void {
        for (const waiter of [...this.waiters]) {
            Promise.resolve()
                .then(waiter.condition)
                .then((ok) => ok && waiter.done())
                .catch((err) => {
                    this.logger.error(
                        `EventBarrier condition error: ${err.message}`
                    );
                    waiter.done(err);
                });
        }
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

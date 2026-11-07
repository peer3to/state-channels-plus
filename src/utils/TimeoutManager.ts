import { Logger } from "./logging";

export class TimeoutManager {
    private timeouts: Set<NodeJS.Timeout> = new Set();
    private isDisposed: boolean = false;
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger.child({ component: "TimeoutManager" });
    }

    public scheduleTask(
        task: () => void | Promise<void>,
        delayMs: number,
        taskName: string = "unnamed"
    ): ReturnType<typeof setTimeout> {
        if (this.isDisposed) {
            this.logger.verbose(
                `Attempted to schedule task '${taskName}' after disposal`
            );
            return {} as ReturnType<typeof setTimeout>;
        }

        const timeout = setTimeout(async () => {
            this.timeouts.delete(timeout);

            if (this.isDisposed) {
                return; // Don't execute if already disposed
            }

            try {
                const result = task();
                if (result instanceof Promise) {
                    await result;
                }
                this.logger.verbose(`Completed scheduled task '${taskName}'`);
            } catch (error) {
                this.logger.error(
                    `TimeoutManager: Error executing scheduled task '${taskName}'`,
                    { error }
                );
            }
        }, delayMs);

        this.timeouts.add(timeout);
        return timeout;
    }

    public cancelTask(timeoutId: NodeJS.Timeout): void {
        if (this.timeouts.has(timeoutId)) {
            clearTimeout(timeoutId);
            this.timeouts.delete(timeoutId);
        }
    }

    // Cancels every pending timer; a running task is not awaited, since it
    // may be frozen on a send the disposal cut-off stopped.
    public dispose(): void {
        this.isDisposed = true;
        for (const timeout of this.timeouts) {
            clearTimeout(timeout);
        }
        this.timeouts.clear();
    }
}

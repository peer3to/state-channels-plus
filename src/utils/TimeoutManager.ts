import { Logger } from "./logging";

export class TimeoutManager {
    private static readonly TASK_DRAIN_TIMEOUT_MS = 5000;
    private timeouts: Set<NodeJS.Timeout> = new Set();
    private runningTasks: Set<Promise<void>> = new Set();
    // Pending timeout -> what to run if it is cancelled wholesale.
    private cancelHandlers = new Map<NodeJS.Timeout, () => void>();
    private isDisposed: boolean = false;
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger.child({ component: "TimeoutManager" });
    }

    /**
     * `onCancel` runs if the manager cancels the task wholesale (channel reset
     * or disposal) before it fires, so a waiter whose only completion is this
     * timer fails instead of hanging. An explicit `cancelTask` does not run it:
     * that caller already settled its own waiter.
     */
    public scheduleTask(
        task: () => void | Promise<void>,
        delayMs: number,
        taskName: string = "unnamed",
        onCancel?: () => void
    ): ReturnType<typeof setTimeout> {
        if (this.isDisposed) {
            this.logger.verbose(
                `Attempted to schedule task '${taskName}' after disposal`
            );
            return {} as ReturnType<typeof setTimeout>;
        }

        const timeout = setTimeout(async () => {
            this.timeouts.delete(timeout);
            this.cancelHandlers.delete(timeout);

            if (this.isDisposed) {
                return; // Don't execute if already disposed
            }

            // Track the running task so dispose() can wait for it
            const executeTask = async () => {
                try {
                    const result = task();
                    if (result instanceof Promise) {
                        await result;
                    }
                    this.logger.verbose(
                        `Completed scheduled task '${taskName}'`
                    );
                } catch (error) {
                    console.error(
                        `TimeoutManager: Error executing scheduled task '${taskName}':`,
                        error
                    );
                }
            };

            const taskPromise = executeTask().finally(() => {
                this.runningTasks.delete(taskPromise);
            });

            this.runningTasks.add(taskPromise);
        }, delayMs);

        this.timeouts.add(timeout);
        if (onCancel) this.cancelHandlers.set(timeout, onCancel);
        return timeout;
    }

    public cancelTask(timeoutId: NodeJS.Timeout): void {
        if (this.timeouts.has(timeoutId)) {
            clearTimeout(timeoutId);
            this.timeouts.delete(timeoutId);
        }
        this.cancelHandlers.delete(timeoutId);
    }

    public async dispose(): Promise<void> {
        this.isDisposed = true;
        await this.cancelAllTasks();
    }

    /**
     * Cancel pending timeouts and drain running tasks without disposing, so the
     * manager keeps scheduling for the next channel. Callers stop their own
     * producers first: a task still running here may schedule another one.
     */
    public async cancelAllTasks(): Promise<void> {
        // Cancel all pending timeouts
        for (const timeout of this.timeouts) {
            clearTimeout(timeout);
        }
        this.timeouts.clear();
        const handlers = [...this.cancelHandlers.values()];
        this.cancelHandlers.clear();
        for (const onCancel of handlers) {
            try {
                onCancel();
            } catch (error) {
                this.logger.warn("Cancelled task's handler threw", { error });
            }
        }

        // Wait for currently running tasks to complete, but do not block the caller indefinitely.
        if (this.runningTasks.size > 0) {
            const tasks = [...this.runningTasks];
            const timeoutMs = TimeoutManager.TASK_DRAIN_TIMEOUT_MS;

            let deadline: ReturnType<typeof setTimeout> | undefined;
            const completion = Promise.allSettled(tasks).then(() => true);
            const timedOut = await Promise.race<boolean>([
                completion,
                new Promise<boolean>((resolve) => {
                    deadline = setTimeout(() => resolve(false), timeoutMs);
                })
            ]);
            if (deadline) clearTimeout(deadline);

            if (!timedOut) {
                this.logger.warn(
                    `Timed out waiting for running tasks; continuing cleanup`,
                    {
                        pendingTasks: this.runningTasks.size,
                        timeoutMs
                    }
                );
            }
        }
        this.runningTasks.clear();
    }
}

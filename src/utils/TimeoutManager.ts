export class TimeoutManager {
    private timeouts: Set<NodeJS.Timeout> = new Set();
    private isDisposed: boolean = false;

    public scheduleTask(
        task: () => void | Promise<void>,
        delayMs: number,
        taskName: string = "unnamed"
    ): ReturnType<typeof setTimeout> {
        if (this.isDisposed) {
            console.warn(
                `TimeoutManager: Attempted to schedule task '${taskName}' after disposal`
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
            } catch (error) {
                console.error(
                    `TimeoutManager: Error executing scheduled task '${taskName}':`,
                    error
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

    public dispose(): void {
        this.isDisposed = true;

        for (const timeout of this.timeouts) {
            clearTimeout(timeout);
        }
        this.timeouts.clear();
    }
}

export function scheduleTask(
    task: () => void | Promise<void>,
    delayMs: number,
    taskName: string = "unnamed"
): void {
    setTimeout(async () => {
        try {
            const result = task();
            if (result instanceof Promise) {
                await result;
            }
        } catch (error) {
            console.error(
                `Error executing scheduled task '${taskName}':`,
                error
            );
        }
    }, delayMs);
}

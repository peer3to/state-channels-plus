/**
 * Settles with `work`, or at `deadlineMs` (epoch milliseconds) while it still runs; work still
 * running at the deadline is left to finish unawaited.
 */
export async function settleBy(
    work: Promise<unknown>,
    deadlineMs: number
): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            work,
            new Promise<void>((resolve) => {
                timer = setTimeout(
                    resolve,
                    Math.max(0, deadlineMs - Date.now())
                );
            })
        ]);
    } finally {
        clearTimeout(timer);
    }
}

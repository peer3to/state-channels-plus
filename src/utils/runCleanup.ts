/** Attempt every step in order, then throw the first failure, including undefined. */
export async function runCleanup(
    ...steps: Array<() => void | Promise<void>>
): Promise<void> {
    let failed = false;
    let firstFailure: unknown;
    for (const step of steps) {
        try {
            await step();
        } catch (error) {
            if (!failed) {
                failed = true;
                firstFailure = error;
            }
        }
    }
    if (failed) throw firstFailure;
}

/** Synchronous cleanup stays synchronous for callers such as transport owners. */
export function runCleanupSync(...steps: Array<() => void>): void {
    let failed = false;
    let firstFailure: unknown;
    for (const step of steps) {
        try {
            step();
        } catch (error) {
            if (!failed) {
                failed = true;
                firstFailure = error;
            }
        }
    }
    if (failed) throw firstFailure;
}

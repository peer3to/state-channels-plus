import { PeerTestHarness } from "../../fixtures/PeerTestHarness";

export class TestSession {
    private static harness?: PeerTestHarness;
    private static firstDetachedError?: Error;
    // Wakes expectFirstDetachedError waiters when the first detached error lands.
    private static detachedErrorNotify?: () => void;
    // Expected error substrings; matching unhandledRejections are ignored (multi-peer dupes).
    private static detachedErrorAllowlist: string[] = [];
    // True only while harness cleanup runs; scopes teardown-only rejection filters.
    private static isCleanupActive = false;

    protected static createHarness(): PeerTestHarness {
        throw new Error(
            "TestSession.createHarness() must be implemented by a concrete test session"
        );
    }

    static async reset(): Promise<void> {
        await this.clear();

        this.harness = this.createHarness();
    }

    static getHarness(): PeerTestHarness {
        if (!this.harness) {
            throw new Error(
                "No active test session. Ensure global hooks run before tests."
            );
        }

        return this.harness;
    }

    static async clear(): Promise<void> {
        if (!this.harness) {
            return;
        }

        this.isCleanupActive = true;
        try {
            await this.harness.cleanup();
        } finally {
            this.isCleanupActive = false;
        }
        this.firstDetachedError = undefined;
        this.detachedErrorAllowlist = [];
        this.harness = undefined;
    }

    static setFirstDetachedError(error: Error): void {
        if (this.harness?.isExpectedByzantineError(error)) {
            return;
        }
        // drop errors a test has already claimed (multi-peer same-throw case)
        if (
            this.detachedErrorAllowlist.some((s) => error.message.includes(s))
        ) {
            return;
        }
        if (this.firstDetachedError) return;
        this.firstDetachedError = error;
        // wake any consumer waiting on this error
        const notify = this.detachedErrorNotify;
        this.detachedErrorNotify = undefined;
        notify?.();
    }

    static getIsCleanupActive(): boolean {
        return this.isCleanupActive;
    }

    static getFirstDetachedError(): Error | undefined {
        return this.firstDetachedError;
    }

    // Take and clear the first detached error; optional wait for async listener throws.
    static async consumeFirstDetachedError(
        timeoutMs = 0
    ): Promise<Error | undefined> {
        if (!this.firstDetachedError && timeoutMs > 0) {
            await new Promise<void>((resolve) => {
                const timeoutId = setTimeout(() => {
                    if (this.detachedErrorNotify === resolveOnce) {
                        this.detachedErrorNotify = undefined;
                    }
                    resolve();
                }, timeoutMs);
                const resolveOnce = () => {
                    clearTimeout(timeoutId);
                    resolve();
                };
                this.detachedErrorNotify = resolveOnce;
            });
        }
        const err = this.firstDetachedError;
        this.firstDetachedError = undefined;
        return err;
    }

    // Expect a detached error matching `includes`; mismatch rethrows, timeout fails if required.
    static async expectFirstDetachedError(options: {
        includes: string;
        timeoutMs?: number;
        required?: boolean;
    }): Promise<void> {
        const err = await this.consumeFirstDetachedError(
            options.timeoutMs ?? 0
        );
        this.detachedErrorAllowlist.push(options.includes);
        if (!err) {
            if (options.required ?? true) {
                throw new Error(
                    `expected detached error including "${options.includes}", got none`
                );
            }
            return;
        }
        if (!err.message.includes(options.includes)) {
            throw err;
        }
    }
}

export default TestSession;

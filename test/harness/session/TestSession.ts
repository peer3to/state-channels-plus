import { PeerTestHarness } from "../../fixtures/PeerTestHarness";

export class TestSession {
    private static harness?: PeerTestHarness;
    private static firstDetachedError?: Error;
    // Wakes expectFirstDetachedError waiters when the first detached error lands.
    private static detachedErrorNotify?: () => void;
    // Expected error substrings; matching unhandledRejections are ignored (multi-peer dupes).
    private static detachedErrorAllowlist: string[] = [];

    protected static createHarness(): PeerTestHarness {
        throw new Error(
            "TestSession.createHarness() must be implemented by a concrete test session"
        );
    }

    static async reset(): Promise<void> {
        await this.clear();

        this.harness = this.createHarness();
        await this.harness.startAutoTimeAdvance({ intervalSeconds: 1 });
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

        await this.harness.cleanup();
        this.firstDetachedError = undefined;
        this.detachedErrorAllowlist = [];
        this.harness = undefined;
    }

    static setFirstDetachedError(error: Error): void {
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
        // Allowlist pattern so duplicate peer throws are ignored.
        this.detachedErrorAllowlist.push(options.includes);

        const err = await this.consumeFirstDetachedError(
            options.timeoutMs ?? 0
        );
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

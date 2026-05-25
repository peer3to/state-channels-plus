import { PeerTestHarness } from "../../fixtures/PeerTestHarness";

export class TestSession {
    private static harness?: PeerTestHarness;
    private static firstDetachedError?: Error;
    // one-shot notifier: setFirstDetachedError fires it so consumers waiting
    // on the error (e.g. for an expected detached throw from an event listener)
    // wake up immediately.
    private static detachedErrorNotify?: () => void;

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
        this.harness = undefined;
    }

    static setFirstDetachedError(error: Error): void {
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

    // read + clear the first detached error in one step.
    // tests use this to declare "i expect this detached throw" so the
    // afterEach hook doesn't re-throw it.
    // pass timeoutMs to wait - useful when the throw fires inside an ethers
    // event listener and the unhandledRejection event hasn't dispatched yet.
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
}

export default TestSession;

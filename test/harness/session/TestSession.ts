// @spec-test-coverage-ignore: shared detached-settlement owner exercised by its mapped component tests
import { PeerTestHarness } from "../../fixtures/PeerTestHarness";
import { DetachedPromises } from "@/utils";

export class TestSession {
    private static harness?: PeerTestHarness;
    private static detachedErrors: Error[] = [];
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
            this.detachedErrors = [];
            this.detachedErrorAllowlist = [];
            return;
        }

        this.isCleanupActive = true;
        try {
            await this.harness.cleanup();
        } finally {
            this.isCleanupActive = false;
        }
        this.detachedErrors = [];
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
        this.detachedErrors.push(error);
        // wake any consumer waiting on this error
        const notify = this.detachedErrorNotify;
        this.detachedErrorNotify = undefined;
        notify?.();
    }

    static getIsCleanupActive(): boolean {
        return this.isCleanupActive;
    }

    static getFirstDetachedError(): Error | undefined {
        return this.detachedErrors[0];
    }

    static consumeDetachedFailure(): Error | undefined {
        const [first, ...rest] = this.detachedErrors;
        this.detachedErrors = [];
        if (!first) return undefined;
        if (rest.length > 0) {
            first.message += `\nAdditional detached errors:\n${rest
                .map((error) => error.message)
                .join("\n")}`;
        }
        return first;
    }

    // Take and clear the first detached error; optional wait for async listener throws.
    static async consumeFirstDetachedError(
        timeoutMs = 0
    ): Promise<Error | undefined> {
        if (this.detachedErrors.length === 0 && timeoutMs > 0) {
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
        return this.detachedErrors.shift();
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

    static async settleDetached(options?: {
        expectedErrorIncludes?: string;
        throwOnError?: boolean;
        drainTimeoutMs?: number;
    }): Promise<void> {
        const hostErrors = await this.getHarness().quiesceHosts();
        for (const error of hostErrors) this.setFirstDetachedError(error);
        const settled = await DetachedPromises.awaitAllAndClear(
            options?.drainTimeoutMs
        );
        for (const entry of settled) {
            if (entry.status !== "rejected") continue;
            this.setFirstDetachedError(
                entry.reason instanceof Error
                    ? entry.reason
                    : new Error(String(entry.reason))
            );
        }

        if (options?.expectedErrorIncludes) {
            const hasExpected = this.detachedErrors.some((error) =>
                error.message.includes(options.expectedErrorIncludes!)
            );
            if (!hasExpected) {
                throw new Error(
                    `expected detached error including "${options.expectedErrorIncludes}", got none`
                );
            }
            this.detachedErrors = this.detachedErrors.filter(
                (error) =>
                    !error.message.includes(options.expectedErrorIncludes!)
            );
            this.detachedErrorAllowlist.push(options.expectedErrorIncludes);
        }

        if (this.detachedErrors.length > 0) {
            if (options?.throwOnError === false) return;
            const [first, ...rest] = this.detachedErrors;
            this.detachedErrors = [];
            if (rest.length > 0) {
                first.message += `\nAdditional detached errors:\n${rest
                    .map((error) => error.message)
                    .join("\n")}`;
            }
            throw first;
        }
    }
}

export default TestSession;

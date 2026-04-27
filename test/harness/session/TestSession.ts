import { PeerTestHarness } from "../../fixtures/PeerTestHarness";

export class TestSession {
    private static harness?: PeerTestHarness;
    private static firstDetachedError?: Error;

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
        if (!this.firstDetachedError) {
            this.firstDetachedError = error;
        }
    }

    static getFirstDetachedError(): Error | undefined {
        return this.firstDetachedError;
    }
}

export default TestSession;

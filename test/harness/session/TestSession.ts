import { PeerTestHarness } from "../../fixtures/PeerTestHarness";

export class TestSession {
    private static harness?: PeerTestHarness;
    private static firstDetachedError?: Error;
    static async reset(): Promise<void> {
        await this.clear();

        this.harness = new PeerTestHarness();
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

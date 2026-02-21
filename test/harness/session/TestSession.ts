import { PeerTestHarness } from "../../fixtures/PeerTestHarness";

export class TestSession {
    private static harness?: PeerTestHarness;

    static async reset(): Promise<void> {
        await this.clear();

        this.harness = new PeerTestHarness();
        await this.harness.startAutoTimeAdvance();
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
        this.harness = undefined;
    }
}

export default TestSession;

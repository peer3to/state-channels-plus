import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";

/**
 * A HarnessBlock wraps a state transformation step.
 *
 */
export class HarnessBlock {
    constructor(
        private readonly step: (
            h: PeerTestHarness<any, any>
        ) => Promise<PeerTestHarness<any, any>>
    ) {}

    async run(
        harness: PeerTestHarness<any, any>
    ): Promise<PeerTestHarness<any, any>> {
        return this.step(harness);
    }

    /**
     * Compose multiple blocks into a single reusable block
     */
    static compose(...blocks: HarnessBlock[]): HarnessBlock {
        return new HarnessBlock(async (harness) => {
            for (const block of blocks) {
                harness = await block.run(harness);
            }
            return harness;
        });
    }
}

/**
 * Compose multiple blocks into a sequence without creating new harness
 */
export async function composeBlocks(
    harness: PeerTestHarness<any, any>,
    ...blocks: HarnessBlock[]
): Promise<PeerTestHarness<any, any>> {
    for (const block of blocks) {
        harness = await block.run(harness);
    }
    return harness;
}

/**
 * ScenarioRunner executes a sequence of blocks as a test scenario.
 *
 * Each block transforms the harness state sequentially.
 * Cleanup is handled automatically after execution.
 *
 */
export class ScenarioRunner {
    /**
     * Execute a sequence of blocks with automatic cleanup.
     *
     */
    static async execute(...blocks: HarnessBlock[]): Promise<void> {
        let harness = new PeerTestHarness();

        try {
            for (const block of blocks) {
                harness = await block.run(harness);
            }
        } finally {
            await harness.cleanup();
        }
    }

    /**
     * Execute a sequence of blocks and return harness with cleanup callback.
     *
     */
    static async executeWithCleanup(
        ...blocks: HarnessBlock[]
    ): Promise<{
        harness: PeerTestHarness<any, any>;
        cleanup: () => Promise<void>;
    }> {
        let harness = new PeerTestHarness();

        for (const block of blocks) {
            harness = await block.run(harness);
        }

        return {
            harness,
            cleanup: () => harness.cleanup()
        };
    }
}

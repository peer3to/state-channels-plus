import { HarnessBlock } from "../HarnessBlock";

export class AssertCalldata {
    /**
     * Assert no calldata was posted
     */
    static noCalldataPosted() {
        return new HarnessBlock(async (harness) => {
            harness.assertActions.calldata.noCalldataPosted();
            return harness;
        });
    }

    /**
     * Assert calldata was posted by any peer
     *
     * ```
     */
    static calldataPosted(options?: { timeoutMs?: number }) {
        return new HarnessBlock(async (harness) => {
            await harness.assertActions.calldata.calldataPosted(options);
            return harness;
        });
    }
}

import { HarnessBlock } from "./HarnessBlock";
import { HarnessOptions } from "@test/fixtures/PeerTestHarness";

export class Setup {
    /**
     * Initialize the harness with N peers
     */
    static peers(numPeers: number, options?: HarnessOptions<any>) {
        return new HarnessBlock(async (harness) => {
            await harness.setup(numPeers, options);
            return harness;
        });
    }
}

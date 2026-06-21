import { MathStateMachine } from "@typechain-types";

import { LifecycleActions } from "@test/harness/actions/lifecycle/LifecycleActions";
import { HarnessOptions } from "@test/harness/core/types";
import { MathPeerTestHarness } from "test-harness";

export class MathLifecycleActions extends LifecycleActions {
    declare public harness: MathPeerTestHarness;
    constructor(
        harness: MathPeerTestHarness,
        logger: MathPeerTestHarness["logger"]
    ) {
        super(harness, logger);
    }

    override async start(
        numPeers: number,
        transitionCount: number = 0,
        options?: HarnessOptions & {
            waitForFinalization?: boolean;
        }
    ) {
        await this.harness.setup(numPeers, options);
        const forkId = await this.openChannel();

        if (transitionCount > 0) {
            await this.harness.transition.advanceState({
                count: transitionCount,
                waitForFinalization: options?.waitForFinalization ?? true
            });
        }

        return forkId;
    }
}

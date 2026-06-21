import { ForkId } from "@/types/types";

import { DisputeOrchestrator } from "@test/harness/actions/DisputeOrchestrator";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { MathStateMachine } from "@typechain-types";
import { MathByzantineActions } from "./MathByzantineActions";
import { MathPeerTestHarness } from "test-harness";

export class MathDisputeOrchestrator extends DisputeOrchestrator {
    declare public harness: MathPeerTestHarness;

    constructor(
        harness: MathPeerTestHarness,
        logger: MathPeerTestHarness["logger"]
    ) {
        super(harness, logger);
    }

    async createInvalidStateTransitionDispute(
        maliciousPeerIndex: number,
        options?: {
            forkId?: ForkId;
            resetEventSpies?: boolean;
        }
    ): Promise<void> {
        if (options?.resetEventSpies) {
            this.harness.event.resetEventSpies();
        }

        await this.harness.byzantine.submitInvalidStateTransitionBlock(
            maliciousPeerIndex,
            {
                forkId: options?.forkId
            }
        );
    }
}

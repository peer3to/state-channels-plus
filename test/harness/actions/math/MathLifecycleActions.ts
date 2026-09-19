// @spec-test-coverage-ignore: shared math lifecycle actions exercised by owning mapped test declarations
import { LifecycleActions } from "@test/harness/actions/lifecycle/LifecycleActions";
import { HarnessOptions } from "@test/harness/core/types";
import { MathStateMachine } from "@typechain-types";
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

    /**
     * Drive a committed participant's leave to completion: author the exit
     * block when the leaver's turn comes, advance the channel once so it does,
     * then wait for the leave itself (settled departure plus runtime reset).
     */
    async leaveWithAuthoredExit(leaverIndex: number): Promise<void> {
        const leaver = this.harness.getPeer(leaverIndex);
        let exit: Promise<unknown> | undefined;
        leaver.p2pInstance.events.on("p2pEventHooks", "onLeaveTurn", () => {
            exit = leaver.p2pInstance.p2pContractInstance.leaveChannel();
        });
        const leave = leaver.p2pInstance.leaveChannel();
        await this.harness.transition.advanceState();
        await this.harness.event.waitForPeers("onLeaveTurn", [leaverIndex], 1);
        await exit;
        await leave;
    }
}

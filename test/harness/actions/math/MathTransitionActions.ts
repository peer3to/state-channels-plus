import { DetachedPromises } from "@/utils";
import { Status } from "@/types";
import { MathStateMachine } from "@typechain-types";
import {
    AdvanceStateBaseOptions,
    TransitionActions,
    TransitionOptions
} from "@test/harness/actions/TransitionActions";
import { ROUTES } from "@test/harness/threaded/worker/routeNames";
import { MathPeerTestHarness } from "test-harness";
import { MainRpcService } from "@/rpc";

type ParticipantLeaveOptions = TransitionOptions & {
    statusTimeoutMs?: number;
    statusTimeoutMessage?: string;
};

export class MathTransitionActions extends TransitionActions<
    MainRpcService,
    MathStateMachine
> {
    constructor(
        protected harness: MathPeerTestHarness,
        logger: MathPeerTestHarness["logger"]
    ) {
        super(harness, logger);
    }

    async increment(
        value: number = 1,
        options?: TransitionOptions
    ): Promise<any> {
        return this.submitNext(
            { op: ROUTES.math.add, args: { value } },
            options
        );
    }

    override advanceState(options?: AdvanceStateBaseOptions): Promise<void> {
        return super.advanceState({
            ...options,
            txFn: options?.txFn ?? { op: ROUTES.math.add, args: { value: 1 } }
        });
    }

    async peerWrite(options: {
        peer: number;
        value?: number;
        waitForPeers?: number[];
    }): Promise<void> {
        const { peer, value = 1, waitForPeers } = options;
        await this.submitOp(
            this.harness.getPeerHandle(peer),
            { op: ROUTES.math.add, args: { value } },
            { waitForPeers }
        );
    }

    async participantLeaveWait(
        options?: ParticipantLeaveOptions
    ): Promise<number> {
        const { statusTimeoutMs, statusTimeoutMessage, ...leaveOptions } =
            options ?? {};
        const leaverIndex = await this.participantLeave(leaveOptions);
        await this.harness.event.waitUntilPeerStatus(
            leaverIndex,
            Status.SYNCED,
            {
                timeoutMs: statusTimeoutMs ?? 15000,
                timeoutMessage:
                    statusTimeoutMessage ??
                    "Exiting peer did not reach SYNCED after snapshot update"
            }
        );
        return leaverIndex;
    }

    async participantLeaveDetached(
        options?: ParticipantLeaveOptions
    ): Promise<number> {
        const { statusTimeoutMs, statusTimeoutMessage, ...leaveOptions } =
            options ?? {};
        const leaverIndex = await this.participantLeave(leaveOptions);
        const promise = this.harness.event.waitUntilPeerStatus(
            leaverIndex,
            Status.SYNCED,
            {
                timeoutMs: statusTimeoutMs ?? 15000,
                timeoutMessage:
                    statusTimeoutMessage ??
                    "Exiting peer did not reach SYNCED after snapshot update"
            }
        );
        DetachedPromises.collect(promise);
        return leaverIndex;
    }

    private async participantLeave(
        options?: TransitionOptions
    ): Promise<number> {
        const leaver = await this.harness.query.getNextPeerToWrite();
        const leaverIndex = leaver.index;

        await this.submitNext(
            { op: ROUTES.math.leaveChannel },
            {
                waitForTurn: true,
                waitForSync: options?.waitForSync ?? true,
                waitForPeers: options?.waitForPeers,
                waitForFinalization: options?.waitForFinalization ?? true,
                delayMs: options?.delayMs
            }
        );

        this.logger.debug(`Peer ${leaverIndex} left channel`);

        return leaverIndex;
    }
}

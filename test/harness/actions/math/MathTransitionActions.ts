import { DetachedPromises } from "@/utils";
import { Status } from "@/types";
import { MathStateMachine } from "@typechain-types";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import {
    AdvanceStateBaseOptions,
    TransitionActions,
    TransitionOptions
} from "@test/harness/actions/TransitionActions";
import { MathPeerTestHarness } from "test-harness";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";

type MathAdvanceStateOptions = AdvanceStateBaseOptions & {
    txFn?: (contract: MathStateMachine) => Promise<any>;
};

type ParticipantLeaveOptions = TransitionOptions & {
    statusTimeoutMs?: number;
    statusTimeoutMessage?: string;
};

export class MathTransitionActions extends TransitionActions<
    HarnessControlRpc,
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
        return this.submitNext((contract) => contract.add(value), options);
    }

    override async advanceState(
        options?: MathAdvanceStateOptions
    ): Promise<void> {
        const txFn =
            options?.txFn ?? ((contract: MathStateMachine) => contract.add(1));

        return super.advanceState({
            ...options,
            txFn
        });
    }

    async peerWrite(options: {
        peer: number;
        value?: number;
        waitForPeers?: number[];
    }): Promise<void> {
        const { peer, value = 1, waitForPeers } = options;
        const peerObj = this.harness.peers[peer];
        if (!peerObj) {
            throw new Error(`Peer ${peer} not found`);
        }

        await this.submit(peerObj, (contract) => contract.add(value), {
            waitForPeers
        });
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

        await this.submitNext((contract) => contract.leaveChannel(), {
            waitForTurn: true,
            waitForSync: options?.waitForSync ?? true,
            waitForPeers: options?.waitForPeers,
            waitForFinalization: options?.waitForFinalization ?? true,
            delayMs: options?.delayMs
        });

        this.logger.debug(`Peer ${leaverIndex} left channel`);

        return leaverIndex;
    }
}

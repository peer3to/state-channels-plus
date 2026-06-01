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
import { MainRpcService } from "@/rpc";

type MathAdvanceStateOptions = AdvanceStateBaseOptions & {
    txFn?:
        | ((contract: MathStateMachine) => Promise<any>)
        | { op: string; args?: unknown };
};

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
        return this.harness.options.dedicatedPeerThread
            ? this.submitNext({ op: "math.add", args: { value } }, options)
            : this.submitNext((contract) => contract.add(value), options);
    }

    override async advanceState(
        options?: MathAdvanceStateOptions
    ): Promise<void> {
        if (options?.txFn) {
            return super.advanceState({ ...options, txFn: options.txFn });
        }
        const txFn = this.harness.options.dedicatedPeerThread
            ? { op: "math.add", args: { value: 1 } }
            : (contract: MathStateMachine) => contract.add(1);

        const count = options?.count ?? 1;
        const total = options?.rounds
            ? options.rounds * this.harness.peers.length
            : count;

        for (let i = 0; i < total; i++) {
            await this.submitNext(txFn, {
                ...options,
                waitForFinalization:
                    i === total - 1 ? options?.waitForFinalization : false
            });
        }
    }

    async peerWrite(options: {
        peer: number;
        value?: number;
        waitForPeers?: number[];
    }): Promise<void> {
        const { peer, value = 1, waitForPeers } = options;
        const peerObj = this.harness.peers[peer];
        if (!peerObj) throw new Error(`Peer ${peer} not found`);
        if (this.harness.options.dedicatedPeerThread) {
            await this.submitOp(
                peerObj,
                { op: "math.add", args: { value } },
                {
                    waitForPeers
                }
            );
        } else {
            await this.submit(peerObj, (contract) => contract.add(value), {
                waitForPeers
            });
        }
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

        const leaveOp = this.harness.options.dedicatedPeerThread
            ? { op: "math.leaveChannel" }
            : (contract: MathStateMachine) => contract.leaveChannel();
        await this.submitNext(leaveOp, {
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

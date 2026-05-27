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
    txFn?: (contract: MathStateMachine) => Promise<any>;
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
        // step 1 - prefer named-op shape -> works in both inline + worker mode.
        return this.submitNext({ op: "math.add", args: { value } }, options);
    }

    override async advanceState(
        options?: MathAdvanceStateOptions
    ): Promise<void> {
        // step 1 - the legacy txFn override (lambda over MathStateMachine) is
        // inline-only. when provided, defer to the base lambda path. otherwise
        // ship the default add-1 as a named op so worker mode works without
        // test-source churn.
        if (options?.txFn) {
            return super.advanceState({ ...options, txFn: options.txFn });
        }
        // step 1 - reuse the base advanceState loop but inject a named-op via
        // a small adapter that bypasses the lambda path. base loops over
        // submitNext; we shadow the local txFn -> use submitNext({op}).
        const count = options?.count ?? 1;
        const total = options?.rounds
            ? options.rounds * this.harness.peers.length
            : count;

        for (let i = 0; i < total; i++) {
            await this.submitNext(
                { op: "math.add", args: { value: 1 } },
                {
                    ...options,
                    waitForFinalization:
                        i === total - 1 ? options?.waitForFinalization : false
                }
            );
        }
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

        await this.submitOp(
            peerObj,
            { op: "math.add", args: { value } },
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
            { op: "math.leaveChannel" },
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

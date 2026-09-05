// @spec-test-coverage-ignore: shared math transition actions exercised by owning mapped test declarations
import { DetachedPromises } from "@/utils";
import { Status } from "@/types";
import { MathStateMachine } from "@typechain-types";
import {
    AdvanceStateBaseOptions,
    TransitionActions,
    TransitionOptions,
    KeepAuthoringOptions
} from "@test/harness/actions/TransitionActions";
import { MathPeerTestHarness } from "test-harness";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";

type MathAdvanceStateOptions = AdvanceStateBaseOptions & {
    txFn?: (contract: MathStateMachine) => Promise<any>;
};

type ParticipantLeaveOptions = TransitionOptions & {
    leaverIndex?: number;
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

    /**
     * Let the current leader author its next block with its broadcast stubbed,
     * so no other peer stores it. Returns the leader, an observer that has not
     * seen the block, and the authored block projection - the staging for
     * feeding a real, unseen block into a single peer's validation.
     */
    async authorNextBlockOffWireWait(options?: { observerIndex?: number }) {
        const h = this.harness;
        const forkId = h.activeForkId!;

        const nextWriter = await h
            .control(h.getPeer(0))
            .query.getNextToWrite()
            .request();
        const leader = h.peers.find((p) => p.address === nextWriter);
        if (!leader) {
            throw new Error(`No peer matches the next writer ${nextWriter}`);
        }
        const observer =
            options?.observerIndex !== undefined
                ? h.getPeer(options.observerIndex)
                : h.peers.find((p) => p.index !== leader.index)!;

        const startHeight = await h
            .control(observer)
            .query.getNextBlockHeight(forkId)
            .request();

        // off-wire means off the chain too: without this the leader's
        // chain-fallback post leaks the block to everyone else after
        // agreementTime
        await h
            .control(leader)
            .stub.stubSuppressMaybePostBlockOnChain()
            .request();
        await h.byzantine.stubBroadcast(leader.index);

        await leader.p2pInstance.p2pContractInstance.add(1);
        // the sync barrier settles on the leader's own event stream
        await h.syncCoordinator.waitForPeersToSync([leader], forkId, {
            minHeight: startHeight,
            waitForFinalization: false
        });

        const authored = await h
            .control(leader)
            .query.getBlockByHeight(forkId, startHeight)
            .request();
        if (!authored) {
            throw new Error(
                `Leader ${leader.index} did not author block ${startHeight}`
            );
        }

        return { leader, observer, authored, startHeight, forkId };
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

    /**
     * The generic keep-alive with the math transition (`add(1)`) as the
     * default block content.
     */
    async keepAuthoringUntil(
        options: KeepAuthoringOptions & {
            txFn?: (contract: MathStateMachine) => Promise<any>;
        }
    ): Promise<number> {
        return super.keepAuthoringUntil({
            ...options,
            txFn: options.txFn ?? ((contract) => contract.add(1))
        });
    }

    /**
     * Keep the writer slot alive until every listed peer reports `status`:
     * a leaver settling to SYNCED once its exit snapshot is on chain, a
     * joiner promoted to PARTICIPATING once a block carries its join. Either
     * settles in seconds while the harness authors in milliseconds.
     */
    async keepAuthoringUntilPeersStatus(options: {
        peerIndices: number[];
        status: Status;
        waitForPeers: number[];
        excludePeerIndices?: number[];
        maximumBlocks?: number;
    }): Promise<number> {
        const { peerIndices, status, maximumBlocks = 20, ...rest } = options;
        const peerHasStatus = async (peerIndex: number) =>
            (await this.harness
                .control(this.harness.getPeer(peerIndex))
                .query.getStatus()
                .request()) === status;
        return this.keepAuthoringUntil({
            until: async () => {
                for (const peerIndex of peerIndices) {
                    if (!(await peerHasStatus(peerIndex))) return false;
                }
                return true;
            },
            maximumBlocks,
            ...rest
        });
    }

    async participantLeaveWait(
        options?: ParticipantLeaveOptions
    ): Promise<number> {
        const { statusTimeoutMs, statusTimeoutMessage, ...leaveOptions } =
            options ?? {};
        const leaverIndex =
            await this.participantLeaveStateTransition(leaveOptions);
        await this.harness.event.waitUntilPeerStatus(
            leaverIndex,
            Status.SYNCED,
            {
                timeoutMs:
                    statusTimeoutMs ??
                    this.harness.event.protocolEventTimeoutMs(),
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
        const leaverIndex =
            await this.participantLeaveStateTransition(leaveOptions);
        const promise = this.harness.event.waitUntilPeerStatus(
            leaverIndex,
            Status.SYNCED,
            {
                timeoutMs:
                    statusTimeoutMs ??
                    this.harness.event.protocolEventTimeoutMs(),
                timeoutMessage:
                    statusTimeoutMessage ??
                    "Exiting peer did not reach SYNCED after snapshot update"
            }
        );
        DetachedPromises.collect(promise);
        return leaverIndex;
    }

    /** Submit the leave transition without waiting for a later snapshot status. */
    async participantLeaveStateTransition(
        options?: ParticipantLeaveOptions
    ): Promise<number> {
        const leaverIndex =
            options?.leaverIndex ??
            (await this.harness.query.getNextPeerToWrite()).index;
        const leaver = this.harness.getPeer(leaverIndex);

        await this.submit(leaver, (contract) => contract.leaveChannel(), {
            waitForTurn: true,
            waitForSync: options?.waitForSync ?? true,
            waitForPeers: options?.waitForPeers,
            waitForFinalization: options?.waitForFinalization ?? true,
            delayMs: options?.delayMs
        });

        if (
            !this.harness.context.leftChannelPeerIndices.includes(leaverIndex)
        ) {
            this.harness.context.leftChannelPeerIndices.push(leaverIndex);
        }
        this.logger.debug(`Peer ${leaverIndex} left channel`);

        return leaverIndex;
    }
}

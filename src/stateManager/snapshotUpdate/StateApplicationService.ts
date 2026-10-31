import type StateManager from "../StateManager";
import Clock from "@/Clock";

import { StateSnapshot } from "@/models";
import { Status, timeoutWaitTime as timeoutWaitTimeSeconds } from "@/types";
import { Address, Bytes, ForkId, Timestamp } from "@/types/types";
import { Logger } from "@/utils";
import { errorMessage } from "@/utils/errorMessage";
import P2pEventHooksUtils from "@/utils/P2pEventHooksUtils";
import type {
    MessageBlockStruct,
    SnapshotDataStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";

interface PreparedState {
    previousEncodedState: Bytes;
    participants: Address[];
    listedOnChain: boolean;
    nextToWrite: Address;
}

/**
 * Applies a received snapshot as the session's latest state: persists it,
 * pushes it into the local VM, swaps the active fork, recomputes the status
 * and schedules the follow-up work. Entered on sync (`EventHandler`,
 * `SpectateService`) and on fork reduction (`ReductionManager`).
 */
export default class StateApplicationService {
    private readonly logger: Logger;

    constructor(
        private readonly stateManager: StateManager,
        logger: Logger
    ) {
        this.logger = logger.child({ component: "StateApplication" });
    }

    /**
     * Installs `stateSnapshot` in two stages. Prepare writes the VM and makes
     * the reads the commit needs; nothing in storage, fork or status changes
     * yet, but the VM already holds the new state (FIND-STATE-2-4BH3Y1).
     * Commit runs `persistHistory` (the caller's storage writes for this
     * install), then persists the state, swaps the fork and recomputes the
     * status with no await in between, so no task sees the new history under
     * the old fork.
     * When `persistHistory` stores nothing (false) the VM is restored and
     * nothing is committed (false). When it throws the VM is restored and
     * the error is rethrown.
     */
    public async unsafeSetLatestState(
        stateSnapshot: StateSnapshotStruct,
        encodedState: Bytes,
        outboundMessageBlock?: MessageBlockStruct,
        persistHistory: () => boolean = () => true
    ): Promise<boolean> {
        const sm = this.stateManager;
        const prepared = await this.prepare(encodedState);
        const restore = () =>
            sm.diamondStateMachine.setState(prepared.previousEncodedState);
        let isPersisted: boolean;
        try {
            isPersisted = persistHistory();
        } catch (error) {
            await restore();
            throw error;
        }
        if (!isPersisted) {
            await restore();
            return false;
        }
        const previousForkId = sm.forkId;
        this.commit(
            stateSnapshot,
            encodedState,
            outboundMessageBlock,
            prepared
        );
        if (previousForkId !== stateSnapshot.forkId)
            sm.reductionManager.settleForkLeft(previousForkId);
        return true;
    }

    /**
     * Reduction genesis with the same staged commit. Returns false when a
     * read after the canonical `setState` failed, in which case the runtime
     * is aborted so it never keeps serving with the VM and storage
     * describing different states.
     */
    public async unsafeApplyReductionGenesis(
        genesisSnapshot: StateSnapshotStruct,
        encodedState: Bytes,
        outboundMessageBlock: MessageBlockStruct | undefined
    ): Promise<boolean> {
        const sm = this.stateManager;
        const { forkId, snapshotData } = genesisSnapshot;
        this.logger.info("Setting reduction genesis state", {
            forkId,
            genesisTimestamp: Number(genesisSnapshot.timestamp),
            participant: snapshotData.participants
        });
        let prepared: PreparedState;
        try {
            prepared = await this.prepare(encodedState);
        } catch (error) {
            this.logger.error(
                "Reduction genesis inspection failed after the VM write; aborting",
                {
                    forkId,
                    error: errorMessage(error)
                }
            );
            sm.abort();
            return false;
        }
        this.commit(
            genesisSnapshot,
            encodedState,
            outboundMessageBlock,
            prepared
        );
        return true;
    }

    public async unsafeSetGenesisState(
        snapshotData: SnapshotDataStruct,
        encodedState: Bytes,
        forkId: ForkId,
        genesisTimestamp: Timestamp,
        outboundMessageBlock?: MessageBlockStruct
    ): Promise<void> {
        const normalizedGenesisTimestamp = Number(genesisTimestamp);
        this.logger.info("Setting genesis state", {
            forkId,
            genesisTimestamp: normalizedGenesisTimestamp,
            participant: snapshotData.participants
        });

        // generate and store genesis snapshot
        const _genesisSnapshot: StateSnapshotStruct = {
            forkId,
            blockHeight: 0,
            timestamp: normalizedGenesisTimestamp,
            snapshotData: snapshotData
        };
        this.logger.debug("Stored genesis snapshot", { _genesisSnapshot });

        await this.unsafeSetLatestState(
            _genesisSnapshot,
            encodedState,
            outboundMessageBlock
        );
    }

    /**
     * Prepare: the canonical VM write and the derived VM and chain reads.
     * A failed read restores the previous VM state and throws.
     */
    private async prepare(encodedState: Bytes): Promise<PreparedState> {
        const sm = this.stateManager;
        const previousEncodedState = await sm.diamondStateMachine.getState();
        // Update local EVM/state machine
        await sm.diamondStateMachine.setState(encodedState);
        try {
            const participants = await sm.diamondStateMachine.getParticipants();
            const listedOnChain =
                await this.isSignerListedOnChain(participants);
            return {
                previousEncodedState,
                participants,
                listedOnChain,
                nextToWrite: await sm.diamondStateMachine.getNextToWrite()
            };
        } catch (error) {
            await sm.diamondStateMachine.setState(previousEncodedState);
            throw error;
        }
    }

    /** Commit: synchronous mutations only. */
    private commit(
        stateSnapshot: StateSnapshotStruct,
        encodedState: Bytes,
        outboundMessageBlock: MessageBlockStruct | undefined,
        prepared: PreparedState
    ): void {
        const sm = this.stateManager;
        // Persist state snapshot (as a model)
        sm.storage.stateSnapshots.storeStateSnapshot(
            StateSnapshot.from(stateSnapshot)
        );
        // Persist outbound message block if provided
        if (outboundMessageBlock)
            sm.storage.outboundMessages.store(outboundMessageBlock);
        // Persist state machine state (keyed by snapshot hash when available)
        sm.storage.stateMachineStates.storeStateMachineState(encodedState, {
            hash: stateSnapshot.snapshotData.stateMachineStateHash
        });
        // Update the forkId to the new fork
        sm.forkId = stateSnapshot.forkId;
        sm.membershipService.publishOffChainEligibility(
            stateSnapshot.snapshotData.participants
        );
        this.applyParticipationStatus(
            prepared.participants,
            prepared.listedOnChain
        );
        this.scheduleFollowUps(
            stateSnapshot.forkId,
            prepared.nextToWrite,
            Number(stateSnapshot.timestamp)
        );
    }

    /**
     * Whether the chain still lists this signer as a participant or a pending
     * participant. Read only when the installed state no longer lists it, so
     * a state that keeps the signer costs no chain read.
     */
    private async isSignerListedOnChain(
        participants: Address[]
    ): Promise<boolean> {
        const sm = this.stateManager;
        if (participants.includes(sm.signerAddress)) return true;
        return sm.membershipService.isSignerOnChain();
    }

    /**
     * Status reflects the chain. A state that lists the signer makes it a
     * participant; a state that no longer lists it makes it `SYNCED` only
     * once the chain no longer lists it either. A locally reduced fork can
     * drop the signer before the transaction recording that reduction and
     * posting its snapshot is mined; the chain's snapshot event then makes
     * the transition. A pending joiner whose join can still land stays
     * pending, so its own-join observation still starts the force-join
     * bounds; the join service ends a join whose authorization expired.
     */
    private applyParticipationStatus(
        participants: Address[],
        listedOnChain: boolean
    ): void {
        const sm = this.stateManager;
        const isParticipant = participants.includes(sm.signerAddress);
        if (isParticipant) {
            // a reduction genesis can seat a pending joiner: its join ends on
            // this status change (ChannelJoinService subscribes to
            // onStatusChanged)
            sm.setStatus(Status.PARTICIPATING);
        } else if (sm.channelJoinService.isJoinInProgress()) {
            // the join service ends a join that does not land
            this.logger.info(
                "Installed state does not list this signer; its join is in progress, keeping PENDING_PARTICIPANT"
            );
        } else if (!listedOnChain) {
            // LeaveChannelService reports this drop as onLeftChannel
            sm.setStatus(Status.SYNCED);
        } else {
            this.logger.info(
                "Installed state no longer lists this signer; keeping the status until the chain drops it",
                { status: sm.status }
            );
        }
    }

    private scheduleFollowUps(
        forkId: ForkId,
        nextToWrite: Address,
        normalizedGenesisTimestamp: number
    ): void {
        const sm = this.stateManager;
        const nextTransactionCnt = sm.storage.blocks.getNextBlockHeight(
            sm.forkId
        );

        const timeAdjustment =
            normalizedGenesisTimestamp - Clock.getTimeInSeconds();
        const turnTime = sm.timeConfig.p2pTime;
        const timeoutWaitTime =
            timeoutWaitTimeSeconds(sm.timeConfig, nextTransactionCnt) +
            timeAdjustment;
        this.logger.info(
            `setLatestState - schedule timeoutNext in (${timeoutWaitTime}s)`,
            {
                nextToWrite,
                turnTime,
                timeAdjustment,
                timeoutWaitTime,
                genesisTimestamp: normalizedGenesisTimestamp
            }
        );
        sm.participantTimeoutService.scheduleCheck(
            forkId,
            nextTransactionCnt,
            nextToWrite,
            timeoutWaitTime * 1000,
            "participantTimeout(setState)"
        );

        sm.timeoutManager.scheduleTask(
            () => sm.blockQueueManager.tryExecuteFromQueue(sm.forkId),
            0,
            "tryExecuteFromQueue"
        );

        sm.p2pEventHooks.onSetState?.(forkId);
        P2pEventHooksUtils.notifyTurn({
            nextToWrite,
            nextBlockHeight: nextTransactionCnt,
            relevantTimestamp: normalizedGenesisTimestamp,
            currentTimestamp: Clock.getTimeInSeconds(),
            timeConfig: sm.timeConfig,
            p2pEventHooks: sm.p2pEventHooks,
            logger: this.logger,
            leaveChannelService: sm.leaveChannelService
        });
    }
}

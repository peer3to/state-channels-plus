import type {
    MessageBlockStruct,
    SnapshotDataStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";

import Clock from "@/Clock";
import { StateSnapshot } from "@/models";
import { Status, timeoutWaitTime as timeoutWaitTimeSeconds } from "@/types";
import { Address, Bytes, ForkId, Timestamp } from "@/types/types";
import { addressesEqual, Logger } from "@/utils";
import P2pEventHooksUtils from "@/utils/P2pEventHooksUtils";

import type StateManager from "../StateManager";

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

    public async unsafeSetLatestState(
        stateSnapshot: StateSnapshotStruct,
        encodedState: Bytes,
        outboundMessageBlock?: MessageBlockStruct
    ): Promise<void> {
        const sm = this.stateManager;
        const normalizedGenesisTimestamp = Number(stateSnapshot.timestamp);

        this.persistLatestState(
            stateSnapshot,
            encodedState,
            outboundMessageBlock
        );

        // Update local EVM/state machine
        await sm.diamondStateMachine.setState(encodedState);

        // Update the forkId to the new fork
        const forkId = stateSnapshot.forkId;
        const previousForkId = sm.forkId;
        sm.forkId = forkId;
        if (previousForkId !== forkId)
            sm.reductionManager.settleForkLeft(previousForkId);

        const participants = await sm.diamondStateMachine.getParticipants();
        const listedOnChain = await this.isSignerListedOnChain(participants);
        this.applyParticipationStatus(participants, listedOnChain);

        const nextToWrite = await sm.diamondStateMachine.getNextToWrite();

        this.scheduleFollowUps(forkId, nextToWrite, normalizedGenesisTimestamp);
        await sm.leaveChannelService.onSettledStateObserved();
    }

    /**
     * Reduction genesis with a staged commit. Every VM call happens first;
     * one final `shouldCommit` check follows, and storage, fork, status,
     * timers, and hooks are then committed with no await in between. Returns
     * false when the commit was cancelled (disposal) or when a read after the
     * canonical `setState` failed, in which case the runtime is aborted so it
     * never keeps serving with the VM and storage describing different states.
     */
    public async unsafeApplyReductionGenesis(
        snapshotData: SnapshotDataStruct,
        encodedState: Bytes,
        forkId: ForkId,
        genesisTimestamp: Timestamp,
        outboundMessageBlock: MessageBlockStruct | undefined,
        shouldCommit: () => boolean
    ): Promise<boolean> {
        const sm = this.stateManager;
        const normalizedGenesisTimestamp = Number(genesisTimestamp);
        this.logger.info("Setting reduction genesis state", {
            forkId,
            genesisTimestamp: normalizedGenesisTimestamp,
            participant: snapshotData.participants
        });
        const genesisSnapshot: StateSnapshotStruct = {
            forkId,
            blockHeight: 0,
            timestamp: normalizedGenesisTimestamp,
            snapshotData
        };

        // Prepare: the canonical VM write and both derived reads.
        await sm.diamondStateMachine.setState(encodedState);
        let participants: Address[];
        let nextToWrite: Address;
        let listedOnChain: boolean;
        try {
            participants = await sm.diamondStateMachine.getParticipants();
            nextToWrite = await sm.diamondStateMachine.getNextToWrite();
            listedOnChain = await this.isSignerListedOnChain(participants);
        } catch (error) {
            this.logger.error(
                "Reduction genesis inspection failed after the VM write; aborting",
                {
                    forkId,
                    error:
                        error instanceof Error ? error.message : String(error)
                }
            );
            sm.abort();
            return false;
        }

        // Commit: final check, then synchronous mutations only.
        if (!shouldCommit()) return false;
        this.persistLatestState(
            genesisSnapshot,
            encodedState,
            outboundMessageBlock
        );
        sm.forkId = forkId;
        this.applyParticipationStatus(participants, listedOnChain);
        this.scheduleFollowUps(forkId, nextToWrite, normalizedGenesisTimestamp);

        // Follow-up: may await; disposal after this point rolls nothing back.
        await sm.leaveChannelService.onSettledStateObserved();
        return true;
    }

    private persistLatestState(
        stateSnapshot: StateSnapshotStruct,
        encodedState: Bytes,
        outboundMessageBlock?: MessageBlockStruct
    ): void {
        const sm = this.stateManager;

        // Persist state snapshot (as a model)
        const latestSnapshot = StateSnapshot.from(stateSnapshot);
        sm.storage.stateSnapshots.storeStateSnapshot(latestSnapshot);

        // Persist outbound message block if provided
        if (outboundMessageBlock) {
            sm.storage.outboundMessages.store(outboundMessageBlock);
        }

        // Persist state machine state (keyed by snapshot hash when available)
        sm.storage.stateMachineStates.storeStateMachineState(encodedState, {
            hash: stateSnapshot.snapshotData.stateMachineStateHash
        });
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
        const onChain = await sm.membershipService.getOnChainParticipantUnion();
        return onChain.some((participant) =>
            addressesEqual(participant, sm.signerAddress)
        );
    }

    /**
     * Status reflects the chain. A state that lists the signer makes it a
     * participant; a state that no longer lists it makes it `SYNCED` only
     * once the chain no longer lists it either. A locally reduced fork can
     * drop the signer before the transaction recording that reduction and
     * posting its snapshot is mined; the chain's snapshot event then makes
     * the transition.
     */
    private applyParticipationStatus(
        participants: Address[],
        listedOnChain: boolean
    ): void {
        const sm = this.stateManager;
        const isParticipant = participants.includes(sm.signerAddress);
        if (isParticipant) {
            sm.setStatus(Status.PARTICIPATING);
        } else if (!listedOnChain) {
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
}

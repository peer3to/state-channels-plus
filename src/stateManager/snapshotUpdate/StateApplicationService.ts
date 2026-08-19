import type {
    MessageBlockStruct,
    SnapshotDataStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";

import Clock from "@/Clock";
import { StateSnapshot } from "@/models";
import { Status, timeoutWaitTime as timeoutWaitTimeSeconds } from "@/types";
import { Bytes, ForkId, Timestamp } from "@/types/types";
import { Logger } from "@/utils";
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

        // Update local EVM/state machine
        await sm.diamondStateMachine.setState(encodedState);

        // Update the forkId to the new fork
        const forkId = stateSnapshot.forkId;
        sm.forkId = forkId;

        const participants = await sm.diamondStateMachine.getParticipants();
        const isParticipant = participants.includes(sm.signerAddress);
        if (isParticipant) {
            sm.setStatus(Status.PARTICIPATING);
        } else {
            sm.setStatus(Status.SYNCED);
        }

        const nextToWrite = await sm.diamondStateMachine.getNextToWrite();

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
            logger: this.logger
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

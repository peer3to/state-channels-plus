import type { MessageBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";

import Clock from "@/Clock";
import { Block, StateSnapshot } from "@/models";
import type { ParticipantChanges } from "./SnapshotAssemblyService";
import { Status, timeoutWaitTime } from "@/types";
import { Bytes } from "@/types/types";
import { Logger } from "@/utils";
import { LoggerUtils } from "@/utils/LoggerUtils";
import P2pEventHooksUtils from "@/utils/P2pEventHooksUtils";

import type StateManager from "../StateManager";
import type AValidationStrategy from "../validationStrategy/AValidationStrategy";
import DisputeValidationStrategy from "../validationStrategy/DisputeValidationStrategy";

/**
 * Commits a validated block: persists the snapshot, state and block, signs and
 * gossips it, then fires the follow-up side effects (exit, calldata posting,
 * next participant timeout). Shared by the authoring and ingest paths.
 */
export default class BlockCommitService {
    private readonly logger: Logger;

    constructor(
        private readonly stateManager: StateManager,
        logger: Logger
    ) {
        this.logger = logger.child({ component: "BlockCommit" });
    }

    // ─────────────────────── ACTION HANDLERS ───────────────────────
    public async success(
        block: Block,
        stateSnapshot: StateSnapshot,
        encodedStateMachineState: Bytes,
        successCallback: () => void,
        participantChanges: ParticipantChanges,
        options?: {
            outboundMessageBlock?: MessageBlockStruct;
            strategy?: AValidationStrategy;
            onBlockCommitted?: () => void;
        }
    ): Promise<void> {
        const sm = this.stateManager;
        // step 1 - potentially change status: SYNCED | PENDING_PARTICIPANT → PARTICIPATING
        if (
            sm.status === Status.SYNCED ||
            sm.status === Status.PENDING_PARTICIPANT
        ) {
            const participants = await sm.diamondStateMachine.getParticipants();
            const isParticipant = participants.includes(sm.signerAddress);
            if (isParticipant) {
                sm.setStatus(Status.PARTICIPATING);
                sm.storage.forceJoin.clear();
            } else if (sm.status === Status.PENDING_PARTICIPANT) {
                await sm.membershipService.maybeInitiateForceJoinDispute(
                    block,
                    participants
                );
            }
        }
        // step 2 - persist the state snapshot + state machine state first:
        // shouldSignBlock reads the resulting participants from storage
        sm.storage.stateSnapshots.storeStateSnapshot(stateSnapshot);
        sm.storage.stateMachineStates.storeStateMachineState(
            encodedStateMachineState,
            { hash: stateSnapshot.stateMachineStateHash }
        );

        // step 3 - add my signature if appropriate
        if (
            (await this.shouldSignBlock(block)) &&
            !(options?.strategy instanceof DisputeValidationStrategy)
        ) {
            // Sign the block and add our signature to confirmation signatures
            const signature = await block.sign(sm.signer);
            this.logger.debug("Signing block", {
                block: LoggerUtils.getBlockMetadata(block)
            });
            block.expandSignatures([signature]);
        }

        // step 4 - persist the block // TODO - quick hack - cleaner code later
        sm.storage.blocks.storeBlock(block, {
            justPersist: options?.strategy instanceof DisputeValidationStrategy
        });
        // The block is canonical from here: a failure in the remaining side
        // effects must not roll the VM back behind stored state.
        options?.onBlockCommitted?.();
        P2pEventHooksUtils.maybeNotifyBlockFinalized({
            block,
            storage: sm.storage,
            p2pEventHooks: sm.p2pEventHooks,
            logger: this.logger
        });

        // step 5 - persist the outbound message blocks if any
        if (options?.outboundMessageBlock) {
            sm.storage.outboundMessages.store(options.outboundMessageBlock);
        }

        // TODO - quick hack - cleaner code later
        if (options?.strategy instanceof DisputeValidationStrategy) return;

        // step 6 - persist participant change points
        if (
            participantChanges.left.size > 0 ||
            participantChanges.joined.size > 0
        ) {
            sm.storage.participantSetChanges.storeChangePoint(
                block.forkId,
                block.height
            );
        }

        // step 7 - gossip after local persistence, so echoed confirmations are
        // recognized as duplicates/signature updates instead of being replayed.
        if (
            sm.status === Status.PARTICIPATING &&
            !(options?.strategy instanceof DisputeValidationStrategy)
        ) {
            sm.p2pManager.remoteRpc.stateTransitionService
                .onBlockConfirmation(block.blockConfirmationStruct)
                .broadcast();
        }

        // step 8 - startMaybeExitOnChain
        await sm.membershipService.startMaybeExitOnChain(
            block,
            stateSnapshot,
            participantChanges,
            options?.outboundMessageBlock
        );

        await sm.leaveChannelService.onBlockCommitted(
            block,
            participantChanges
        );

        // step 9 - success callback
        successCallback();

        // step 10 - notify any event hooks
        const nextToWrite = await sm.diamondStateMachine.getNextToWrite();
        const relevantTimestamp = block.getRelevantTimestamp(nextToWrite);
        P2pEventHooksUtils.notifyTurn({
            nextToWrite,
            nextBlockHeight: block.height + 1,
            relevantTimestamp,
            currentTimestamp: Clock.getTimeInSeconds(),
            timeConfig: sm.timeConfig,
            p2pEventHooks: sm.p2pEventHooks,
            logger: this.logger,
            leaveChannelService: sm.leaveChannelService
        });

        // step 11 - maybe post block on chain
        if (block.author === sm.signerAddress) {
            sm.timeoutManager.scheduleTask(
                () => {
                    sm.calldataPostingService.maybePostBlockOnChain(block.hash);
                },
                sm.timeConfig.agreementTime * 1000,
                `maybePostBlockOnChain - block ${block.height} - fork ${block.forkId}`
            );
        }

        // step 12 - schedule a timeout check for the next participant

        sm.participantTimeoutService.scheduleCheck(
            block.forkId,
            block.height + 1, // Check for the next block that the participant should create
            nextToWrite,
            timeoutWaitTime(sm.timeConfig, block.height + 1) * 1000,
            "participantTimeout(onSuccess)"
        );
        // tryExecuteFromQueue is universally scheduled on mutex release
    }

    private async shouldSignBlock(block: Block): Promise<boolean> {
        const sm = this.stateManager;
        if (sm.p2pManager.isBlacklisted(block.author)) return false;
        if (sm.status !== Status.PARTICIPATING) return false;
        // Sign only blocks whose previous/resulting participant union contains
        // us (e.g. never after leaving the channel). The resulting snapshot is
        // persisted before signing, so a missing union means "don't sign".
        const signerUnion = new Set(
            sm.storage.getParticipantsUnion(
                block.coordinates,
                block.stateSnapshotHash
            )
        );
        if (!signerUnion.has(sm.signerAddress)) {
            return false;
        }
        // Check if the block is posted on-chain and I am the next to write
        if (block.onChainTimestamp !== undefined) {
            const nextToWrite = await sm.diamondStateMachine.getNextToWrite();
            if (nextToWrite === sm.signerAddress) {
                return false;
            }
        }

        return true;
    }
}

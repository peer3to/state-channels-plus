import DisputeFraudProofService from "./DisputeFraudProofService";
import type StateManager from "../StateManager";
import DisputeValidationStrategy from "../validationStrategy/DisputeValidationStrategy";
import ADiamondStateMachine from "@/ADiamondStateMachine";
import AgreementManager from "@/agreementManager";
import type { StateProofEvidence } from "@/agreementManager/AgreementManager";
import { Block, StateSnapshot } from "@/models";
import Storage from "@/storage";
import { timeoutWaitTime } from "@/types";
import { Address, Bytes, ChannelId, Hash, Signature } from "@/types/types";
import { isSubset, Logger } from "@/utils";
import { preferLocal } from "@/utils/localDiamond";
import { LoggerUtils } from "@/utils/LoggerUtils";
import { StateChannelManagerInterface } from "@typechain-types";
import {
    SnapshotDataStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import {
    DisputeAuditingDataStruct,
    DisputeStruct
} from "@typechain-types/contracts/V1/types/DisputeTypes";
import { type BytesLike, ethers } from "ethers";

export default class DisputeValidationService {
    private readonly disputeFraudProofService: DisputeFraudProofService;
    private readonly storage: Storage;
    private readonly diamondStateMachine: ADiamondStateMachine;
    private readonly stateChannelManagerContract: StateChannelManagerInterface;
    private readonly agreementManager: AgreementManager;
    private readonly logger: Logger;
    constructor(private readonly stateManager: StateManager) {
        this.logger = stateManager.logger.child({
            component: "DisputeValidationService"
        });
        this.storage = stateManager.storage;
        this.diamondStateMachine = stateManager.diamondStateMachine;
        this.stateChannelManagerContract =
            stateManager.stateChannelManagerContract;
        this.agreementManager = stateManager.agreementManager;
        this.disputeFraudProofService = new DisputeFraudProofService(
            this.storage,
            this.logger
        );
    }

    public async validateDispute(
        dispute: DisputeStruct,
        onChainDisputeAuditingData?: DisputeAuditingDataStruct
    ): Promise<boolean> {
        if (!(await this.isDisputeInboundHashValid(dispute))) {
            this.logger.warn("Dispute inbound hash not in chain", {
                dispute: LoggerUtils.getDisputeMetadata(dispute)
            });
            this.disputeFraudProofService.createDisputeInboundHashNotInChain(
                dispute
            );
            return false;
        }

        // Pure: the local diamond computes exactly what the chain would. An
        // undecodable block is no mismatch; the structure check judges it.
        const hasHeaderMismatch =
            await this.diamondStateMachine.localDiamondContract.hasStateProofHeaderMismatch.staticCall(
                dispute
            );
        if (hasHeaderMismatch) {
            this.logger.warn(
                "DisputeStateProofHeaderMismatch: stateProof header channelId or forkId does not match dispute.input",
                { dispute: LoggerUtils.getDisputeMetadata(dispute) }
            );
            this.disputeFraudProofService.createDisputeStateProofHeaderMismatch(
                dispute
            );
            return false;
        }

        const invalidStructure =
            await this.diamondStateMachine.localDiamondContract.findFirstInvalidBlockStructureInStateProof.staticCall(
                dispute.input.stateProof
            );
        if (invalidStructure.found) {
            this.logger.warn("Auditing: invalid state-proof block structure", {
                dispute: LoggerUtils.getDisputeMetadata(dispute),
                blockIndex: invalidStructure.blockIndex
            });
            this.disputeFraudProofService.createDisputeInvalidBlockStructure(
                dispute,
                Number(invalidStructure.blockIndex)
            );
            return false;
        }

        const data = onChainDisputeAuditingData;
        if (dispute.postedAuditingData && !data)
            throw new Error(
                "Dispute posted with auditing data, but auditing data missing"
            );
        // the data obligation comes before any proof verification
        if (!data && (await this.tryCreateLastMilestoneNotFinalProof(dispute)))
            return false;

        if (await this.tryCreateBelowOnChainAnchorProof(dispute)) return false;

        const evidence = this.getEvidence(dispute, data);
        if (data) {
            if (!(await this.isPostedStateProofValid(dispute, data)))
                return this.rejectStateProof(dispute, data);
            await this.persistVerifiedProof(dispute, data, evidence);
        } else if (
            // without data the handler proves only a broken link or a wrong
            // latest state; a failed finality check alone leaves the dispute valid
            !(await this.isCorrectLatestState(
                dispute,
                evidence.genesisStateSnapshotData
            )) ||
            !(await this.isStateProofLinked(
                dispute,
                evidence.genesisStateSnapshotData
            ))
        ) {
            return this.rejectStateProof(dispute, {
                // the no-data handler reads only the genesis data
                genesisStateSnapshotData: evidence.genesisStateSnapshotData,
                latestStateSnapshot: this.storage.stateSnapshots
                    .getGenesisSnapshotByForkId(dispute.input.forkId)!
                    .toStruct(),
                milestoneSnapshots: [],
                latestFinalizedStateStateMachineState: "0x",
                inboundMessageBlocks: [],
                outboundMessageBlocks: []
            });
        }

        if (await this.tryCreateOnChainSlashesNotSubsetProof(dispute))
            return false;

        if (!(await this.replayLastMilestoneTail(dispute))) return false;

        const latestStateSnapshot =
            this.agreementManager.getLatestSnapshotFromStateProof(
                dispute.input.stateProof,
                dispute.input.forkId
            );
        if (
            await this.tryCreateDisputeInboundAnchorBehindLatestStateProof(
                dispute,
                latestStateSnapshot.toStruct()
            )
        ) {
            return false;
        }

        return await this.continueOtherChecks(dispute, latestStateSnapshot);
    }

    /**
     * Persists the posted proof material its walk verifies: the finalized
     * state, the message blocks, and the blocks and threshold snapshots at or
     * above the walk's start, except the last milestone's replay tail, whose
     * blocks (by identity, also where the proof repeats one earlier) enter
     * storage only through their own replay.
     */
    private async persistVerifiedProof(
        dispute: DisputeStruct,
        disputeAuditingData: DisputeAuditingDataStruct,
        evidence: StateProofEvidence
    ): Promise<void> {
        // verifyStateProof binds the finalized state to the walk's finalized
        // snapshot; it is keyed by its own keccak256 like every state
        this.storage.stateMachineStates.storeStateMachineState(
            disputeAuditingData.latestFinalizedStateStateMachineState
        );

        for (const messageBlock of disputeAuditingData.inboundMessageBlocks) {
            this.storage.inboundMessages.store(messageBlock, {
                justPersist: true
            });
        }

        for (const messageBlock of disputeAuditingData.outboundMessageBlocks) {
            this.storage.outboundMessages.store(messageBlock, {
                justPersist: true
            });
        }

        const verified = await this.agreementManager.verifyStateProof(
            dispute.input,
            evidence
        );
        // the contract verified the posted proof, so its walk is valid
        if (verified.status !== "valid")
            throw new Error(
                "Posted state proof verified, but its walk is invalid"
            );
        const { replayBlockIndex, start } = verified;
        const startHeight = start?.blockHeight ?? 0;
        const snapshots: StateSnapshot[] = start ? [start] : [];

        const lastMilestoneIndex =
            dispute.input.stateProof.milestones.length - 1;
        const isReplay = (milestoneIndex: number, blockIndex: number) =>
            milestoneIndex === lastMilestoneIndex &&
            blockIndex >= replayBlockIndex;
        const tail = new Set<Hash>();
        const kept: Block[] = [];
        dispute.input.stateProof.milestones.forEach((milestone, i) => {
            const confirmations = milestone.blockConfirmations;
            const last = Block.tryFromBlockConfirmation(confirmations.at(-1)!);
            // wholly below the start: dropped by the walk, never verified
            if (!last || last.height < startHeight) return;
            confirmations.forEach((confirmation, j) => {
                const block = Block.tryFromBlockConfirmation(confirmation);
                if (!block || block.height < startHeight) return;
                if (isReplay(i, j)) tail.add(block.hash);
                else kept.push(block);
                // a threshold milestone's first block commits its snapshot;
                // an unfinal genesis block 0 is in the tail and proves none
                const posted = disputeAuditingData.milestoneSnapshots[i];
                if (j === 0 && posted && !isReplay(i, j))
                    snapshots.push(StateSnapshot.from(posted));
            });
        });
        const stored = kept.filter((block) => !tail.has(block.hash));
        for (const block of stored) {
            this.storage.blocks.storeBlock(block, {
                hash: block.hash,
                coordinates: block.coordinates,
                justPersist: true
            });
        }
        // only snapshots a stored block commits: ignored entries never land
        const committed = new Set(
            stored.map((block) => block.stateSnapshotHash)
        );
        for (const snapshot of snapshots) {
            if (snapshot === start || committed.has(snapshot.hash))
                this.storage.stateSnapshots.storeStateSnapshot(snapshot);
        }
    }

    private async tryCreateLastMilestoneNotFinalProof(
        dispute: DisputeStruct
    ): Promise<boolean> {
        if (await this.isLastMilestoneFinalByEveryone(dispute)) return false;
        this.disputeFraudProofService.createDisputeLastMilestoneNotFinalAndNoAuditingData(
            dispute
        );
        return true;
    }

    /**
     * The dispute claims a latest block below the chain's same-fork
     * non-genesis snapshot (an empty proof claims the genesis). Decided from
     * the chain's start, never the mirror's.
     */
    private async tryCreateBelowOnChainAnchorProof(
        dispute: DisputeStruct
    ): Promise<boolean> {
        const chainStart =
            await this.stateChannelManagerContract.getAnchorSnapshot.staticCall(
                dispute.input.channelId,
                dispute.input.forkId
            );
        if (!chainStart.canUseOnChainSnapshot) return false;
        const lastMilestone = dispute.input.stateProof.milestones.at(-1);
        if (lastMilestone) {
            const last = lastMilestone.blockConfirmations.at(-1);
            const latest = last && Block.tryFromBlockConfirmation(last);
            const anchorHeight = Number(chainStart.onChainSnapshot.blockHeight);
            if (!latest || latest.height >= anchorHeight) return false;
        }
        this.logger.warn("Dispute claims a state below the on-chain snapshot", {
            dispute: LoggerUtils.getDisputeMetadata(dispute)
        });
        this.disputeFraudProofService.createDisputeStateProofBelowOnChainAnchor(
            dispute
        );
        return true;
    }

    private rejectStateProof(
        dispute: DisputeStruct,
        auditingData: DisputeAuditingDataStruct
    ): false {
        this.logger.warn("Auditing: Invalid state proof", {
            dispute: LoggerUtils.getDisputeMetadata(dispute)
        });
        this.disputeFraudProofService.createDisputeInvalidStateProof(
            dispute,
            auditingData
        );
        return false;
    }

    /**
     * The walk evidence: the posted data, or without data the fork genesis
     * and each milestone's snapshot from storage. The walk never reads a
     * dropped or start-holding milestone's entry; the genesis fills gaps.
     */
    private getEvidence(
        dispute: DisputeStruct,
        data?: DisputeAuditingDataStruct
    ): StateProofEvidence {
        if (data) {
            const { genesisStateSnapshotData, milestoneSnapshots } = data;
            return { genesisStateSnapshotData, milestoneSnapshots };
        }
        // an auditor audits only its current fork, whose genesis it holds
        const genesis = this.storage.stateSnapshots.getGenesisSnapshotByForkId(
            dispute.input.forkId
        );
        if (!genesis)
            throw new Error(
                `Dispute audit without the genesis of fork ${dispute.input.forkId}`
            );
        return {
            genesisStateSnapshotData: genesis.snapshotData,
            milestoneSnapshots: dispute.input.stateProof.milestones.map(
                ({ blockConfirmations: [first] }) => {
                    const block =
                        first && Block.tryFromBlockConfirmation(first);
                    const snapshot =
                        block &&
                        this.storage.stateSnapshots.getStateSnapshotByHash(
                            block.stateSnapshotHash
                        );
                    return (snapshot ?? genesis).toStruct();
                }
            )
        };
    }

    /**
     * The chain's verdict on posted auditing data: its commitment, the walk,
     * the latest state and the finalized state the walk ends at. The chain
     * alone: a lagging mirror can accept a proof the chain's start rejects.
     */
    private isPostedStateProofValid(
        dispute: DisputeStruct,
        data: DisputeAuditingDataStruct
    ): Promise<boolean> {
        return this.stateChannelManagerContract.verifyStateProof.staticCall(
            dispute,
            data
        );
    }

    /** The chain places the block in the last milestone's unfinal tail: the replay starts there, and each allegation asks again right before it is stored. */
    public isBlockChallengeEligible(
        dispute: DisputeStruct,
        blockIndex: number
    ): Promise<boolean> {
        return this.stateChannelManagerContract.isBlockChallengeEligible.staticCall(
            dispute,
            blockIndex
        );
    }

    /**
     * Replays the last milestone's unfinal tail on the dispute's own chain:
     * from the first block the chain makes challengeable, each judged from
     * the block before it (or the fork genesis), past the tail blocks this
     * auditor already validated. Every replayed snapshot and state stays
     * stored by hash. False when a block is invalid: its dispute fraud proof
     * is stored.
     */
    private async replayLastMilestoneTail(
        dispute: DisputeStruct
    ): Promise<boolean> {
        const { forkId } = dispute.input;
        const tail =
            dispute.input.stateProof.milestones.at(-1)?.blockConfirmations ??
            [];
        // the structure check passed: every block of the last milestone decodes
        const blocks = tail.map((confirmation) =>
            Block.fromBlockConfirmation(confirmation)
        );
        let blockIndex = await this.findTailStart(dispute, tail.length);
        let predecessor = this.storage.getPredecessor(
            forkId,
            blocks[blockIndex - 1]
        );
        if (!predecessor)
            throw new Error(
                `Dispute replay base at block ${blockIndex - 1} of the last milestone is not held`
            );
        for (; blockIndex < blocks.length; blockIndex++) {
            const block = blocks[blockIndex];
            const held =
                this.storage.blocks.getBlock(block.hash) &&
                this.storage.getPredecessor(forkId, block);
            if (!held) break;
            predecessor = held;
        }
        for (; blockIndex < blocks.length; blockIndex++) {
            const isOk =
                await this.stateManager.blockIngestService.onBlockConfirmationStruct(
                    tail[blockIndex],
                    {
                        validationStrategy: new DisputeValidationStrategy(
                            this.storage,
                            dispute,
                            blockIndex,
                            predecessor,
                            this,
                            this.logger
                        ),
                        predecessor
                    }
                );
            if (!isOk) {
                const metadata = {
                    dispute: LoggerUtils.getDisputeMetadata(dispute),
                    block: LoggerUtils.getBlockConfirmationStructMetadata(
                        tail[blockIndex]
                    )
                };
                if (!this.hasStoredDisputeFraudProof(dispute))
                    throw new Error(
                        `Dispute replay refused block ${blockIndex} without a dispute fraud proof`
                    );
                this.logger.warn("Replayed block is invalid", metadata);
                return false;
            }
            const replayed = this.storage.getPredecessor(
                forkId,
                blocks[blockIndex]
            );
            if (!replayed)
                throw new Error(
                    `Replayed block ${blockIndex} left no stored snapshot and state`
                );
            predecessor = replayed;
        }
        this.logger.debug("RUNNING StateProof blocks - completed", {
            dispute: LoggerUtils.getDisputeMetadata(dispute)
        });
        return true;
    }

    /** The first block of the last milestone the chain makes challengeable; eligibility is monotone in the index. */
    private async findTailStart(
        dispute: DisputeStruct,
        length: number
    ): Promise<number> {
        let low = 0;
        let high = length;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (await this.isBlockChallengeEligible(dispute, middle))
                high = middle;
            else low = middle + 1;
        }
        return low;
    }

    /** Stores `DisputeNotLatestState` when the disputer signed a block above `latestHeight`. */
    private tryCreateDisputeNotLatestStateProof(
        dispute: DisputeStruct,
        latestHeight: number
    ): boolean {
        const result = this.agreementManager.getLatestSignedBlockByParticipant(
            dispute.input.forkId,
            dispute.input.disputer
        );
        if (!result || result.block.height <= latestHeight) return false;
        this.logger.debug("Dispute not latest state", {
            dispute: LoggerUtils.getDisputeMetadata(dispute)
        });
        this.disputeFraudProofService.createDisputeNotLatestState(
            dispute,
            result.block.encode(),
            result.signature
        );
        return true;
    }

    private async tryCreateDisputeInboundAnchorBehindLatestStateProof(
        dispute: DisputeStruct,
        latestStateSnapshot: StateSnapshotStruct
    ): Promise<boolean> {
        // the forward walk can never reach a
        // lastInboundMessageBlockHeight below the pinned snapshot's
        // -> objective fraud
        const isInboundAnchorBehind =
            await this.diamondStateMachine.localDiamondContract.isDisputeInboundAnchorBehindLatestState.staticCall(
                dispute,
                latestStateSnapshot
            );
        if (!isInboundAnchorBehind) return false;

        this.logger.warn(
            "Dispute lastInboundMessageBlockHeight is behind its pinned snapshot's latestInboundMessageBlockHeight",
            { dispute: LoggerUtils.getDisputeMetadata(dispute) }
        );
        this.disputeFraudProofService.createDisputeInboundAnchorBehindLatestState(
            dispute,
            latestStateSnapshot
        );
        return true;
    }

    /**
     * The latest state's inputs, held by hash after the replay, and the
     * inbound run the dispute names, recovered from chain logs.
     */
    private async getAuditInputs(
        dispute: DisputeStruct,
        latestStateSnapshot: StateSnapshot
    ) {
        const inboundMessageBlocks =
            await this.stateManager.eventSyncService.loadSynchronizedInboundRun(
                dispute.input.latestInboundMessageBlockHash as Hash,
                latestStateSnapshot.latestInboundMessageBlockHash,
                latestStateSnapshot.timestamp,
                dispute.input.channelId
            );
        if (!inboundMessageBlocks)
            throw new Error(
                "Dispute audit: the inbound run is unavailable after event recovery"
            );
        return {
            genesisStateSnapshotData:
                this.getEvidence(dispute).genesisStateSnapshotData,
            latestStateSnapshot: latestStateSnapshot.toStruct(),
            latestStateMachineState: this.getStateMachineStateForSnapshot(
                latestStateSnapshot.toStruct()
            ),
            inboundMessageBlocks
        };
    }

    /** Stores `DisputeOnChainSlashesNotSubset`; a lagging mirror is double-checked on chain. */
    private async tryCreateOnChainSlashesNotSubsetProof(
        dispute: DisputeStruct
    ): Promise<boolean> {
        const disputeOnChainSlashes = new Set<Address>(
            dispute.input.onChainSlashes
        );
        const isSlashSubset = (slashes: string[]) =>
            isSubset(disputeOnChainSlashes, new Set(slashes as Address[]));
        const onChainSlashes = await this.localFirst(
            (contract) =>
                contract.getOnChainSlashedParticipants(dispute.input.channelId),
            isSlashSubset
        );
        if (isSlashSubset(onChainSlashes)) return false;
        this.disputeFraudProofService.createDisputeOnChainSlashesNotSubset(
            dispute
        );
        return true;
    }

    private async continueOtherChecks(
        dispute: DisputeStruct,
        latestStateSnapshot: StateSnapshot
    ): Promise<boolean> {
        const auditInputs = await this.getAuditInputs(
            dispute,
            latestStateSnapshot
        );
        const { latestStateMachineState } = auditInputs;

        // (STATEFUL - compiler trick) verify balance invariant of the latest state
        if (
            await this.tryCreateBalanceInvariantProof(
                dispute,
                auditInputs.latestStateSnapshot,
                latestStateMachineState
            )
        )
            return false;

        // isLatestState
        if (
            this.tryCreateDisputeNotLatestStateProof(
                dispute,
                Number(auditInputs.latestStateSnapshot.blockHeight)
            )
        )
            return false;

        // all timeout stuff
        if (dispute.input.timeout.participant != ethers.ZeroAddress) {
            // timedout block cooridantes
            const cooridnates = {
                forkId: auditInputs.latestStateSnapshot.forkId,
                height: Number(dispute.input.timeout.blockHeight)
            };
            // participant set at timedout block
            const block = this.storage.blocks.getBlock(
                cooridnates.forkId,
                cooridnates.height
            );
            const participants = this.storage.getParticipantsUnion(
                cooridnates,
                block?.stateSnapshotHash
            );

            // [check] isLinked to stateProof
            const [hasBlock, latestBlock] =
                await this.diamondStateMachine.localDiamondContract.getLatestBlockFromStateProof(
                    dispute.input.stateProof
                );
            const expectedTimeoutHeight = hasBlock
                ? Number(latestBlock.transaction.header.transactionCnt) + 1
                : 0;
            if (
                expectedTimeoutHeight !==
                Number(dispute.input.timeout.blockHeight)
            ) {
                this.disputeFraudProofService.createTimeoutNotLinkedToLatestState(
                    dispute
                );
                return false;
            }

            // [check] isParticipantNext
            const nextToWrite = await this.diamondStateMachine.peekNextToWrite(
                latestStateMachineState
            );
            if (nextToWrite !== dispute.input.timeout.participant) {
                this.disputeFraudProofService.createTimeoutParticipantNotNext(
                    dispute,
                    auditInputs.latestStateSnapshot,
                    latestStateMachineState
                );
                return false;
            }
            // [check] isTimedoutTooEarly
            const timeoutTimestamp = Number(
                await this.diamondStateMachine.localDiamondContract.getDisputeWindowCreationTimestamp(
                    dispute.input.channelId,
                    dispute.input.forkId
                )
            );
            if (!timeoutTimestamp)
                throw new Error(
                    "Timeout timestamp not found, dispute state not synced locally"
                );
            // TODO - cross-audit race: calldata may be posted after the kill decision
            const previousBlockOrSnapshot =
                this.storage.getPreviousBlockOrSnapshot(cooridnates);
            const previousBlock = previousBlockOrSnapshot.block;
            const onChainSignature = dispute.input.timeout
                .participantSignatureOnPreviousBlock as Signature;
            // only the timed-out participant's on-chain signature on the
            // previous block forfeits its extra time
            const isTimeForfeited =
                !!onChainSignature &&
                onChainSignature !== "0x" &&
                previousBlock?.signatureToAddress(onChainSignature) ==
                    dispute.input.timeout.participant;
            const previousTimestamp =
                previousBlockOrSnapshot.stateSnapshot?.timestamp ??
                (isTimeForfeited
                    ? previousBlock!.timestamp
                    : previousBlock!.currentTimestamp);
            // Strict `<` mirrors DisputeFraudProofFacet._handleTimeoutTooEarly:
            // contract slashes when timeoutTimestamp < previousTimestamp + waitTime;
            // at equality the contract accepts the timeout, so we must too.
            if (
                timeoutTimestamp <
                previousTimestamp +
                    timeoutWaitTime(
                        this.stateManager.timeConfig,
                        Number(dispute.input.timeout.blockHeight)
                    )
            ) {
                this.disputeFraudProofService.createTimeoutTooEarly(
                    dispute,
                    auditInputs.genesisStateSnapshotData,
                    previousBlockOrSnapshot?.block?.onChainTimestamp
                );
                return false;
            }

            // [check] N/N Threshold
            if (block && block.didEveryoneSign(participants)) {
                this.disputeFraudProofService.createTimeoutThreshold(
                    dispute,
                    block.blockConfirmationStruct,
                    auditInputs.latestStateSnapshot,
                    this.storage.stateSnapshots
                        .getStateSnapshotByHash(block.stateSnapshotHash)!
                        .toStruct() // should always be in storage since we have the block
                );
                return false;
            }
            // [check] isPostedOnChain
            if (block?.onChainTimestamp) {
                const previousBlockCalldata = previousBlockOrSnapshot?.block
                    ? this.storage.blockCalldata.getBlockCalldata(
                          previousBlockOrSnapshot.block.forkId,
                          previousBlockOrSnapshot.block.height,
                          previousBlockOrSnapshot.block.author
                      )
                    : undefined;
                const proof =
                    this.disputeFraudProofService.buildTimeoutCalldataPosted(
                        auditInputs.genesisStateSnapshotData,
                        auditInputs.latestStateSnapshot,
                        latestStateMachineState,
                        block.signedBlock,
                        block.onChainTimestamp,
                        previousBlockCalldata?.onChainTimestamp || 0,
                        previousBlockCalldata?.signedBlock || block.signedBlock // block.signedBlock if set won't be used it should be fill(0, sizeof(SignedBlockStruct))
                    );
                // The contract owns every predicate used by the apply handler.
                // Preflight the exact proof so an auditor never submits an
                // invalid proof and gets itself slashed.
                // A proof the local mirror rejects is not pursued; one it
                // accepts is confirmed on-chain before it is stored.
                const isValid = await this.localFirst(
                    (contract) =>
                        contract.validateTimeoutCalldataPostedProof.staticCall(
                            proof,
                            dispute
                        ),
                    (isValid) => !isValid
                );
                if (isValid) {
                    this.disputeFraudProofService.storeTimeoutCalldataPosted(
                        dispute,
                        proof
                    );
                    return false;
                }
                this.logger.warn(
                    "TimeoutCalldataPosted proof is not valid on-chain; continuing dispute audit",
                    {
                        dispute: LoggerUtils.getDisputeMetadata(dispute)
                    }
                );
            }
        }

        // [check] dispute input states a reason (same rule as DisputeUtils / InvalidDisputeReason)
        const hasReason =
            await this.diamondStateMachine.localDiamondContract.hasDisputeReason(
                dispute.input,
                auditInputs.latestStateSnapshot
            );

        if (!hasReason) {
            this.logger.warn(
                "Dispute input has no stated reason (timeout, slashes, self-removal, forced inbound, or existing window)",
                {
                    dispute: LoggerUtils.getDisputeMetadata(dispute)
                }
            );
            this.disputeFraudProofService.createInvalidDisputeReason(
                dispute,
                auditInputs.latestStateSnapshot
            );
            return false;
        }

        // verify dispute output
        const isCorrectDisputeOutput =
            await this.diamondStateMachine.localDiamondContract.isDisputeOutputCorrect.staticCall(
                dispute,
                auditInputs.latestStateSnapshot,
                latestStateMachineState,
                auditInputs.inboundMessageBlocks
            );

        if (!isCorrectDisputeOutput) {
            // invalid dispute output
            this.disputeFraudProofService.createDisputeInvalidOutputState(
                dispute,
                auditInputs.latestStateSnapshot,
                latestStateMachineState,
                auditInputs.inboundMessageBlocks
            );
            return false;
        }

        return !this.hasStoredDisputeFraudProof(dispute);
    }

    // ── Local-first checks ────────────────────────────────────────────────
    // Each check runs on the local diamond; only the answer that would make this
    // node act against the disputer is confirmed on-chain (see preferLocal).

    private localFirst<T>(
        read: (contract: StateChannelManagerInterface) => Promise<T>,
        acceptLocal: (answer: T) => boolean
    ): Promise<T> {
        return preferLocal(
            () => read(this.diamondStateMachine.localDiamondContract),
            () => read(this.stateChannelManagerContract),
            acceptLocal
        );
    }

    private isLastMilestoneFinalByEveryone(
        dispute: DisputeStruct
    ): Promise<boolean> {
        return this.localFirst(
            (contract) =>
                contract.isLastMilestoneFinalByEveryone.staticCall(dispute),
            (isFinal) => isFinal
        );
    }

    private isCorrectLatestState(
        dispute: DisputeStruct,
        genesisStateSnapshotData: SnapshotDataStruct
    ): Promise<boolean> {
        return this.localFirst(
            (contract) =>
                contract.isCorrectLatestState.staticCall(
                    dispute,
                    genesisStateSnapshotData
                ),
            (isCorrect) => isCorrect
        );
    }

    private isStateProofLinked(
        dispute: DisputeStruct,
        genesisStateSnapshotData: SnapshotDataStruct
    ): Promise<boolean> {
        const { channelId, forkId, stateProof } = dispute.input;
        return this.localFirst(
            (contract) =>
                contract.isStateProofLinked.staticCall(
                    channelId,
                    forkId,
                    stateProof,
                    genesisStateSnapshotData
                ),
            (isLinked) => isLinked
        );
    }

    private async tryCreateBalanceInvariantProof(
        dispute: DisputeStruct,
        latestStateSnapshot: StateSnapshotStruct,
        latestStateMachineState: Bytes
    ): Promise<boolean> {
        const isValid = await this.isBalanceInvariantValid(
            dispute.input.channelId,
            latestStateSnapshot.snapshotData,
            latestStateMachineState
        );
        if (isValid) return false;
        this.logger.debug("Balance invariant failed", {
            dispute: LoggerUtils.getDisputeMetadata(dispute)
        });
        this.disputeFraudProofService.createDisputeInvalidBalanceInvariant(
            dispute,
            latestStateSnapshot,
            latestStateMachineState
        );
        return true;
    }

    private isBalanceInvariantValid(
        channelId: ChannelId,
        snapshotData: SnapshotDataStruct,
        encodedStateMachineState: BytesLike
    ): Promise<boolean> {
        return this.localFirst(
            (contract) =>
                contract.verifyBalanceInvariantCheckSnapshot.staticCall(
                    channelId,
                    snapshotData,
                    encodedStateMachineState
                ),
            (isValid) => isValid
        );
    }

    private isDisputeInboundHashValid(
        dispute: DisputeStruct
    ): Promise<boolean> {
        return this.localFirst(
            (contract) =>
                contract.isDisputeInboundHashValid.staticCall(dispute),
            (isValid) => isValid
        );
    }

    private getStateMachineStateForSnapshot(
        snapshot: StateSnapshotStruct
    ): Bytes {
        const stateFromSnapshot =
            this.storage.stateMachineStates.getStateMachineState(
                snapshot.snapshotData.stateMachineStateHash
            );

        if (stateFromSnapshot) {
            return stateFromSnapshot;
        }

        throw new Error("State machine state missing for snapshot");
    }

    private hasStoredDisputeFraudProof(dispute: DisputeStruct): boolean {
        return !!this.storage.disputeFraudProofs.getDisputeFraudProofForDispute(
            dispute
        );
    }
}

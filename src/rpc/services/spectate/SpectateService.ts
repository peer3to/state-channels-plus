import { ARpcService, MainRpcService } from "@/rpc";
import { ChannelId, Timestamp, Bytes, Hash, ForkId } from "@/types/types";
import { Block, StateSnapshot } from "@/models";
import Clock from "@/Clock";
import ATransport from "@/transport/ATransport";
import { StateProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import { Codec, hash, Type } from "@/utils";
import { ethers } from "ethers";
import {
    JoinChannelBlockStruct,
    BlockConfirmationStruct,
    ExitChannelBlockStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";

import { DisputeConfirmationStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import SpectateServiceRpcMethods from "./SpectateRpcMethods";
import P2PManager from "@/P2PManager";
import { TimeoutManager } from "@/utils/TimeoutManager";
import { Status } from "@/types";

export interface DisputeWindowVerification {
    disputeConfirmations: DisputeConfirmationStruct[];
    forkId: Hash; // can deduct from disputes - don't need to include here
    latestStateSnapshot: StateSnapshotStruct;
    latestEncodedStateMachineState: Bytes;
    joinChannelBlocksAppliedInReduce: JoinChannelBlockStruct[];
    reducedForkId: Hash; // this is a hint, a soft commitment, so the verifier knows which dispute window to fetch on-chain, before running reduce and verifying
}
export interface SyncPayload {
    disputeWindows: DisputeWindowVerification[];
    latestForkGenesisSnapshot: StateSnapshotStruct;
    stateProof: StateProofStruct;
    milestoneSnapshots: StateSnapshotStruct[];
    latestFinalizedEncodedState: Bytes;
    exitChannelBlocksUpToLatestGenesis: ExitChannelBlockStruct[];
    exitChannelBlocksOfTheLatestFork: ExitChannelBlockStruct[];
}
export interface SyncRequest {
    channelId: ChannelId;
    initTime: Timestamp;
    forkId?: ForkId;
    blockHeight?: number;
}
class SpectateService extends ARpcService<SpectateServiceRpcMethods> {
    requestMap: WeakMap<ATransport, SyncRequest> = new WeakMap<
        ATransport,
        SyncRequest
    >();
    timeoutManager: TimeoutManager;

    constructor(p2pManager: P2PManager) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "SpectateService"
            })
        );
        this.timeoutManager = p2pManager.stateManager.timeoutManager;
    }

    public createRPCMethods(transport: ATransport): SpectateServiceRpcMethods {
        return new SpectateServiceRpcMethods(transport, this);
    }

    // Called locally to initiate spectate sync
    public sync(
        transport: ATransport,
        channelId: ChannelId,
        forkId?: ForkId,
        blockHeight?: number
    ) {
        this.logger.debug("spectateSync !");
        const syncRequest: SyncRequest = {
            channelId,
            initTime: Clock.getTimeInSeconds(),
            forkId,
            blockHeight
        };
        // Store the init time for RTT calculation per channel
        this.requestMap.set(transport, syncRequest);

        this.remoteRpc.spectateService
            .onSpectateRequest(syncRequest)
            .sendOne(transport);

        this.timeoutManager.scheduleTask(
            () => {
                if (!this.didRespond(transport)) this.abort(transport);
            },
            this.p2pManager.stateManager.timeConfig.agreementTime * 1000,
            "SpectateService - spectateSync timeout"
        );
    }

    /**
     * Generate payload to prove the latest possible snapshot
     * (but don't send it on-chain - send it to the spectator)
     */
    public async generateSyncPayload(
        channelId: ChannelId,
        _forkId?: ForkId,
        _blockHeight?: number
    ): Promise<SyncPayload | undefined> {
        const stateManager = this.p2pManager.stateManager;
        const agreementManager = stateManager.agreementManager;
        const diamondStateMachine = stateManager.diamondStateMachine;
        // Get the current fork ID
        const forkId = _forkId || stateManager.forkId;

        // -------- Collect what is needed to prove the latestForkGenesisSnapshot starting from the onChainSnapshot --------
        // We'll do all the computation on our local state. If our local state is not synced we shouldn't even be syncing the spectator and we probably have bigger problems

        // Get current on-chain snapshot to start the fork traversal
        const currentOnChainSnapshot = StateSnapshot.from(
            await diamondStateMachine.localDiamondContract.getStateSnapshot(
                channelId
            )
        );

        const disputeWindows: DisputeWindowVerification[] = [];
        let currentForkId = currentOnChainSnapshot.forkId;
        let isDisputed =
            await diamondStateMachine.localDiamondContract.isForkDisputed(
                channelId,
                currentForkId
            );

        while (isDisputed) {
            // Collect disputes for this dispute window
            // Collect all disputes for this dispute window
            const currentWindowDisputeConfirmations =
                await this.p2pManager.stateManager.agreementManager.getForkDisputeConfirmations(
                    channelId,
                    currentForkId,
                    diamondStateMachine.localDiamondContract
                );

            const currentWindowDisputesHashes =
                currentWindowDisputeConfirmations.map((disputeConfirmation) =>
                    Codec.decode(
                        disputeConfirmation.signedDispute.encodedDispute,
                        Type.Dispute
                    )
                );

            // After collecting disputes for this window, reduce to get the next fork
            const reducedOutput =
                await diamondStateMachine.localDiamondContract.reduce.staticCall(
                    currentWindowDisputesHashes
                );

            const reduceData =
                await this.p2pManager.stateManager.agreementManager.getReduceData(
                    currentForkId,
                    reducedOutput
                );

            // Move to the next fork using local EVM
            const [snapshotData] =
                await diamondStateMachine.localDiamondContract.reduceOutputToSnapshotData.staticCall(
                    currentForkId,
                    reducedOutput,
                    reduceData.latestStateSnapshot,
                    reduceData.encodedStateMachineState,
                    reduceData.joinChannelBlocks
                );
            const reducedForkId = ethers.keccak256(
                Codec.encode(snapshotData, Type.SnapshotData)
            );
            disputeWindows.push({
                disputeConfirmations: currentWindowDisputeConfirmations,
                forkId: currentForkId as Hash,
                latestStateSnapshot: reduceData.latestStateSnapshot,
                latestEncodedStateMachineState:
                    reduceData.encodedStateMachineState,
                joinChannelBlocksAppliedInReduce: reduceData.joinChannelBlocks,
                reducedForkId
            });
            currentForkId = reducedForkId;
            isDisputed =
                await diamondStateMachine.localDiamondContract.isForkDisputed(
                    channelId,
                    currentForkId
                );
        }

        if (currentForkId != forkId)
            throw new Error("Reduce and iterate didn't derive the latest fork");

        // -------- Collect what is needed to prove the latest possible state in the latest fork ---------

        // Get the latest fork genesis snapshot to include in the payload
        const latestForkGenesisSnapshot =
            stateManager.storage.stateSnapshots.getGenesisSnapshotDataByForkId(
                forkId
            );
        if (!latestForkGenesisSnapshot) {
            throw new Error(`No genesis snapshot found for fork ${forkId}`);
        }

        const exitChannelBlocksUpToLatestGenesis =
            stateManager.storage.exitChannelBlocks.getBlocksInRange(
                latestForkGenesisSnapshot.latestExitBlockHash,
                currentOnChainSnapshot.latestExitBlockHash
            );

        const latestBlockHeight =
            stateManager.storage.blocks.getNextBlockHeight(forkId) - 1;

        // There are blocks, so we can do a same-fork update
        const latestStateProof = await agreementManager.tryGetStateProof(
            forkId,
            _blockHeight || latestBlockHeight
        );

        if (!latestStateProof) {
            this.logger.debug(
                `No state proof found for fork ${forkId} blockHeight ${_blockHeight || latestBlockHeight}`
            );
            return undefined;
        }
        // Collect concrete milestone snapshots
        const milestoneSnapshots: StateSnapshot[] =
            latestStateProof.milestones.map((m) => {
                const snapshot = agreementManager.getSnapshotFromMilestone(m);
                if (!snapshot) {
                    throw new Error(
                        "Missing milestone snapshot for provided proof"
                    );
                }
                return snapshot;
            });

        // As for a snapshot update, we prove the latest finalized one and from that one the peer can start performing SMR and validating each ST.
        const latestFinalizedMilestoneSnapshot =
            milestoneSnapshots.length > 0
                ? milestoneSnapshots.at(-1)!
                : latestForkGenesisSnapshot;

        const stateHash =
            latestFinalizedMilestoneSnapshot.snapshotData.stateMachineStateHash;
        const latestFinalizedEncodedState =
            stateManager.storage.stateMachineStates.getStateMachineState(
                stateHash
            );
        if (!latestFinalizedEncodedState) {
            throw new Error(
                `No encoded state found for state hash ${stateHash}`
            );
        }

        const exitChannelBlocksOfTheLatestFork =
            stateManager.storage.exitChannelBlocks.getBlocksInRange(
                latestFinalizedMilestoneSnapshot.latestExitBlockHash,
                latestForkGenesisSnapshot.latestExitBlockHash
            );
        // Return payload with all available data
        return {
            disputeWindows,
            latestForkGenesisSnapshot,
            stateProof: latestStateProof,
            milestoneSnapshots,
            latestFinalizedEncodedState,
            exitChannelBlocksUpToLatestGenesis,
            exitChannelBlocksOfTheLatestFork
        };
    }

    /**
     * Fetch latest on-chain snapshot
     */
    public async fetchAndPersistOnChainSnapshot(
        channelId: ChannelId
    ): Promise<StateSnapshot> {
        // Fetch the latest on-chain snapshot from RPC node
        // Assume it's true since it's on-chain
        const currentOnChainSnapshot = StateSnapshot.from(
            await this.p2pManager.stateManager.stateChannelManagerContract.getStateSnapshot(
                channelId
            )
        );
        // sync our local EVM to it
        this.p2pManager.stateManager.eventHandler.onStateSnapshotUpdated(
            channelId,
            currentOnChainSnapshot
        );
        return currentOnChainSnapshot;
    }

    /**
     * Fetch relevant disputeWindows
     */
    public async fetchAndPersistOnChainDisputeWindows(
        channelId: ChannelId,
        forkIds: ForkId[]
    ) {
        const disputeWindows =
            await this.p2pManager.stateManager.stateChannelManagerContract.getDisputeWindows(
                channelId,
                forkIds
            );

        for (const dw of disputeWindows) {
            await this.p2pManager.stateManager.diamondStateMachine.localDiamondContract.persistDisputeWindow(
                channelId,
                dw
            );
        }
    }

    public async tryMulticallSnapshotUpdate(
        channelId: ChannelId,
        onChainSnapshot: StateSnapshotStruct,
        syncPayload: SyncPayload,
        disputeWindowsThatNeedToBeReducedOnChain: DisputeWindowVerification[]
    ): Promise<boolean> {
        const stateManager = this.p2pManager.stateManager;
        const stateChannelManagerContract =
            stateManager.stateChannelManagerContract;
        // Encode data for multicall
        const calldata: string[] = [];
        for (const dw of disputeWindowsThatNeedToBeReducedOnChain) {
            const reduceCalldata =
                stateChannelManagerContract.interface.encodeFunctionData(
                    "reduceAndFinalize",
                    [
                        dw.disputeConfirmations.map((disputeConfirmation) =>
                            Codec.decode(
                                disputeConfirmation.signedDispute
                                    .encodedDispute,
                                Type.Dispute
                            )
                        ),
                        dw.latestStateSnapshot,
                        dw.latestEncodedStateMachineState,
                        dw.joinChannelBlocksAppliedInReduce
                    ]
                );
            calldata.push(reduceCalldata);
        }
        // check if we need to update the genesis snapshot first
        if (
            onChainSnapshot.forkId !=
            syncPayload.latestForkGenesisSnapshot.forkId
        ) {
            const snapshotCalldata =
                stateChannelManagerContract.interface.encodeFunctionData(
                    "updateStateSnapshotFork",
                    [
                        channelId,
                        syncPayload.latestForkGenesisSnapshot,
                        syncPayload.exitChannelBlocksUpToLatestGenesis
                    ]
                );
            calldata.push(snapshotCalldata);
        }

        // check if we need to update the snapshot on the same fork
        if (syncPayload.milestoneSnapshots.length > 0) {
            const snapshotCalldata =
                stateChannelManagerContract.interface.encodeFunctionData(
                    "updateStateSnapshotSameFork",
                    [
                        channelId,
                        syncPayload.stateProof.milestones,
                        syncPayload.milestoneSnapshots,
                        syncPayload.exitChannelBlocksOfTheLatestFork
                    ]
                );
            calldata.push(snapshotCalldata);
        }
        if (calldata.length > 0) {
            try {
                await stateChannelManagerContract.multicall.staticCall(
                    calldata
                );
            } catch (e) {
                this.logger.debug(e);
                return false;
            }
        }
        return true;
    }

    public persistSyncPayload(syncPayload: SyncPayload) {
        // TODO - check in the case of syncing to the requested (forkId, blockHeight), that storage stays consistent - what was already there should still be there
        const storage = this.p2pManager.stateManager.storage;
        for (const dw of syncPayload.disputeWindows) {
            for (const dispute of dw.disputeConfirmations) {
                storage.disputes.storeDisputeConfirmation(dispute);
            }
            storage.stateSnapshots.storeStateSnapshot(
                StateSnapshot.from(dw.latestStateSnapshot)
            );
            storage.stateMachineStates.storeStateMachineState(
                dw.latestEncodedStateMachineState
            );
            for (const jcb of dw.joinChannelBlocksAppliedInReduce) {
                storage.joinChannelBlocks.storeJoinChannelBlock(jcb);
            }
        }
        storage.stateSnapshots.storeStateSnapshot(
            StateSnapshot.from(syncPayload.latestForkGenesisSnapshot)
        );
        this.persistFinalizedPartsOfStateProof(syncPayload.stateProof);
        for (const snapshot of syncPayload.milestoneSnapshots)
            storage.stateSnapshots.storeStateSnapshot(
                StateSnapshot.from(snapshot)
            );
        storage.stateMachineStates.storeStateMachineState(
            syncPayload.latestFinalizedEncodedState
        );
        for (const ecb of syncPayload.exitChannelBlocksUpToLatestGenesis)
            storage.exitChannelBlocks.storeExitChannelBlock(ecb);
        for (const ecb of syncPayload.exitChannelBlocksOfTheLatestFork)
            storage.exitChannelBlocks.storeExitChannelBlock(ecb);
    }
    public persistFinalizedPartsOfStateProof(stateProof: StateProofStruct) {
        const storage = this.p2pManager.stateManager.storage;
        // for all milestones except the last persist all blocks
        for (let i = 0; i < stateProof.milestones.length - 1; i++) {
            for (const blockConfirmation of stateProof.milestones[i]
                .blockConfirmations) {
                storage.blocks.storeBlock(
                    Block.fromBlockConfirmation(blockConfirmation)
                );
            }
        }
        // for the last milestone persist just the first (finalized) block
        const lastMilestone = stateProof.milestones.at(-1);
        if (lastMilestone) {
            storage.blocks.storeBlock(
                Block.fromBlockConfirmation(lastMilestone.blockConfirmations[0])
            );
        }
    }

    public didRespond(transport: ATransport): boolean {
        return !this.requestMap.has(transport);
    }

    public abort(transport: ATransport) {
        if (this.p2pManager.stateManager.getStatus() == Status.SPECTATING) {
            this.p2pManager.disconnectAll();
            return;
        }

        return this.p2pManager.disconnectAndBlacklistPeer(transport);
    }
}

export default SpectateService;

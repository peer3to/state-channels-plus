import ARpcService from "@/rpc/ARpcService";
import { Address, ChannelId, Timestamp, Hash, ForkId } from "@/types/types";
import { Block, StateSnapshot } from "@/models";
import Clock from "@/Clock";
import ATransport from "@/transport/ATransport";
import { Codec, getChecksumAddress, tryDecodeCustomError, Type } from "@/utils";
import { ethers } from "ethers";
import { StateProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import { StateSnapshotStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import SpectateServiceRpcMethods from "./SpectateRpcMethods";
import type P2PManager from "@/P2PManager";
import { TimeoutManager } from "@/utils/TimeoutManager";
import { Status } from "@/types";
import { HandshakeCompletedGuard } from "@/rpc/guards";
import { DisputeWindowVerification, SyncPayload } from "@/types";
export interface SyncRequest {
    channelId: ChannelId;
    initTime: Timestamp;
    forkId?: ForkId;
    blockHeight?: number;
}
class SpectateService extends ARpcService<SpectateServiceRpcMethods> {
    private readonly requestMapByPeerAddress: Map<string, SyncRequest> =
        new Map();
    timeoutManager: TimeoutManager;

    constructor(p2pManager: P2PManager) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "SpectateService"
            })
        );
        this.timeoutManager = p2pManager.stateManager.timeoutManager;
        this.guards = [new HandshakeCompletedGuard(this)];
    }

    public createRPCMethods(transport: ATransport): SpectateServiceRpcMethods {
        return new SpectateServiceRpcMethods(transport, this);
    }

    // Called locally to initiate spectate sync
    public sync(
        peerAddress: Address,
        channelId: ChannelId,
        forkId?: ForkId,
        blockHeight?: number
    ) {
        this.logger.debug("spectateSync - starting", {
            peerAddress,
            channelId,
            forkId,
            blockHeight
        });
        const normalizedPeerAddress = getChecksumAddress(peerAddress);

        if (this.requestMapByPeerAddress.has(normalizedPeerAddress)) {
            this.logger.debug(
                "spectateSync - sync already in-flight; ignoring",
                { peerAddress: normalizedPeerAddress }
            );
            return;
        }

        const syncRequest: SyncRequest = {
            channelId,
            initTime: Clock.getTimeInSeconds(),
            forkId,
            blockHeight
        };

        this.timeoutManager.scheduleTask(
            () => {
                const pending = this.requestMapByPeerAddress.get(
                    normalizedPeerAddress
                );
                if (!pending) return;
                if (pending.initTime !== syncRequest.initTime) return;

                this.requestMapByPeerAddress.delete(normalizedPeerAddress);

                this.logger.debug(
                    "SpectateService - spectateSync timeout; blacklisting peer",
                    { peerAddress: normalizedPeerAddress }
                );

                this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
                    normalizedPeerAddress
                );
            },
            this.p2pManager.stateManager.timeConfig.agreementTime * 1000,
            `SpectateService - spectateSync timeout - peer ${normalizedPeerAddress}`
        );

        this.requestMapByPeerAddress.set(normalizedPeerAddress, syncRequest);

        // Transport can change (e.g. WebRTC upgrade). Always send by address.
        this.remoteRpc.spectateService
            .onSpectateRequest(syncRequest)
            .sendOne(normalizedPeerAddress);
    }

    public takePendingRequestByPeerAddress(
        peerAddress: string
    ): SyncRequest | undefined {
        const pending = this.requestMapByPeerAddress.get(peerAddress);
        if (!pending) return undefined;

        this.requestMapByPeerAddress.delete(peerAddress);
        return pending;
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
        // We'll do all the computation on our local state.
        // If our local state is not synced we shouldn't even be syncing the spectator and we probably have bigger problems

        const currentOnChainSnapshot = StateSnapshot.from(
            await diamondStateMachine.localDiamondContract.getStateSnapshot(
                channelId
            )
        );

        const disputeWindows: DisputeWindowVerification[] = [];
        let currentForkId = currentOnChainSnapshot.forkID;
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
                    reduceData.inboundMessageBlocks
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
                inboundMessageBlocksAppliedInReduce:
                    reduceData.inboundMessageBlocks,
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
            stateManager.storage.stateSnapshots.getGenesisSnapshotByForkId(
                forkId
            );
        if (!latestForkGenesisSnapshot) {
            throw new Error(`No genesis snapshot found for fork ${forkId}`);
        }
        const latestForkGenesisEncodedState =
            stateManager.storage.stateMachineStates.getStateMachineState(
                latestForkGenesisSnapshot.snapshotData.stateMachineStateHash
            );
        if (!latestForkGenesisEncodedState) {
            throw new Error(
                `No encoded state found for latest fork genesis state hash ${latestForkGenesisSnapshot.snapshotData.stateMachineStateHash}`
            );
        }

        const outboundMessageBlocksUpToLatestGenesis =
            stateManager.storage.outboundMessages.getMessageBlocksInRange({
                upperBlockHash:
                    latestForkGenesisSnapshot.latestOutboundMessageBlockHash,
                lowerBlockHash:
                    currentOnChainSnapshot.latestOutboundMessageBlockHash
            });

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
        const latestFinalizedSnapshot =
            milestoneSnapshots.length > 0
                ? milestoneSnapshots.at(-1)!
                : latestForkGenesisSnapshot;

        const stateHash =
            latestFinalizedSnapshot.snapshotData.stateMachineStateHash;
        const latestFinalizedEncodedState =
            stateManager.storage.stateMachineStates.getStateMachineState(
                stateHash
            );
        if (!latestFinalizedEncodedState) {
            throw new Error(
                `No encoded state found for state hash ${stateHash}`
            );
        }

        const outboundMessageBlocksOfTheLatestFork =
            stateManager.storage.outboundMessages.getMessageBlocksInRange({
                upperBlockHash:
                    latestFinalizedSnapshot.latestOutboundMessageBlockHash,
                lowerBlockHash:
                    latestForkGenesisSnapshot.latestOutboundMessageBlockHash
            });
        // Return payload with all available data
        const syncPayload: SyncPayload = {
            disputeWindows,
            latestForkGenesisSnapshot: latestForkGenesisSnapshot.toStruct(),
            latestForkGenesisEncodedState,
            stateProof: latestStateProof,
            milestoneSnapshots: milestoneSnapshots.map((ms) => ms.toStruct()),
            latestFinalizedEncodedState,
            outboundMessageBlocksUpToLatestGenesis,
            outboundMessageBlocksOfTheLatestFork
        };
        this.logger.debug(`Generated syncpayload`, syncPayload);
        return syncPayload;
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
        await this.p2pManager.stateManager.eventHandler.onStateSnapshotUpdated(
            channelId,
            currentOnChainSnapshot.toStruct()
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
        const contractInterface =
            stateChannelManagerContract.interface as ethers.Interface;
        // Encode data for multicall
        const calldata: string[] = [];
        for (const dw of disputeWindowsThatNeedToBeReducedOnChain) {
            const reduceCalldata = contractInterface.encodeFunctionData(
                "reduceAndFinalize",
                [
                    dw.disputeConfirmations.map((disputeConfirmation) =>
                        Codec.decode(
                            disputeConfirmation.signedDispute.encodedDispute,
                            Type.Dispute
                        )
                    ),
                    dw.latestStateSnapshot,
                    dw.latestEncodedStateMachineState,
                    dw.inboundMessageBlocksAppliedInReduce
                ]
            );
            calldata.push(reduceCalldata);
        }
        // check if we need to update the genesis snapshot first
        if (
            onChainSnapshot.forkId !=
            syncPayload.latestForkGenesisSnapshot.forkId
        ) {
            const snapshotCalldata = contractInterface.encodeFunctionData(
                "updateStateSnapshotFork",
                [
                    channelId,
                    syncPayload.latestForkGenesisSnapshot,
                    syncPayload.outboundMessageBlocksUpToLatestGenesis
                ]
            );
            calldata.push(snapshotCalldata);
        }

        // check if we need to update the snapshot on the same fork
        if (syncPayload.milestoneSnapshots.length > 0) {
            const anchor =
                onChainSnapshot.snapshotData.latestOutboundMessageBlockHash;

            const outboundBlocksForSameFork =
                await stateManager.diamondStateMachine.localDiamondContract.pruneOutboundMessageBlocks(
                    syncPayload.outboundMessageBlocksOfTheLatestFork,
                    anchor
                );
            const snapshotCalldata = contractInterface.encodeFunctionData(
                "updateStateSnapshotSameFork",
                [
                    channelId,
                    syncPayload.stateProof.milestones,
                    syncPayload.milestoneSnapshots,
                    outboundBlocksForSameFork
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
                const custom = tryDecodeCustomError(e);
                this.logger.error(
                    "Spectate multicall error",
                    custom,
                    calldata,
                    e
                );
                return false;
            }
        }
        return true;
    }

    public async persistSyncPayload(syncPayload: SyncPayload) {
        this.logger.debug(`Persisting sync payload`, syncPayload);
        // TODO - check in the case of syncing to the requested (forkId, blockHeight), that storage stays consistent - what was already there should still be there
        const storage = this.p2pManager.stateManager.storage;

        const latestFinalizedSnapshot =
            syncPayload.milestoneSnapshots.length > 0
                ? syncPayload.milestoneSnapshots.at(-1)!
                : syncPayload.latestForkGenesisSnapshot;

        const finalizedForkId = latestFinalizedSnapshot.forkId;
        const finalizedHeight = Number(latestFinalizedSnapshot.blockHeight);
        const localLatestBlock = storage.blocks.getLatestBlock(finalizedForkId);
        const localLatestHeight = localLatestBlock?.height ?? -1;

        if (localLatestHeight >= finalizedHeight) {
            this.logger.info(
                "Skipping sync payload persistence: local storage is already ahead of latest finalized snapshot",
                {
                    finalizedForkId,
                    finalizedHeight,
                    localLatestHeight
                }
            );
            return;
        }

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
            for (const inboundBlock of dw.inboundMessageBlocksAppliedInReduce) {
                storage.inboundMessages.store(inboundBlock);
            }
        }
        storage.stateSnapshots.storeStateSnapshot(
            StateSnapshot.from(syncPayload.latestForkGenesisSnapshot)
        );
        storage.stateMachineStates.storeStateMachineState(
            syncPayload.latestForkGenesisEncodedState,
            {
                hash: syncPayload.latestForkGenesisSnapshot.snapshotData
                    .stateMachineStateHash
            }
        );
        this.persistFinalizedPartsOfStateProof(syncPayload.stateProof);
        for (const snapshot of syncPayload.milestoneSnapshots)
            storage.stateSnapshots.storeStateSnapshot(
                StateSnapshot.from(snapshot)
            );
        for (const omb of syncPayload.outboundMessageBlocksUpToLatestGenesis)
            storage.outboundMessages.store(omb);
        for (const omb of syncPayload.outboundMessageBlocksOfTheLatestFork)
            storage.outboundMessages.store(omb);

        await this.p2pManager.stateManager.setLatestState(
            latestFinalizedSnapshot,
            syncPayload.latestFinalizedEncodedState
        );
        this.logger.debug(`Finished persisting sync payload`);
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
    public abort(peerAddress: string) {
        // HandshakeCompletedGuard guarantees stable peer identity.
        // If we're not actively participating, treat this as a fatal sync failure.
        this.logger.warn(`Aborting spectate sync with peer ${peerAddress}`, {
            peerAddress,
            myStatus: Status[this.p2pManager.stateManager.getStatus()]
        });
        if (this.p2pManager.stateManager.getStatus() !== Status.PARTICIPATING) {
            this.p2pManager.disconnectAll();
            return;
        }

        // If participating, punish only the offending peer.
        return this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
            peerAddress
        );
    }
}

export default SpectateService;

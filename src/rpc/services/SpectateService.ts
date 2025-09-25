import { ARpcService, MainRpcService } from "@/rpc";
import { ChannelId, Timestamp, Bytes, Hash, ForkId } from "@/types/types";
import { StateSnapshot } from "@/models";
import Clock from "@/Clock";
import ATransport from "@/transport/ATransport";
import { StateProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { Codec, Type } from "@/utils";
import { ethers } from "ethers";
import { JoinChannelBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import {
    ExitChannelBlockStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/StateChannelManagerEvents";

export interface DisputeWndowVerification {
    disputes: DisputeStruct[];
    forkId: Hash; // can deduct from disputes - don't need to include here
    latestStateSnapshot: StateSnapshotStruct;
    latestEncodedStateMachineState: Bytes;
    joinChannelBlocksAppliedInReduce: JoinChannelBlockStruct[];
    reducedForkId: Hash; // this is a hint, a soft commitment, so the verifier knows which dispute window to fetch on-chain, before running reduce and verifying
}
export interface SyncPayload {
    disputeWindows: DisputeWndowVerification[];
    latestForkGenesisSnapshot: StateSnapshotStruct;
    stateProof: StateProofStruct;
    milestoneSnapshots: StateSnapshotStruct[];
    latestFinalizedEncodedState: Bytes;
    exitChannelBlocksUpToLatestGenesis: ExitChannelBlockStruct[];
    exitChannelBlocksOfTheLatestFork: ExitChannelBlockStruct[];
}

class SpectateService extends ARpcService {
    private spectateInitTimes: WeakMap<ATransport, number> = new WeakMap<
        ATransport,
        number
    >();

    constructor(mainRpcService: MainRpcService) {
        super(mainRpcService);
    }

    // Called locally to initiate spectate sync
    public spectateSync(transport: ATransport, channelId: ChannelId) {
        console.log("spectateSync !");
        let time = Clock.getTimeInSeconds();

        // Store the init time for RTT calculation per channel
        this.spectateInitTimes.set(transport, time);

        this.mainRpcService.rpcProxy
            .onSpectateRequest(channelId, time)
            .sendOne(transport);

        setTimeout(() => {
            if (!this.didRespond(transport))
                this.mainRpcService.p2pManager.disconnectConnection(transport);
        }, this.mainRpcService.p2pManager.stateManager.timeConfig.agreementTime);
    }

    public async onSpectateRequest(channelId: ChannelId, time: Timestamp) {
        const localTime = Clock.getTimeInSeconds();

        console.log(
            `onSpectateRequest - localTime: ${localTime}, remoteTime: ${time}`
        );

        // Generate payload to prove the latest possible snapshot
        // (but don't send it on-chain - send it to the spectator)
        const snapshotPayload = await this.generateSnapshotPayload(channelId);

        console.log(`onSpectateRequest - done`);
        this.mainRpcService.rpcProxy
            .onSpectateResponse(channelId, snapshotPayload, localTime)
            .sendOne(this.mainRpcService.senderTransport!);
    }

    public async onSpectateResponse(
        channelId: ChannelId,
        snapshotPayload: SyncPayload
    ) {
        try {
            console.log(`onSpectateResponse - start`);
            const senderTransport = this.mainRpcService.senderTransport!;
            const initTime = this.spectateInitTimes.get(senderTransport);
            this.spectateInitTimes.delete(senderTransport);
            if (!initTime) {
                console.log(
                    "onSpectateResponse - no init time found for channel"
                );
                this.mainRpcService.p2pManager.disconnectAll(); // someone trying to sync us without us asking -> not cooperating
                return;
            }

            let localTime = Clock.getTimeInSeconds();
            let rtt = localTime - initTime;

            console.log(
                `onSpectateResponse - RTT: ${rtt}s, initTime: ${initTime}, responseTime: ${localTime}`
            );

            // If RTT is too high, disconnect from all peers
            if (
                rtt >
                this.mainRpcService.p2pManager.stateManager.timeConfig
                    .agreementTime
            ) {
                console.log(
                    `onSpectateResponse - RTT too high (${rtt}s), disconnecting from all peers`
                );
                this.mainRpcService.p2pManager.disconnectAll();
                return;
            }

            // What we ultimately want to do here is:
            // 1) Sync/Fetch all the relevant EVM storage data from the chain and persist it in our localEVM
            // 2) Run/reuse the 'updateStateSnapshotFork' & 'updateStateSnapshotSameFork' as a function of:
            //      2.1) The fetched/synced EVM on-chain state which we know is true
            //      2.2) The provided SyncPayload which will be verified against the fetched data
            // 3) While reusing 'updateStateSnapshotFork' & 'updateStateSnapshotSameFork' perform the call as `eth_call` would work on an RPC node
            // This esentially simulates a 'tx' (allows 'sstore' and other state mutating opcodes and creates logs), but does NOT persist the changes (so we keep our EVM state consistent to the one on-chain)
            // This verifies/proves to us that the payload is correct and that the state can really be 'teleported' to what the other peer is claiming to be the latest state and that the data provided to us is correct
            // 4) Deconstruct the SyncPayload and persist its component normally in our local 'storage'
            // This allows us to manually update the snapshot later at will AT LEAST to the state that we were synced (that's why we're reusing the solidity function, so we know that the TX will succeed)
            //
            // Up to this point we've verified the last finalized state given to us
            // What do we do next?
            // queue all the unfinalized stateProof blocks
            // (other blocks that we're incoming would also be queued while we sync)
            // set some syncFlag to true that will start executing the onBlockConfirmation pipeline with `SpectateStrategy`

            // So what we'll actually do here until the above stuff is implemented:
            // 1) Fetch the onChainSnapshot and persist/update the local EVM with it
            // 2) Fetch all disputeWindows that where provided in the SyncPayload, verify that they're expired on-cahin and persist/update the localEVM with them
            // 3) Run statefull reduce on our dispute windows in our local EVM - this may be a divergence from the on-chain state, but the on-chain one will have to reduce to the same one if expired - think of it as a CRDT where this time we're leading/ahead locally and the chain will eventualy reflect the same state
            //      Later this will be `eth_call`(multicall(reduceAll,updateStateSnapshotFork,updateStateSnapshotSameFork)) a single atomic transaction that doesn't persist the state locally, so we don't have edge cases when we 'do' persit and when we 'do not'
            // 4) Locally run 'updateStateSnapshotFork' & 'updateStateSnapshotSameFork' to deduct failure/success
            // 5) Deconstruct the SyncPayload and persist its component normally in our local 'storage'
            // This allows us to manually update the snapshot later at will AT LEAST to the state that we were synced (that's why we're reusing the solidity function, so we know that the TX will succeed)
            //
            // 6) on success - restore the correct onChainSnapshot in our localEVM to reflect the one on-chain we use for chaching
            //       check balance invariant of the latestFinalizedState
            //       set some syncFlag to true that will start executing the onBlockConfirmation pipeline with `SpectateStrategy`
            //    on failure - abort/disconnectAll
            //

            // ******* TODO - updateStateSnapshotFork/updateStateSnapshotSameFork need dummy contracts to process withdrawals
            const stateManager = this.mainRpcService.p2pManager.stateManager;
            const diamondStateMachine = stateManager.diamondStateMachine;

            // Fetch latest on-chain snapshot from RPC node
            const onChainSnapshot = await this.fetchOnChainSnapshot(channelId);
            const forkIds = snapshotPayload.disputeWindows.map(
                (disputeWindow) => disputeWindow.forkId
            );
            await this.fetchAndPersistOnChainDisputeWindows(channelId, forkIds);

            for (const dw of snapshotPayload.disputeWindows) {
                await diamondStateMachine.localDiamondContract.reduceAndFinalize(
                    dw.disputes,
                    dw.latestStateSnapshot,
                    dw.latestEncodedStateMachineState,
                    dw.joinChannelBlocksAppliedInReduce
                );
                // if the above call fails -> local evm will throw -> catch and abort
            }

            await diamondStateMachine.localDiamondContract.updateStateSnapshotFork(
                channelId,
                snapshotPayload.latestForkGenesisSnapshot,
                snapshotPayload.exitChannelBlocksUpToLatestGenesis
            );
            await diamondStateMachine.localDiamondContract.updateStateSnapshotSameFork(
                channelId,
                snapshotPayload.stateProof.milestones,
                snapshotPayload.milestoneSnapshots,
                snapshotPayload.exitChannelBlocksOfTheLatestFork
            );
            // TODO! verify latestFinalizedMilestone commits to latestFinalizedEncodedState
            // TODO! check invariant - what about balance tracking?
            // TODO! restore old onChainSnapshot (the actual current one) so the local evm state is consistant
            // TODO! Deconstruct SyncPayload and persist components in storage
            // TODO? - have a dryRun implementation to simplify these storage things in the short/mid term
            // if we're here - the local EVM validated the sync to the latestFinalizedState

            // few more things

            console.log("Spectator successfully synced to latest proven state");
        } catch (e) {
            this.mainRpcService.p2pManager.disconnectAll();
            console.log(e);
        }
    }

    /**
     * Generate payload to prove the latest possible snapshot
     * (but don't send it on-chain - send it to the spectator)
     */
    private async generateSnapshotPayload(
        channelId: ChannelId
    ): Promise<SyncPayload> {
        const stateManager = this.mainRpcService.p2pManager.stateManager;
        const agreementManager = stateManager.agreementManager;
        const diamondStateMachine = stateManager.diamondStateMachine;
        // Get the current fork ID
        const forkId = stateManager.forkId;

        // -------- Collect what is needed to prove the latestForkGenesisSnapshot starting from the onChainSnapshot --------
        // We'll do all the computation on our local state. If our local state is not synced we shouldn't even be syncing the spectator and we probably have bigger problems

        // Get current on-chain snapshot to start the fork traversal
        const currentOnChainSnapshot = StateSnapshot.from(
            await diamondStateMachine.localDiamondContract.getStateSnapshot(
                channelId
            )
        );

        let disputeWindows: DisputeWndowVerification[] = [];
        let currentForkId = currentOnChainSnapshot.forkId;
        let isDisputed =
            await diamondStateMachine.localDiamondContract.isForkDisputed(
                channelId,
                currentForkId
            );

        while (isDisputed) {
            // Collect disputes for this dispute window
            const disputeCommitments =
                await diamondStateMachine.localDiamondContract.getWindowCommitments(
                    channelId,
                    currentForkId
                );
            // Collect all disputes for this dispute window
            const currentWindowDisputes: DisputeStruct[] = [];
            for (const commitment of disputeCommitments) {
                const confirmation =
                    stateManager.storage.disputes.getDisputeConfirmation(
                        commitment
                    );
                if (!confirmation) {
                    throw new Error(
                        `Missing Data Availability for dispute commitment ${commitment}`
                    );
                }
                const dispute = Codec.decode(
                    confirmation.signedDispute.encodedDispute,
                    Type.Dispute
                ) as DisputeStruct;
                currentWindowDisputes.push(dispute);
            }

            // After collecting disputes for this window, reduce to get the next fork
            const reducedOutput =
                await diamondStateMachine.localDiamondContract.reduceProxyView(
                    currentWindowDisputes
                );

            // reducedOutput latestStateSnapshot
            const reducedLatestStateSnapshot =
                stateManager.storage.stateSnapshots.getStateSnapshotByHash(
                    reducedOutput.latestBlock.stateSnapshotHash
                );
            if (!reducedLatestStateSnapshot)
                throw new Error(
                    "Missing latestStateSnapshot for reducedOutput in storage for syncing"
                );

            // Get the corresponding stateMachineState
            const reducedLatestEncodedStateMachineState =
                stateManager.storage.stateMachineStates.getStateMachineState(
                    reducedLatestStateSnapshot.stateMachineStateHash
                );
            if (!reducedLatestEncodedStateMachineState)
                throw new Error(
                    "Missing latestEncodedState for reducedOutput in storage for syncing"
                );

            // Get joinChannelBlocks that were applied during reduce
            const joinChannelBlocksAppliedInReduce =
                stateManager.storage.joinChannelBlocks.getBlocksInRange(
                    reducedOutput.latestJoinChannelBlockHash,
                    reducedLatestStateSnapshot.latestJoinBlockHash
                );

            // Move to the next fork using local EVM
            const snapshotData =
                await diamondStateMachine.reduceOutputToSnapshotData(
                    currentForkId,
                    reducedOutput,
                    reducedLatestStateSnapshot.toStruct(),
                    reducedLatestEncodedStateMachineState,
                    joinChannelBlocksAppliedInReduce
                );
            const reducedForkId = ethers.keccak256(
                Codec.encode(snapshotData, Type.SnapshotData)
            );
            disputeWindows.push({
                disputes: currentWindowDisputes,
                forkId: currentForkId as Hash,
                latestStateSnapshot: reducedLatestStateSnapshot.toStruct(),
                latestEncodedStateMachineState:
                    reducedLatestEncodedStateMachineState,
                joinChannelBlocksAppliedInReduce:
                    joinChannelBlocksAppliedInReduce,
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
            throw new Error(
                "Reduce and interate didn't derive the latest fork"
            );

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
        const latestStateProof = await agreementManager.getStateProof(
            forkId,
            latestBlockHeight
        );
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
        let latestFinalizedEncodedState: Bytes | undefined;
        const latestFinalizedMilestoneSnapshot =
            milestoneSnapshots.length > 0
                ? milestoneSnapshots.at(-1)!
                : latestForkGenesisSnapshot;

        const stateHash =
            latestFinalizedMilestoneSnapshot.snapshotData.stateMachineStateHash;
        latestFinalizedEncodedState =
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
    private async fetchOnChainSnapshot(
        channelId: ChannelId
    ): Promise<StateSnapshot> {
        // Fetch the latest on-chain snapshot from RPC node
        // Assume it's true since it's on-chain
        const currentOnChainSnapshot = StateSnapshot.from(
            await this.mainRpcService.p2pManager.stateManager.stateChannelManagerContract.getStateSnapshot(
                channelId
            )
        );
        // sync our local EVM to it
        this.mainRpcService.p2pManager.stateManager.stateChannelEventListener.handleStateSnapshotUpdated(
            channelId,
            currentOnChainSnapshot
        );
        return currentOnChainSnapshot;
    }

    /**
     * Fetch relevant disputeWindows
     */
    private async fetchAndPersistOnChainDisputeWindows(
        channelId: ChannelId,
        forkIds: ForkId[]
    ) {
        const disputeWindows =
            await this.mainRpcService.p2pManager.stateManager.stateChannelManagerContract.getDisputeWindows(
                channelId,
                forkIds
            );

        for (const dw of disputeWindows) {
            await this.mainRpcService.p2pManager.stateManager.diamondStateMachine.localDiamondContract.persistDisputeWindow(
                channelId,
                dw
            );
        }
    }

    /**
     * Sync to the latest proven state
     */
    private async syncToLatestProvenState(
        channelId: ChannelId,
        provenState: StateSnapshot
    ) {
        const stateManager = this.mainRpcService.p2pManager.stateManager;

        console.log(`Syncing to latest proven state for channel ${channelId}`);

        // Update the local state to match the proven state
        try {
            // Store the proven state snapshot in local storage
            stateManager.storage.stateSnapshots.storeStateSnapshot(
                provenState,
                { hash: provenState.hash }
            );

            // Update the fork ID to match the proven state
            stateManager.forkId = provenState.forkId;

            console.log(
                `Successfully synced to proven state: forkId=${provenState.forkId}, height=${provenState.blockHeight}`
            );
        } catch (error) {
            console.error("Failed to sync to proven state:", error);
            throw error;
        }
    }

    /**
     * TODO Apply blocks from queue in blockConfirmationPipeline
     */
    private async applyQueuedBlocksFromPipeline(channelId: ChannelId) {
        const stateManager = this.mainRpcService.p2pManager.stateManager;

        console.log(
            `Applying queued blocks from pipeline for channel ${channelId}`
        );

        try {
            // The spectator can now process blocks like a normal participant
            // The existing block processing pipeline will handle incoming blocks automatically
            console.log(
                `Spectator is now ready to process blocks for channel ${channelId}`
            );

            // The spectator will automatically process blocks as they come in
            // through the normal RPC flow (onBlockConfirmation, etc.)
            // The spectator can now receive and process block confirmations like a normal participant
            // but won't be selected for leader election since they're not in the participant list

            console.log(
                "Spectator is now ready to receive and process block confirmations"
            );
        } catch (error) {
            console.error("Failed to enable block processing:", error);
            // Don't throw - this is not critical for the spectator sync process
        }
    }

    private didRespond(transport: ATransport): boolean {
        const timestamp = this.spectateInitTimes.get(transport);
        return !timestamp;
    }
}

export default SpectateService;

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

export interface DisputeWindowVerification {
    disputes: DisputeConfirmationStruct[];
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
        const time = Clock.getTimeInSeconds();

        // Store the init time for RTT calculation per channel
        this.spectateInitTimes.set(transport, time);

        this.mainRpcService.rpcProxy
            .onSpectateRequest(channelId, time)
            .sendOne(transport);

        setTimeout(() => {
            if (!this.didRespond(transport)) this.abort();
        }, this.mainRpcService.p2pManager.stateManager.timeConfig.agreementTime);
    }

    public async onSpectateRequest(channelId: ChannelId, time: Timestamp) {
        const localTime = Clock.getTimeInSeconds();

        console.log(
            `onSpectateRequest - localTime: ${localTime}, remoteTime: ${time}`
        );

        // Generate payload to prove the latest possible snapshot
        // (but don't send it on-chain - send it to the spectator)
        const syncPayload = await this.generateSyncPayload(channelId);

        console.log(`onSpectateRequest - done`);
        this.mainRpcService.rpcProxy
            .onSpectateResponse(channelId, syncPayload)
            .sendOne(this.mainRpcService.senderTransport!);
    }

    public async onSpectateResponse(
        channelId: ChannelId,
        syncPayload: SyncPayload
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
                return this.abort(); // someone trying to sync us without us asking -> not cooperating
            }

            const localTime = Clock.getTimeInSeconds();
            const rtt = localTime - initTime;

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
                return this.abort();
            }

            // What we ultimately want to do here is:
            // 1) Sync/Fetch all the relevant EVM storage data from the chain and persist it in our localEVM
            // 2) Run/reuse the 'updateStateSnapshotFork' & 'updateStateSnapshotSameFork' as a function of:
            //      2.1) The fetched/synced EVM on-chain state which we know is true
            //      2.2) The provided SyncPayload which will be verified against the fetched data
            // 3) While reusing 'updateStateSnapshotFork' & 'updateStateSnapshotSameFork' perform the call as `eth_call` would work on an RPC node
            // This essentially simulates a 'tx' (allows 'store' and other state mutating opcodes and creates logs), but does NOT persist the changes (so we keep our EVM state consistent to the one on-chain)
            // This verifies/proves to us that the payload is correct and that the state can really be 'teleported' to what the other peer is claiming to be the latest state and that the data provided to us is correct
            // 4) Deconstruct the SyncPayload and persist its component normally in our local 'storage'
            // This allows us to manually update the snapshot later at will AT LEAST to the state that we were synced (that's why we're reusing the solidity function, so we know that the TX will succeed)
            //
            // Up to this point we've verified the last finalized state given to us
            // What do we do next?
            // queue all the un-finalized stateProof blocks
            // (other blocks that we're incoming would also be queued while we sync)
            // set some syncFlag to true that will start executing the onBlockConfirmation pipeline with `SpectateStrategy`

            // So what we'll actually do here until the above stuff is implemented:
            // 1) Fetch the onChainSnapshot and persist/update the local EVM with it
            // 2) Fetch all disputeWindows that where provided in the SyncPayload:
            //      2.1) persist/update the localEVM with them
            //      2.2) verify that they're expired - if they're not expired abort
            //      2.3) reduce them if they're not already reduced (do this locally + package calldata for a single multicall later to the RPC node) - this may be a divergence from the on-chain state, but the on-chain one will have to reduce to the same one if expired - think of it as a CRDT where this time we're leading/ahead locally and the chain will eventualy reflect the same state
            //      Later this will be `eth_call`(multicall(reduceAll,updateStateSnapshotFork,updateStateSnapshotSameFork)) a single atomic transaction that doesn't persist the state locally, so we don't have edge cases when we 'do' persit and when we 'do not'
            //      2.4) ** If more than 1  has to be reduced -> abort **
            //      2.5) verify that they reduce to the correct forks as given in the SyncPayload -> abort otherwise
            //      2.6) verify final genesisSnapshot is correct -> abort otherwise
            //      2.7) verify exitChannelBlocks from onChainSnapshot to final genesisSnapshot | TODO - think do we need to verify joinChannelBlocks
            //      2.8) verify that genesisSnapshot.forkId is not disputed on-chain -> abort otherwise
            //      2.9) verify stateProof proves latest state -> abort otherwise
            //      2.10) verify exitChannelBlocks from final genesisSnapshot to latestFinalizedSnapshot
            //      2.11) verify balance invariant of the latestFinalizedState -> abort otherwise
            // 3) Finally - On the RPC node as a staticcall `eth_call`(multicall(reduceAll,updateStateSnapshotFork,updateStateSnapshotSameFork)) to deduct failure/success -> on failure abort
            // 4) Deconstruct the SyncPayload and persist its component normally in our local 'storage'
            // This allows us to manually update the snapshot later at will AT LEAST to the state that we were synced (that's why we're reusing the solidity function, so we know that the TX will succeed)
            //
            // 5) set some syncFlag to true that will start executing the onBlockConfirmation pipeline with `SpectateStrategy` from un-finalized blocks

            // ******* TODO - updateStateSnapshotFork/updateStateSnapshotSameFork need dummy contracts to process withdrawals
            const stateManager = this.mainRpcService.p2pManager.stateManager;
            const diamondStateMachine = stateManager.diamondStateMachine;

            // 1) Fetch the onChainSnapshot and persist/update the local EVM with it
            const onChainSnapshot =
                await this.fetchAndPersistOnChainSnapshot(channelId);
            let finalForkId = onChainSnapshot.forkId;

            // 2) & 2.1) Fetch all disputeWindows that where provided in the SyncPayload:
            const forkIds = syncPayload.disputeWindows.map(
                (disputeWindow) => disputeWindow.forkId
            );
            await this.fetchAndPersistOnChainDisputeWindows(channelId, forkIds);

            let notReducedCount = 0;
            const disputeWindowsThatNeedToBeReducedOnChain: DisputeWindowVerification[] =
                [];
            for (const dw of syncPayload.disputeWindows) {
                // 2.2) verify that they're expired - if they're not expired abort
                const isExpired =
                    await diamondStateMachine.localDiamondContract.isKillPeriodExpired(
                        channelId,
                        dw.forkId
                    );
                if (!isExpired) return this.abort();

                // 2.3) reduce them if they're not already reduced
                const isReducedAndFinal =
                    await diamondStateMachine.localDiamondContract.isReduceChallengePeriodExpired(
                        channelId,
                        dw.forkId
                    );
                if (!isReducedAndFinal) {
                    disputeWindowsThatNeedToBeReducedOnChain.push(dw);
                    await diamondStateMachine.localDiamondContract.reduceAndFinalize(
                        dw.disputes.map((disputeConfirmation) =>
                            Codec.decode(
                                disputeConfirmation.signedDispute
                                    .encodedDispute,
                                Type.Dispute
                            )
                        ),
                        dw.latestStateSnapshot,
                        dw.latestEncodedStateMachineState,
                        dw.joinChannelBlocksAppliedInReduce
                    );
                    // 2.4) ** If more than 1  has to be reduced -> abort **
                    if (++notReducedCount > 1) return this.abort();
                }

                // 2.5) verify that they reduce to the correct forks as given in the SyncPayload
                const _dw = (
                    await diamondStateMachine.localDiamondContract.getDisputeWindows(
                        channelId,
                        [dw.forkId]
                    )
                )[0];
                if (_dw.reducedResult.forkId != dw.reducedForkId)
                    return this.abort();
                // if the above call fails -> local evm will throw -> catch and abort
                finalForkId = dw.reducedForkId;
            }

            // 2.6) verify final genesisSnapshot is correct -> abort otherwise
            let isCorrectGenesis =
                finalForkId == syncPayload.latestForkGenesisSnapshot.forkId;
            isCorrectGenesis =
                isCorrectGenesis &&
                (await diamondStateMachine.localDiamondContract.isGenesisSnapshotWithoutTimeCheck(
                    syncPayload.latestForkGenesisSnapshot
                ));
            const [isAvailable, genesisTimestamp] =
                await diamondStateMachine.localDiamondContract.getGenesisTimestamp(
                    channelId,
                    syncPayload.latestForkGenesisSnapshot.snapshotData
                        .originForkId,
                    finalForkId
                );
            isCorrectGenesis =
                isCorrectGenesis &&
                isAvailable &&
                genesisTimestamp ==
                    syncPayload.latestForkGenesisSnapshot.timestamp;
            if (!isCorrectGenesis) return this.abort();

            // 2.7) verify exitChannelBlocks from onChainSnapshot to final genesisSnapshot
            let areValidExitBlocks =
                await diamondStateMachine.localDiamondContract.verifyExitChannelBlocks(
                    syncPayload.exitChannelBlocksUpToLatestGenesis,
                    onChainSnapshot.snapshotData,
                    syncPayload.latestForkGenesisSnapshot.snapshotData
                );
            if (!areValidExitBlocks) return this.abort();

            // 2.8) verify that genesisSnapshot.forkId is not disputed on-chain -> abort otherwise
            const _timestamp =
                await stateManager.stateChannelManagerContract.getDisputeWindowCreationTimestamp(
                    channelId,
                    finalForkId
                );
            if (Number(_timestamp) != 0) return this.abort();

            // 2.9) verify stateProof proves latest state -> abort otherwise
            const [isValid, _] =
                await diamondStateMachine.localDiamondContract.verifyMilestones(
                    syncPayload.stateProof.milestones,
                    syncPayload.milestoneSnapshots,
                    syncPayload.latestForkGenesisSnapshot.snapshotData
                );
            if (!isValid) return this.abort();

            const latestFinalizedSnapshot =
                syncPayload.milestoneSnapshots.length > 0
                    ? syncPayload.milestoneSnapshots.at(-1)!
                    : syncPayload.latestForkGenesisSnapshot;

            if (
                latestFinalizedSnapshot.snapshotData.stateMachineStateHash !=
                hash(syncPayload.latestFinalizedEncodedState)
            )
                return this.abort();

            // 2.10) verify exitChannelBlocks from final genesisSnapshot to latestFinalizedSnapshot
            areValidExitBlocks =
                await diamondStateMachine.localDiamondContract.verifyExitChannelBlocks(
                    syncPayload.exitChannelBlocksUpToLatestGenesis,
                    syncPayload.latestForkGenesisSnapshot.snapshotData,
                    latestFinalizedSnapshot.snapshotData
                );
            if (!areValidExitBlocks) return this.abort();

            // 2.11) verify balance invariant of the latestFinalizedState -> abort otherwise
            const isValidBalance =
                await stateManager.stateChannelManagerContract.verifyBalanceInvariantCheckSnapshot.staticCall(
                    channelId,
                    latestFinalizedSnapshot.snapshotData,
                    syncPayload.latestFinalizedEncodedState
                );
            if (!isValidBalance) this.abort();

            // 3) Finally - On the RPC node as a staticcall `eth_call`(multicall(reduceAll,updateStateSnapshotFork,updateStateSnapshotSameFork)) to deduct failure/success -> on failure abort
            const isMulticallSuccess = await this.tryMulticallSnapshotUpdate(
                channelId,
                onChainSnapshot,
                syncPayload,
                disputeWindowsThatNeedToBeReducedOnChain
            );
            if (!isMulticallSuccess) return this.abort();

            // 4) Deconstruct the SyncPayload and persist its component normally in our local 'storage'
            this.persistSyncPayload(syncPayload);

            // 5) set some syncFlag to true that will start executing the onBlockConfirmation pipeline with `SpectateStrategy` from unfinalized blocks
            // Not sure if we need to set the flag - the default one is 'SPECTATING' - think that's enough, but maybe we need 1 more flag
            const blockConfirmations =
                this.getUnfinalizedBlockConfirmationsFromStateProof(
                    syncPayload.stateProof
                );
            for (const bc of blockConfirmations)
                stateManager.onBlockConfirmation(bc);

            console.log("Spectator successfully synced to latest proven state");
        } catch (e) {
            console.log(e);
            this.abort();
        }
    }

    /**
     * Generate payload to prove the latest possible snapshot
     * (but don't send it on-chain - send it to the spectator)
     */
    private async generateSyncPayload(
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

        const disputeWindows: DisputeWindowVerification[] = [];
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
            const currentWindowDisputes: DisputeConfirmationStruct[] = [];
            for (const commitment of disputeCommitments) {
                const disputeConfirmation =
                    stateManager.storage.disputes.getDisputeConfirmation(
                        commitment
                    );
                if (!disputeConfirmation) {
                    throw new Error(
                        `Missing Data Availability for dispute commitment ${commitment}`
                    );
                }

                currentWindowDisputes.push(disputeConfirmation);
            }

            // After collecting disputes for this window, reduce to get the next fork
            const reducedOutput =
                await diamondStateMachine.localDiamondContract.reduceProxyView(
                    currentWindowDisputes.map((disputeConfirmation) =>
                        Codec.decode(
                            disputeConfirmation.signedDispute.encodedDispute,
                            Type.Dispute
                        )
                    )
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
                await diamondStateMachine.localDiamondContract.reduceOutputToSnapshotData.staticCall(
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
    private async fetchAndPersistOnChainSnapshot(
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
        this.mainRpcService.p2pManager.stateManager.eventHandler.onStateSnapshotUpdated(
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

    private async tryMulticallSnapshotUpdate(
        channelId: ChannelId,
        onChainSnapshot: StateSnapshotStruct,
        syncPayload: SyncPayload,
        disputeWindowsThatNeedToBeReducedOnChain: DisputeWindowVerification[]
    ): Promise<boolean> {
        const stateManager = this.mainRpcService.p2pManager.stateManager;
        const stateChannelManagerContract =
            stateManager.stateChannelManagerContract;
        // Encode data for multicall
        const calldata: string[] = [];
        for (const dw of disputeWindowsThatNeedToBeReducedOnChain) {
            const reduceCalldata =
                stateChannelManagerContract.interface.encodeFunctionData(
                    "reduceAndFinalize",
                    [
                        dw.disputes.map((disputeConfirmation) =>
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
                console.log(e);
                return false;
            }
        }
        return true;
    }

    private persistSyncPayload(syncPayload: SyncPayload) {
        const storage = this.mainRpcService.p2pManager.stateManager.storage;
        for (const dw of syncPayload.disputeWindows) {
            for (const dispute of dw.disputes) {
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
    private persistFinalizedPartsOfStateProof(stateProof: StateProofStruct) {
        const storage = this.mainRpcService.p2pManager.stateManager.storage;
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
    private getUnfinalizedBlockConfirmationsFromStateProof(
        stateProof: StateProofStruct
    ): BlockConfirmationStruct[] {
        const blocks: BlockConfirmationStruct[] = [];
        // last milestone
        if (stateProof.milestones.length > 0) {
            const lastMilestone = stateProof.milestones.at(-1)!;
            // skip first block - the first block is finalized
            for (let i = 1; i < lastMilestone.blockConfirmations.length; i++)
                blocks.push(lastMilestone.blockConfirmations[i]);
            return blocks;
        }
        // no milestone -> signedBlocks
        if (stateProof.signedBlocks.length > 0) {
            // take all signed blocks
            for (const sb of stateProof.signedBlocks) {
                blocks.push(Block.fromSignedBlock(sb).blockConfirmationStruct);
            }
        }
        return blocks;
    }
    private didRespond(transport: ATransport): boolean {
        const timestamp = this.spectateInitTimes.get(transport);
        return !timestamp;
    }

    private abort() {
        this.mainRpcService.p2pManager.disconnectAll();
    }
}

export default SpectateService;

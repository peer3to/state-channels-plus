import ARpcMethods from "@/rpc/ARpcMethods";
import { ATransport } from "@/transport";
import SpectateService, {
    DisputeWindowVerification,
    SyncPayload
} from "./SpectateService";
import { ChannelId, Timestamp } from "@/types/types";
import Clock from "@/Clock";
import { Codec, hash, Type } from "@/utils";

class SpectateServiceRpcMethods extends ARpcMethods {
    service: SpectateService;
    constructor(transport: ATransport, service: SpectateService) {
        super(transport, service.p2pManager);
        this.service = service;
    }

    public async onSpectateRequest(channelId: ChannelId, time: Timestamp) {
        const localTime = Clock.getTimeInSeconds();

        console.log(
            `onSpectateRequest - localTime: ${localTime}, remoteTime: ${time}`
        );

        // Generate payload to prove the latest possible snapshot
        // (but don't send it on-chain - send it to the spectator)
        const syncPayload = await this.service.generateSyncPayload(channelId);

        console.log(`onSpectateRequest - done`);
        this.remoteRpc.spectateService
            .onSpectateResponse(channelId, syncPayload)
            .sendOne(this.senderTransport);
    }

    public async onSpectateResponse(
        channelId: ChannelId,
        syncPayload: SyncPayload
    ) {
        try {
            console.log(`onSpectateResponse - start`);
            const senderTransport = this.senderTransport;
            const initTime =
                this.service.spectateInitTimes.get(senderTransport);
            this.service.spectateInitTimes.delete(senderTransport);
            if (!initTime) {
                console.log(
                    "onSpectateResponse - no init time found for channel"
                );
                return this.service.abort(); // someone trying to sync us without us asking -> not cooperating
            }

            const localTime = Clock.getTimeInSeconds();
            const rtt = localTime - initTime;

            console.log(
                `onSpectateResponse - RTT: ${rtt}s, initTime: ${initTime}, responseTime: ${localTime}`
            );

            // If RTT is too high, disconnect from all peers
            if (rtt > this.p2pManager.stateManager.timeConfig.agreementTime) {
                console.log(
                    `onSpectateResponse - RTT too high (${rtt}s), disconnecting from all peers`
                );
                return this.service.abort();
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
            const stateManager = this.p2pManager.stateManager;
            const diamondStateMachine = stateManager.diamondStateMachine;

            // 1) Fetch the onChainSnapshot and persist/update the local EVM with it
            const onChainSnapshot =
                await this.service.fetchAndPersistOnChainSnapshot(channelId);
            let finalForkId = onChainSnapshot.forkId;

            // 2) & 2.1) Fetch all disputeWindows that where provided in the SyncPayload:
            const forkIds = syncPayload.disputeWindows.map(
                (disputeWindow) => disputeWindow.forkId
            );
            await this.service.fetchAndPersistOnChainDisputeWindows(
                channelId,
                forkIds
            );

            let notReducedCount = 0;
            const disputeWindowsThatNeedToBeReducedOnChain: DisputeWindowVerification[] =
                [];
            for (const dw of syncPayload.disputeWindows) {
                // 2.2) verify that they're expired - if they're not expired abort
                const [isExpired, _] =
                    await diamondStateMachine.localDiamondContract.isKillPeriodExpired(
                        channelId,
                        dw.forkId
                    );
                if (!isExpired) return this.service.abort();

                // 2.3) reduce them if they're not already reduced
                const isReducedAndFinal =
                    await diamondStateMachine.localDiamondContract.isReduceChallengePeriodExpired(
                        channelId,
                        dw.forkId
                    );
                if (!isReducedAndFinal) {
                    disputeWindowsThatNeedToBeReducedOnChain.push(dw);
                    await diamondStateMachine.localDiamondContract.reduceAndFinalize(
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
                    );
                    // 2.4) ** If more than 1  has to be reduced -> abort **
                    if (++notReducedCount > 1) return this.service.abort();
                }

                // 2.5) verify that they reduce to the correct forks as given in the SyncPayload
                const _dw = (
                    await diamondStateMachine.localDiamondContract.getDisputeWindows(
                        channelId,
                        [dw.forkId]
                    )
                )[0];
                if (_dw.reducedResult.forkId != dw.reducedForkId)
                    return this.service.abort();
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
            if (!isCorrectGenesis) return this.service.abort();

            // 2.7) verify exitChannelBlocks from onChainSnapshot to final genesisSnapshot
            let areValidExitBlocks =
                await diamondStateMachine.localDiamondContract.verifyExitChannelBlocks(
                    syncPayload.exitChannelBlocksUpToLatestGenesis,
                    onChainSnapshot.snapshotData,
                    syncPayload.latestForkGenesisSnapshot.snapshotData
                );
            if (!areValidExitBlocks) return this.service.abort();

            // 2.8) verify that genesisSnapshot.forkId is not disputed on-chain -> abort otherwise
            const _timestamp =
                await stateManager.stateChannelManagerContract.getDisputeWindowCreationTimestamp(
                    channelId,
                    finalForkId
                );
            if (Number(_timestamp) != 0) return this.service.abort();

            // 2.9) verify stateProof proves latest state -> abort otherwise
            const [isValid, _] =
                await diamondStateMachine.localDiamondContract.verifyMilestones(
                    syncPayload.stateProof.milestones,
                    syncPayload.milestoneSnapshots,
                    syncPayload.latestForkGenesisSnapshot.snapshotData
                );
            if (!isValid) return this.service.abort();

            const latestFinalizedSnapshot =
                syncPayload.milestoneSnapshots.length > 0
                    ? syncPayload.milestoneSnapshots.at(-1)!
                    : syncPayload.latestForkGenesisSnapshot;

            if (
                latestFinalizedSnapshot.snapshotData.stateMachineStateHash !=
                hash(syncPayload.latestFinalizedEncodedState)
            )
                return this.service.abort();

            // 2.10) verify exitChannelBlocks from final genesisSnapshot to latestFinalizedSnapshot
            areValidExitBlocks =
                await diamondStateMachine.localDiamondContract.verifyExitChannelBlocks(
                    syncPayload.exitChannelBlocksUpToLatestGenesis,
                    syncPayload.latestForkGenesisSnapshot.snapshotData,
                    latestFinalizedSnapshot.snapshotData
                );
            if (!areValidExitBlocks) return this.service.abort();

            // 2.11) verify balance invariant of the latestFinalizedState -> abort otherwise
            const isValidBalance =
                await stateManager.stateChannelManagerContract.verifyBalanceInvariantCheckSnapshot.staticCall(
                    channelId,
                    latestFinalizedSnapshot.snapshotData,
                    syncPayload.latestFinalizedEncodedState
                );
            if (!isValidBalance) this.service.abort();

            // 3) Finally - On the RPC node as a staticcall `eth_call`(multicall(reduceAll,updateStateSnapshotFork,updateStateSnapshotSameFork)) to deduct failure/success -> on failure abort
            const isMulticallSuccess =
                await this.service.tryMulticallSnapshotUpdate(
                    channelId,
                    onChainSnapshot,
                    syncPayload,
                    disputeWindowsThatNeedToBeReducedOnChain
                );
            if (!isMulticallSuccess) return this.service.abort();

            // 4) Deconstruct the SyncPayload and persist its component normally in our local 'storage'
            this.service.persistSyncPayload(syncPayload);

            // 5) set some syncFlag to true that will start executing the onBlockConfirmation pipeline with `SpectateStrategy` from unfinalized blocks
            // Not sure if we need to set the flag - the default one is 'SPECTATING' - think that's enough, but maybe we need 1 more flag
            const blockConfirmations =
                this.service.getUnfinalizedBlockConfirmationsFromStateProof(
                    syncPayload.stateProof
                );
            for (const bc of blockConfirmations)
                stateManager.onBlockConfirmation(bc);

            console.log("Spectator successfully synced to latest proven state");
        } catch (e) {
            console.log(e);
            this.service.abort();
        }
    }
}

export default SpectateServiceRpcMethods;

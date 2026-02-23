import ARpcMethods from "@/rpc/ARpcMethods";
import { ATransport } from "@/transport";
import SpectateService, { SyncRequest } from "./SpectateService";
import { Bytes, ChannelId } from "@/types";
import Clock from "@/Clock";
import { Codec, hash, Type } from "@/utils";
import { Block } from "@/models";
import type { DisputeWindowVerification } from "@/types";

class SpectateServiceRpcMethods extends ARpcMethods {
    service: SpectateService;
    constructor(transport: ATransport, service: SpectateService) {
        super(transport, service.p2pManager);
        this.service = service;
    }

    public async onSpectateRequest(syncRequest: SyncRequest) {
        const senderTransport = this.senderTransport;
        const peerAddress = senderTransport.peerAddress;
        if (!peerAddress) {
            // HandshakeCompletedGuard should guarantee peerAddress is present.
            // If it's not, treat as malicious/broken peer.
            this.service.p2pManager.disconnectAndBlacklistPeer(senderTransport);
            return;
        }

        const localTime = Clock.getTimeInSeconds();

        this.service.logger.debug(
            `onSpectateRequest - localTime: ${localTime}, remoteTime: ${syncRequest.initTime}`
        );

        // Generate payload to prove the latest possible snapshot
        // (but don't send it on-chain - send it to the spectator)
        const syncPayload = await this.service.generateSyncPayload(
            syncRequest.channelId,
            syncRequest.forkId,
            syncRequest.blockHeight
        );

        if (!syncPayload) {
            this.service.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
                peerAddress
            );
            return;
        }
        const encodedSyncPayload = Codec.encode(syncPayload, Type.SyncPayload);

        this.service.logger.debug(`onSpectateRequest - done`);
        this.remoteRpc.spectateService
            .onSpectateResponse(syncRequest.channelId, encodedSyncPayload)
            .sendOne(peerAddress);
    }

    public async onSpectateResponse(
        channelId: ChannelId,
        encodedSyncPayload: Bytes
    ) {
        const syncPayload = Codec.decode(encodedSyncPayload, Type.SyncPayload);
        this.service.logger.debug(`Sync payload received`, {
            syncPayload
        });
        const senderTransport = this.senderTransport;
        const peerAddress = senderTransport.peerAddress;
        if (!peerAddress) {
            // HandshakeCompletedGuard should guarantee peerAddress is present.
            // If it's not, treat as malicious/broken peer.
            this.service.p2pManager.disconnectAndBlacklistPeer(senderTransport);
            return;
        }

        try {
            const syncRequest =
                this.service.takePendingRequestByPeerAddress(peerAddress);
            if (!syncRequest) {
                this.service.logger.debug(
                    "onSpectateResponse - no pending request for peer; aborting",
                    { peerAddress }
                );
                return this.service.abort(peerAddress);
            }

            const localTime = Clock.getTimeInSeconds();
            const rtt = localTime - syncRequest.initTime;

            this.service.logger.debug(
                `onSpectateResponse - RTT: ${rtt}s, initTime: ${syncRequest.initTime}, responseTime: ${localTime}`
            );

            // If RTT is too high, disconnect from all peers
            if (rtt > this.p2pManager.stateManager.timeConfig.agreementTime) {
                // in general this check is not needed since we're measuring response time on request submission
                this.service.logger.debug(
                    `onSpectateResponse - RTT too high (${rtt}s), disconnecting from all peers`
                );
                return;
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
            //      2.7) verify outboundMessageBlocks from onChainSnapshot to final genesisSnapshot | TODO - think do we need to verify joinChannelBlocks
            //      2.8) verify that genesisSnapshot.forkId is not disputed on-chain -> abort otherwise
            //      2.9) verify stateProof proves latest state -> abort otherwise
            //      2.10) verify outboundMessageBlocks from final genesisSnapshot to latestFinalizedSnapshot
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
            let finalForkId = onChainSnapshot.forkID;

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
                const { isExpired } =
                    await diamondStateMachine.localDiamondContract.isKillPeriodExpired(
                        channelId,
                        dw.forkId
                    );
                if (!isExpired) return this.service.abort(peerAddress);

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
                        dw.inboundMessageBlocksAppliedInReduce,
                        dw.reducedForkId
                    );
                    // 2.4) ** If more than 1  has to be reduced -> abort **
                    if (++notReducedCount > 1)
                        return this.service.abort(peerAddress);
                }

                // 2.5) verify that they reduce to the correct forks as given in the SyncPayload
                const _dw = (
                    await diamondStateMachine.localDiamondContract.getDisputeWindows(
                        channelId,
                        [dw.forkId]
                    )
                )[0];
                if (_dw.reducedResult.forkId != dw.reducedForkId)
                    return this.service.abort(peerAddress);
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
            const { isAvailable, timestamp: genesisTimestamp } =
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
            if (!isCorrectGenesis) return this.service.abort(peerAddress);

            // 2.7) verify outboundMessageBlocks from onChainSnapshot to final genesisSnapshot
            let areValidExitBlocks =
                await diamondStateMachine.localDiamondContract.verifyOutboundMessageBlocks(
                    syncPayload.outboundMessageBlocksUpToLatestGenesis,
                    onChainSnapshot.snapshotData,
                    syncPayload.latestForkGenesisSnapshot.snapshotData
                );
            if (!areValidExitBlocks) return this.service.abort(peerAddress);

            // 2.8) Depending are we syncing to the 'latest state' (spectating) or some requested state (forkId,blockHeight), verify that:
            // 2.8.1) (spectating) genesisSnapshot.forkId is not disputed on-chain -> abort otherwise
            // 2.8.2) (requested) genesisSnapshot.forkId == syncRequest.forkId -> abort otherwise
            if (!syncRequest.forkId) {
                // 2.8.1) (spectating)
                const _timestamp =
                    await stateManager.stateChannelManagerContract.getDisputeWindowCreationTimestamp(
                        channelId,
                        finalForkId
                    );
                if (Number(_timestamp) != 0)
                    return this.service.abort(peerAddress);
            } else {
                // 2.8.2) (requested)
                if (finalForkId != syncRequest.forkId)
                    return this.service.abort(peerAddress);
            }

            // 2.9) verify stateProof proves latest state -> abort otherwise
            const { isValid } =
                await diamondStateMachine.localDiamondContract.verifyMilestones(
                    syncPayload.latestForkGenesisSnapshot.forkId,
                    syncPayload.stateProof.milestones,
                    syncPayload.milestoneSnapshots,
                    syncPayload.latestForkGenesisSnapshot.snapshotData
                );
            if (!isValid) return this.service.abort(peerAddress);

            const latestFinalizedSnapshot =
                syncPayload.milestoneSnapshots.length > 0
                    ? syncPayload.milestoneSnapshots.at(-1)!
                    : syncPayload.latestForkGenesisSnapshot;

            if (
                latestFinalizedSnapshot.snapshotData.stateMachineStateHash !=
                hash(syncPayload.latestFinalizedEncodedState)
            )
                return this.service.abort(peerAddress);

            // 2.10) verify outboundMessageBlocks from final genesisSnapshot to latestFinalizedSnapshot
            areValidExitBlocks =
                await diamondStateMachine.localDiamondContract.verifyOutboundMessageBlocks(
                    syncPayload.outboundMessageBlocksOfTheLatestFork,
                    syncPayload.latestForkGenesisSnapshot.snapshotData,
                    latestFinalizedSnapshot.snapshotData
                );
            if (!areValidExitBlocks) return this.service.abort(peerAddress);

            // 2.11) verify balance invariant of the latestFinalizedState -> abort otherwise
            const isValidBalance =
                await stateManager.stateChannelManagerContract.verifyBalanceInvariantCheckSnapshot.staticCall(
                    channelId,
                    latestFinalizedSnapshot.snapshotData,
                    syncPayload.latestFinalizedEncodedState
                );
            if (!isValidBalance) this.service.abort(peerAddress);

            // 3) Finally - On the RPC node as a staticcall `eth_call`(multicall(reduceAll,updateStateSnapshotFork,updateStateSnapshotSameFork)) to deduct failure/success -> on failure abort
            const isMulticallSuccess =
                await this.service.tryMulticallSnapshotUpdate(
                    channelId,
                    onChainSnapshot.toStruct(),
                    syncPayload,
                    disputeWindowsThatNeedToBeReducedOnChain
                );
            if (!isMulticallSuccess) return this.service.abort(peerAddress);

            // 4) Deconstruct the SyncPayload and persist its component normally in our local 'storage'
            await this.service.persistSyncPayload(syncPayload);

            // 5) Start executing the onBlockConfirmation pipeline with unfinalized blocks
            const blockConfirmations =
                await diamondStateMachine.localDiamondContract.getUnfinalizedBlockConfirmationsFromStateProof(
                    syncPayload.stateProof
                );
            this.service.logger.debug(
                `Spectate sync - next block height before pipeline ${stateManager.storage.blocks.getNextBlockHeight(finalForkId)}`
            );
            this.service.logger.debug(
                `Spectate sync - BlockConfirmation pipeline for ${blockConfirmations.length} unfinalized block`,
                blockConfirmations.map((bc) => {
                    const _block = Block.fromBlockConfirmation(bc);
                    return {
                        blockHeight: _block.height,
                        signerAddress: _block.author
                    };
                })
            );
            for (const bc of blockConfirmations) {
                const isOk = await stateManager.onBlockConfirmation(bc);
                if (!isOk) this.service.abort(peerAddress);
            }
            this.service.logger.debug(
                `Spectate sync - next block height after pipeline ${stateManager.storage.blocks.getNextBlockHeight(finalForkId)}`
            );
            // 6) If state requested (forkId,blockHeight) - check if blockHeight reached
            if (syncRequest.blockHeight !== undefined) {
                const [hasBlock, latestBlock] =
                    await diamondStateMachine.localDiamondContract.getLatestBlockFromStateProof(
                        syncPayload.stateProof
                    );
                if (!hasBlock) return this.service.abort(peerAddress);
                if (
                    Number(latestBlock.transaction.header.transactionCnt) !=
                    syncRequest.blockHeight
                )
                    return this.service.abort(peerAddress);
            }
            this.service.logger.debug(
                "Spectator successfully synced to latest proven state"
            );
        } catch (e) {
            this.service.logger.debug(e);
            this.service.abort(peerAddress);
        }
    }
}

export default SpectateServiceRpcMethods;

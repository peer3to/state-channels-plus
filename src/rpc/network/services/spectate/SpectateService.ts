import SpectateServiceRpcMethods from "./SpectateRpcMethods";
import type {
    ProofTierWalk,
    StateProofEvidence
} from "@/agreementManager/AgreementManager";
import { DisconnectPolicy } from "@/DisconnectPolicy";
import { Block, StateSnapshot } from "@/models";
import type P2PManager from "@/P2PManager";
import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import { HandshakeCompletedGuard } from "@/rpc/network/guards";
import type { ReductionComputation } from "@/stateManager/reduction/ReductionComputationService";
import NetworkTransport from "@/transport/NetworkTransport";
import { DisputeWindowVerification, SyncPayload } from "@/types";
import type { ChecksumAddress } from "@/types/types";
import { Address, Bytes, ChannelId, Hash, ForkId } from "@/types/types";
import { Codec, getChecksumAddress, hash, Type } from "@/utils";
import { errorMessage } from "@/utils/errorMessage";
import { isLocalEvmExecutionFailure } from "@/utils/evmErrorHandler";
import { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { StateProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";

/** The state a sync installs and where its last-run replay starts. */
type SyncReplayBase = {
    snapshot: StateSnapshot;
    state: Bytes;
    fromIndex: number;
    /** an earlier base block below the walk's start, which the walk never stored */
    block?: Block;
};

type VerifiedSync = {
    walk: ProofTierWalk;
    evidence: StateProofEvidence;
    base: SyncReplayBase;
    /** windows the chain already reduced: their reduce input is not stored */
    chainFinalForkIds: Set<ForkId>;
    /** windows this sync's own reduction verified: only their inbound list is stored */
    selfReducedForkIds: Set<ForkId>;
};

export interface SyncRequest {
    channelId: ChannelId;
    forkId?: ForkId;
    blockHeight?: number;
}

class SpectateService extends ANetworkRpcService<SpectateServiceRpcMethods> {
    private readonly inFlightByPeerAddress: Map<
        ChecksumAddress,
        { request: SyncRequest; result: Promise<boolean> }
    > = new Map();

    constructor(p2pManager: P2PManager) {
        super(
            p2pManager.rpcRouter,
            p2pManager.stateManager.logger.child({
                component: "SpectateService"
            })
        );
        this.guards = [new HandshakeCompletedGuard(this)];
    }

    public createRPCMethods(
        transport: NetworkTransport
    ): SpectateServiceRpcMethods {
        return new SpectateServiceRpcMethods(transport, this);
    }

    public async sync(
        peerAddress: Address,
        channelId: ChannelId,
        forkId?: ForkId,
        blockHeight?: number,
        timeoutMs = this.p2pManager.stateManager.timeConfig.agreementTime * 1000
    ): Promise<boolean> {
        const syncRequest: SyncRequest = {
            channelId,
            forkId,
            blockHeight
        };
        this.logger.debug("spectateSync - starting", {
            peerAddress,
            syncRequest,
            timeoutMs
        });
        const normalizedPeerAddress = getChecksumAddress(peerAddress);

        let inFlight = this.inFlightByPeerAddress.get(normalizedPeerAddress);
        while (inFlight) {
            const request = inFlight.request;
            const coversRequest =
                request.channelId === channelId &&
                request.forkId === forkId &&
                (request.blockHeight === blockHeight ||
                    (request.blockHeight !== undefined &&
                        blockHeight !== undefined &&
                        request.blockHeight >= blockHeight));
            const synced = await inFlight.result;
            if (!synced || coversRequest) return synced;
            inFlight = this.inFlightByPeerAddress.get(normalizedPeerAddress);
        }

        const attempt = this.runSync(
            normalizedPeerAddress,
            syncRequest,
            timeoutMs
        );
        this.inFlightByPeerAddress.set(normalizedPeerAddress, {
            request: syncRequest,
            result: attempt
        });
        try {
            return await attempt;
        } finally {
            this.inFlightByPeerAddress.delete(normalizedPeerAddress);
        }
    }

    private async runSync(
        normalizedPeerAddress: string,
        syncRequest: SyncRequest,
        timeoutMs: number
    ): Promise<boolean> {
        let response: { encodedSyncPayload: Bytes };
        try {
            response = await this.remoteRpc.spectateService
                .onSpectateRequest(syncRequest)
                .request(normalizedPeerAddress, { timeoutMs });
        } catch (error) {
            // Silence, a refusal, or a lost transport is not proven
            // misbehaviour: it spends the peer's shared retry bound.
            this.logger.debug("spectateSync - request failed", {
                peerAddress: normalizedPeerAddress,
                error: errorMessage(error)
            });
            this.p2pManager.disconnectConnection(
                normalizedPeerAddress,
                DisconnectPolicy.allowRetry()
            );
            return false;
        }
        try {
            return await this.applySyncResponse(
                normalizedPeerAddress,
                syncRequest,
                response.encodedSyncPayload
            );
        } catch (error) {
            // applySyncResponse rejects the peer's faults itself; a throw is an
            // internal failure, no verdict on the peer
            this.logger.error("spectateSync - failed", {
                peerAddress: normalizedPeerAddress,
                error: errorMessage(error)
            });
            throw error;
        }
    }

    /**
     * Validate and apply a sync payload returned by `onSpectateRequest`. Was the
     * body of the old `onSpectateResponse` endpoint; the request now lives in
     * `sync`'s closure, so the channel is taken from our own `syncRequest`
     * (never the peer's echo) and the previous channel-binding check is moot.
     * Validation failures reject the peer and return false. The caller owns
     * the lifecycle consequence of a failed sync. A disposed runtime applies
     * nothing and returns false with no verdict on the peer.
     */
    public async applySyncResponse(
        peerAddress: string,
        syncRequest: SyncRequest,
        encodedSyncPayload: Bytes
    ): Promise<boolean> {
        if (this.p2pManager.stateManager.isDisposed) return false;
        const channelId = syncRequest.channelId;

        // A malicious/broken peer can return bytes that aren't a valid
        // Codec.encode(SyncPayload): that is the peer's fault. Any later throw
        // is an internal failure and propagates; it is no verdict on the peer.
        let syncPayload: SyncPayload;
        try {
            syncPayload = Codec.decode(encodedSyncPayload, Type.SyncPayload);
        } catch (e) {
            this.logger.warn(e);
            return this.rejectSync(peerAddress, "payload undecodable");
        }
        {
            this.logger.debug(`Sync payload received`, { syncPayload });

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
            //      2.3) reduce them if they're not already reduced (locally only) - this may be a divergence from the on-chain state, but the on-chain one will have to reduce to the same one if expired - think of it as a CRDT where this time we're leading/ahead locally and the chain will eventualy reflect the same state
            //      2.4) ** If more than 1  has to be reduced -> abort **
            //      2.5) verify that they reduce to the correct forks as given in the SyncPayload -> abort otherwise
            //      2.6) verify final genesisSnapshot is correct -> abort otherwise
            //      2.7) verify outboundMessageBlocks from onChainSnapshot to final genesisSnapshot | TODO - think do we need to verify joinChannelBlocks
            //      2.8) verify that genesisSnapshot.forkId is not disputed on-chain -> abort otherwise
            //      2.9) verify stateProof proves latest state -> abort otherwise
            //      2.10) verify outboundMessageBlocks from the on-chain snapshot when it is on the proven fork, else from final genesisSnapshot, to latestFinalizedSnapshot
            //      2.11) verify balance invariant of the latestFinalizedState -> abort otherwise
            // 3) no adoption is simulated against the live chain; the checks above are the verification
            // 4) Deconstruct the SyncPayload and persist its component normally in our local 'storage'
            //
            // 5) set some syncFlag to true that will start executing the onBlockConfirmation pipeline with `SpectateStrategy` from un-finalized blocks

            // ******* TODO - updateStateSnapshotFork/updateStateSnapshotSameFork need dummy contracts to process withdrawals
            const stateManager = this.p2pManager.stateManager;
            const diamondStateMachine = stateManager.diamondStateMachine;

            // 1) Fetch the onChainSnapshot and persist/update the local EVM with it
            const onChainSnapshot =
                await this.fetchAndPersistOnChainSnapshot(channelId);
            let currentForkId = onChainSnapshot.forkID;

            // 2) & 2.1) Fetch all disputeWindows that where provided in the SyncPayload:
            const forkIds = syncPayload.disputeWindows.map(
                (disputeWindow) => disputeWindow.forkId
            );
            // Another sync may have finalized this window only in the shared
            // local EVM. Only chain finality can skip the local reduction.
            // Read finality first: a later window fetch includes any reduction that
            // lands between reads. A false decision then still checks the expected
            // fork locally, in the window the checked disputes name, but only a
            // reduction this sync runs checks its inputs.
            // Values indicate chain-final reduction for each requested fork.
            const finalizedByFork = new Map<ForkId, boolean>();
            if (forkIds.length > 0) {
                const contract = stateManager.stateChannelManagerContract;
                const encodedFinalityCalls = forkIds.map((forkId) =>
                    contract.interface.encodeFunctionData(
                        "isReduceChallengePeriodExpired",
                        [channelId, forkId]
                    )
                );
                const encodedFinalityResults =
                    await contract.multicall.staticCall(encodedFinalityCalls);
                forkIds.forEach((forkId, index) => {
                    const [isFinal] = contract.interface.decodeFunctionResult(
                        "isReduceChallengePeriodExpired",
                        encodedFinalityResults[index]
                    );
                    finalizedByFork.set(forkId, isFinal);
                });
            }
            const onChainDisputeWindows =
                await this.fetchAndPersistOnChainDisputeWindows(
                    channelId,
                    forkIds
                );

            // A responder whose local snapshot lags the chain serves windows the chain
            // already adopted. Skip that prefix only while its chain-final reductions
            // lead, window by window, to the on-chain fork.
            let adoptedWindowCount = 0;
            for (const [index, dw] of syncPayload.disputeWindows.entries()) {
                const onChainReducedForkId = onChainDisputeWindows.find(
                    (window) => window.forkId === dw.forkId
                )?.reducedResult.forkId;
                const linksToPrevious =
                    index === 0 ||
                    dw.forkId ===
                        syncPayload.disputeWindows[index - 1].reducedForkId;
                if (
                    dw.forkId === currentForkId ||
                    !finalizedByFork.get(dw.forkId) ||
                    onChainReducedForkId !== dw.reducedForkId ||
                    !linksToPrevious
                )
                    break;
                if (dw.reducedForkId === currentForkId) {
                    adoptedWindowCount = index + 1;
                    break;
                }
            }
            const linkedDisputeWindows =
                syncPayload.disputeWindows.slice(adoptedWindowCount);

            let notReducedCount = 0;
            // windows whose reduction this sync's own local call committed
            const reducedByThisSync = new Set<ForkId>();
            for (const dw of linkedDisputeWindows) {
                // each window must reduce the fork reached so far, starting at the on-chain fork
                if (dw.forkId !== currentForkId)
                    return this.rejectSync(
                        peerAddress,
                        "dispute window not linked"
                    );
                // 2.2) verify that they're expired - if they're not expired abort
                const { windowExists, isExpired } =
                    await diamondStateMachine.localDiamondContract.isKillPeriodExpired(
                        channelId,
                        dw.forkId
                    );
                if (!windowExists || !isExpired)
                    return this.rejectSync(
                        peerAddress,
                        "kill period not expired"
                    );

                // 2.3) reduce them if they're not already reduced
                const isReducedAndFinal = finalizedByFork.get(dw.forkId);
                if (!isReducedAndFinal) {
                    // the served window's disputes and reduce input are the
                    // peer's: undecodable bytes or a reverting reduction reject it
                    let disputes: DisputeStruct[];
                    try {
                        disputes = dw.disputeConfirmations.map(
                            (disputeConfirmation) =>
                                Codec.decode(
                                    disputeConfirmation.signedDispute
                                        .encodedDispute,
                                    Type.Dispute
                                )
                        );
                    } catch {
                        return this.rejectSync(
                            peerAddress,
                            "dispute undecodable"
                        );
                    }
                    // the local reduce picks its window from the disputes, not from dw
                    if (
                        !disputes.every(
                            (dispute) =>
                                dispute.input.channelId === channelId &&
                                dispute.input.forkId === dw.forkId
                        )
                    )
                        return this.rejectSync(
                            peerAddress,
                            "dispute window mismatch"
                        );
                    try {
                        const committedReduction =
                            await diamondStateMachine.reduceAndFinalizeLocally(
                                disputes,
                                dw.latestStateSnapshot,
                                dw.latestEncodedStateMachineState,
                                dw.inboundMessageBlocksAppliedInReduce,
                                dw.reducedForkId
                            );
                        if (committedReduction)
                            reducedByThisSync.add(dw.forkId);
                    } catch (e) {
                        if (!isLocalEvmExecutionFailure(e)) throw e;
                        return this.rejectSync(
                            peerAddress,
                            "served reduction reverts"
                        );
                    }
                    // 2.4) ** If more than 1  has to be reduced -> abort **
                    if (++notReducedCount > 1)
                        return this.rejectSync(
                            peerAddress,
                            "more than one unreduced window"
                        );
                }

                // A successful reduction already checks the expected fork in Solidity.
                // Another sync can overwrite that local result before a re-read.
                if (isReducedAndFinal) {
                    // 2.5) verify that they reduce to the correct forks as given in the SyncPayload
                    // Use this request's chain response; a competing persist may be older.
                    const _dw = onChainDisputeWindows.find(
                        (window) => window.forkId === dw.forkId
                    )!;
                    if (_dw.reducedResult.forkId != dw.reducedForkId)
                        return this.rejectSync(
                            peerAddress,
                            "reduced fork mismatch"
                        );
                }
                // if the above call fails -> local evm will throw -> catch and abort
                currentForkId = dw.reducedForkId;
            }

            // 2.6) verify final genesisSnapshot is correct -> abort otherwise
            // Three checks: forkId resolves to this snapshot, forkId == keccak256(snapshotData)
            // and encoded state matches the declared hash.
            const finalForkIdMatchesGenesisForkId =
                currentForkId === syncPayload.latestForkGenesisSnapshot.forkId;
            const isGenesisValid =
                await diamondStateMachine.localDiamondContract.isGenesisSnapshotWithoutTimeCheck(
                    syncPayload.latestForkGenesisSnapshot
                );
            const stateHashMatch =
                syncPayload.latestForkGenesisSnapshot.snapshotData
                    .stateMachineStateHash ===
                hash(syncPayload.latestForkGenesisEncodedState);
            const isCorrectGenesis =
                finalForkIdMatchesGenesisForkId &&
                isGenesisValid &&
                stateHashMatch;

            if (!isCorrectGenesis)
                return this.rejectSync(peerAddress, "genesis snapshot invalid");

            // 2.7) verify outboundMessageBlocks from onChainSnapshot (lower/older) to final genesisSnapshot (upper/newer)
            const genesisSnapshot = StateSnapshot.from(
                syncPayload.latestForkGenesisSnapshot
            );
            // the skipped prefix's blocks are already below the on-chain outbound tip
            const outboundMessageBlocksUpToLatestGenesis =
                adoptedWindowCount > 0
                    ? await diamondStateMachine.localDiamondContract.pruneOutboundMessageBlocks(
                          syncPayload.outboundMessageBlocksUpToLatestGenesis,
                          onChainSnapshot.latestOutboundMessageBlockHash
                      )
                    : syncPayload.outboundMessageBlocksUpToLatestGenesis;
            let areValidExitBlocks =
                outboundMessageBlocksUpToLatestGenesis.length === 0;
            if (onChainSnapshot.forkID !== genesisSnapshot.forkID) {
                const { lowerOutboundSnapshot, upperOutboundSnapshot } =
                    SpectateService.orderOutboundSnapshots(
                        onChainSnapshot,
                        genesisSnapshot
                    );
                areValidExitBlocks =
                    await diamondStateMachine.localDiamondContract.verifyOutboundMessageBlocks(
                        outboundMessageBlocksUpToLatestGenesis,
                        lowerOutboundSnapshot.toStruct().snapshotData,
                        upperOutboundSnapshot.toStruct().snapshotData
                    );
            }

            if (!areValidExitBlocks)
                return this.rejectSync(
                    peerAddress,
                    "pre-genesis outbound blocks invalid"
                );

            // 2.8) Depending are we syncing to the 'latest state' (spectating) or some requested state (forkId,blockHeight), verify that:
            // 2.8.1) (spectating) genesisSnapshot.forkId is not disputed on-chain -> abort otherwise
            // 2.8.2) (requested) prove the pinned fork or a successor whose verified lineage contains it.
            if (!syncRequest.forkId) {
                // 2.8.1) (spectating)
                const _timestamp =
                    await stateManager.stateChannelManagerContract.getDisputeWindowCreationTimestamp(
                        channelId,
                        currentForkId
                    );
                if (Number(_timestamp) != 0)
                    return this.rejectSync(
                        peerAddress,
                        "latest fork is disputed"
                    );
            } else {
                // 2.8.2) (requested)
                if (
                    currentForkId != syncRequest.forkId &&
                    !syncPayload.disputeWindows.some(
                        (window) => window.forkId === syncRequest.forkId
                    )
                )
                    return this.rejectSync(
                        peerAddress,
                        "requested fork is not the latest"
                    );
            }

            // 2.9) verify stateProof from the latest trusted start: the local
            // finalized state, the local diamond's anchor, then the chain's
            const forkId = genesisSnapshot.forkID;
            const agreementManager = stateManager.agreementManager;
            const evidence = {
                genesisStateSnapshotData:
                    syncPayload.latestForkGenesisSnapshot.snapshotData,
                milestoneSnapshots: syncPayload.milestoneSnapshots
            };
            const walk = await agreementManager.verifyStateProof(
                forkId,
                syncPayload.stateProof,
                evidence
            );
            if (!walk.valid)
                return this.rejectSync(peerAddress, "milestones invalid");
            const milestones = syncPayload.stateProof.milestones;
            // blocks below the anchor are unchecked and may not decode
            const lastRun = (milestones.at(-1)?.blockConfirmations ?? []).map(
                (bc) => Block.tryFromBlockConfirmation(bc) ?? undefined
            );
            // the walk decoded the last block
            const provenHeight = lastRun.at(-1)?.height ?? -1;
            // a valid proof ending below this peer's finalized state is too old
            const localFinalized = walk.localFinalized;
            const knownFinalHeight = Math.max(
                localFinalized?.blockHeight ?? -1,
                walk.start?.blockHeight ?? -1
            );
            if (provenHeight < knownFinalHeight)
                return this.rejectSync(
                    peerAddress,
                    "proof ends below the finalized state"
                );

            const base = this.getReplayBase(syncPayload, walk, lastRun);
            if (!base)
                return this.rejectSync(
                    peerAddress,
                    "served state does not reach the final point"
                );

            // 2.10) verify outboundMessageBlocks of the latest fork from the on-chain anchor (1) when it is on
            // this fork, else from the fork genesis (2.6), to the installed state. Only the run above the
            // anchor is kept: a later snapshot post and a dispute carry nothing below it. An anchor above
            // the installed state leaves nothing to keep; the replay adds the later blocks.
            const outboundStart =
                onChainSnapshot.forkID === forkId
                    ? onChainSnapshot
                    : genesisSnapshot;
            const {
                isValid: areValidLatestForkExitBlocks,
                aboveAnchor: outboundMessageBlocksOfTheLatestFork
            } =
                await diamondStateMachine.localDiamondContract.verifyOutboundRunAboveAnchor(
                    syncPayload.outboundMessageBlocksOfTheLatestFork,
                    outboundStart.snapshotData,
                    base.snapshot.snapshotData
                );
            if (!areValidLatestForkExitBlocks)
                return this.rejectSync(
                    peerAddress,
                    "latest-fork outbound blocks invalid"
                );

            // 2.11) verify balance invariant of the installed state -> abort otherwise
            const isValidBalance =
                await stateManager.stateChannelManagerContract.verifyBalanceInvariantCheckSnapshot.staticCall(
                    channelId,
                    base.snapshot.snapshotData,
                    base.state
                );
            if (!isValidBalance)
                return this.rejectSync(peerAddress, "balance invariant failed");

            // 4) Persist the verified material; existing data is kept
            const { shouldAbort } = await this.persistSyncPayload(
                {
                    ...syncPayload,
                    disputeWindows: linkedDisputeWindows,
                    outboundMessageBlocksUpToLatestGenesis,
                    outboundMessageBlocksOfTheLatestFork
                },
                {
                    walk,
                    evidence,
                    base,
                    chainFinalForkIds: new Set(
                        linkedDisputeWindows
                            .map((dw) => dw.forkId)
                            .filter((forkId) => finalizedByFork.get(forkId))
                    ),
                    selfReducedForkIds: reducedByThisSync
                }
            );
            if (shouldAbort) {
                if (stateManager.isDisposed) return false;
                return this.rejectSync(
                    peerAddress,
                    "payload persistence aborted"
                );
            }

            // 5) replay the last run from the installed point
            // from the base on, every block is decoded and linked
            const tail = lastRun.slice(base.fromIndex) as Block[];
            this.logger.debug(
                `Spectate sync - BlockConfirmation pipeline for ${tail.length} blocks from height ${base.snapshot.blockHeight + 1}`
            );
            for (const block of tail) {
                const isOk =
                    await stateManager.blockIngestService.onBlockConfirmationStruct(
                        block.blockConfirmationStruct,
                        {
                            validationStrategy:
                                stateManager.spectatingValidationStrategy
                        }
                    );
                if (!isOk)
                    return this.rejectSync(
                        peerAddress,
                        "block confirmation rejected"
                    );
            }
            this.logger.debug(
                `Spectate sync - next block height after pipeline ${stateManager.storage.blocks.getNextBlockHeight(currentForkId)}`
            );
            // 6) If state requested (forkId,blockHeight) - check if blockHeight reached
            if (
                syncRequest.blockHeight !== undefined &&
                !(
                    syncRequest.forkId !== undefined &&
                    currentForkId !== syncRequest.forkId
                )
            ) {
                if (provenHeight === -1)
                    return this.rejectSync(
                        peerAddress,
                        "state proof has no block"
                    );
                if (provenHeight < syncRequest.blockHeight)
                    return this.rejectSync(
                        peerAddress,
                        "proved height is below request"
                    );
            }
            this.logger.debug(
                "Spectator successfully synced to latest proven state"
            );
            return true;
        }
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

        // Reject malformed heights up front, before any chain reads: a
        // non-finite / unsafe / negative target would otherwise walk dispute
        // windows and hang the responder's event loop. Returning undefined lets
        // the caller cut the requester (a spammer of invalid requests).
        if (
            _blockHeight !== undefined &&
            (!Number.isSafeInteger(_blockHeight) || _blockHeight < 0)
        ) {
            this.logger.warn("generateSyncPayload - invalid requested height", {
                blockHeight: _blockHeight
            });
            return undefined;
        }

        // -------- Collect what is needed to prove the latestForkGenesisSnapshot starting from the onChainSnapshot --------
        // We'll do all the computation on our local state.
        // If our local state is not synced we shouldn't even be syncing the spectator and we probably have bigger problems

        const currentOnChainSnapshot = StateSnapshot.from(
            await diamondStateMachine.localDiamondContract.getStateSnapshot(
                channelId
            )
        );

        const disputeWindows: DisputeWindowVerification[] = [];
        let latestComputation: ReductionComputation | undefined;
        let computedGenesisSnapshot: StateSnapshot | undefined;
        let currentForkId = currentOnChainSnapshot.forkID;
        // the disputed flag comes from the same owner as the window below. the
        // local EVM only knows the dispute events we've processed, so reading
        // it there while reading the window from the chain would skip the walk
        // entirely for a fork whose events haven't arrived - and serve a proof
        // for a fork that is disputed and already reduced on-chain
        let isDisputed =
            await stateManager.stateChannelManagerContract.isForkDisputed(
                channelId,
                currentForkId
            );

        while (isDisputed) {
            // Collect all disputes for this dispute window.
            // A commitment can land on-chain before its dispute event is
            // processed locally; recover it before reading storage so a
            // still-pending event doesn't abort the sync.
            const currentWindowCommitments =
                await stateManager.eventSyncService.loadSynchronizedWindowCommitments(
                    channelId,
                    currentForkId
                );
            if (!currentWindowCommitments) {
                // the window's disputes are on-chain but not locally readable
                // yet, so we cannot prove the tip -> refuse to serve rather
                // than serve a proof we could not build
                this.logger.warn(
                    "generateSyncPayload - dispute window unavailable",
                    { channelId, forkId: currentForkId }
                );
                return undefined;
            }
            const currentWindowDisputeConfirmations =
                agreementManager.getForkDisputeConfirmations(
                    currentWindowCommitments
                );

            const currentWindowDisputes =
                await agreementManager.getForkDisputes(
                    currentWindowCommitments
                );

            // After collecting disputes for this window, reduce to get the next fork
            const computation =
                await stateManager.reductionManager.computeReductionLocally(
                    currentForkId,
                    currentWindowDisputes
                );
            if (!computation) {
                // we cannot rebuild the run this window's reduce consumed, so we
                // cannot prove the tip -> refuse to serve rather than serve a
                // proof we could not build
                this.logger.warn(
                    "generateSyncPayload - reduce data unavailable for a disputed window",
                    { channelId, forkId: currentForkId }
                );
                return undefined;
            }
            const { reduceData, reducedForkId } = computation;
            latestComputation = computation;
            const computedGenesisTimestamp = (
                await stateManager.reductionManager.isKillPeriodExpiredCached(
                    currentForkId
                )
            ).killPeriodEnd;
            // Reuse the outbound-chain owner before building the proof range.
            // Background genesis installation persists this same block idempotently.
            computedGenesisSnapshot =
                stateManager.reductionManager.prepareReducedGenesis(
                    computation,
                    computedGenesisTimestamp
                ).genesisSnapshot;

            // Move to the next fork using local EVM
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
                await stateManager.stateChannelManagerContract.isForkDisputed(
                    channelId,
                    currentForkId
                );
        }

        // A request without a fork asks for the latest state: the fork derived
        // above, not this responder's own fork. A responder whose own state is
        // not installed yet holds no fork of its own, and the mismatch below
        // would wrongly cut the requester; without that fork's genesis it
        // throws instead, which spends only the requester's retry bound.
        let forkId = _forkId ?? currentForkId;

        if (
            currentForkId !== forkId &&
            disputeWindows.some((window) => window.forkId === forkId)
        ) {
            // A proved reduction supersedes the requested block's fork. The
            // request accepts the successor without requiring an absent old block.
            forkId = currentForkId;
            _blockHeight = undefined;
        }

        if (currentForkId != forkId) {
            // The requested fork isn't the tip we derive from our own reductions,
            // so we can't prove it. Return undefined → the caller cuts the
            // requester and the requester cuts us (mutual). A sync requester only
            // ever asks peers expected to prove the target - the block's own
            // suppliers/author for the block's fork, or a participant for the
            // latest - so a peer that can't prove it failed to cooperate.
            this.logger.debug(
                `generateSyncPayload - requested fork ${forkId} is not the derived latest fork ${currentForkId}`
            );
            return undefined;
        }

        // -------- Collect what is needed to prove the latest possible state in the latest fork ---------

        // Get the latest fork genesis snapshot to include in the payload
        const latestForkGenesisSnapshot =
            stateManager.storage.stateSnapshots.getGenesisSnapshotByForkId(
                forkId
            ) ??
            (computedGenesisSnapshot?.forkID === forkId
                ? computedGenesisSnapshot
                : undefined);
        const hasInstalledGenesis =
            !!stateManager.storage.stateSnapshots.getGenesisSnapshotByForkId(
                forkId
            );
        if (!latestForkGenesisSnapshot) {
            throw new Error(`No genesis snapshot found for fork ${forkId}`);
        }
        const latestForkGenesisEncodedState =
            stateManager.storage.stateMachineStates.getStateMachineState(
                latestForkGenesisSnapshot.snapshotData.stateMachineStateHash
            ) ?? latestComputation?.reducedEncodedStateMachineState;
        if (!latestForkGenesisEncodedState) {
            throw new Error(
                `No encoded state found for latest fork genesis state hash ${latestForkGenesisSnapshot.snapshotData.stateMachineStateHash}`
            );
        }

        let outboundMessageBlocksUpToLatestGenesis: SyncPayload["outboundMessageBlocksUpToLatestGenesis"] =
            [];
        if (
            currentOnChainSnapshot.forkID !== latestForkGenesisSnapshot.forkID
        ) {
            const { lowerOutboundSnapshot, upperOutboundSnapshot } =
                SpectateService.orderOutboundSnapshots(
                    currentOnChainSnapshot,
                    latestForkGenesisSnapshot
                );
            outboundMessageBlocksUpToLatestGenesis =
                stateManager.storage.outboundMessages.getMessageBlocksInRange({
                    upperBlockHash:
                        upperOutboundSnapshot.latestOutboundMessageBlockHash,
                    lowerBlockHash:
                        lowerOutboundSnapshot.latestOutboundMessageBlockHash
                });
        }

        const latestBlockHeight =
            stateManager.storage.blocks.getNextBlockHeight(forkId) - 1;

        // A pinned height is a minimum. Serve the newest proof available, but
        // refuse a target above it rather than silently returning older state.
        if (_blockHeight !== undefined && _blockHeight > latestBlockHeight) {
            return undefined;
        }
        const targetBlockHeight = latestBlockHeight;
        // A computed, uninstalled successor has no local blocks or milestones:
        // its proof is empty and its genesis is the final point.
        const built = hasInstalledGenesis
            ? await agreementManager.buildStateProof(forkId, targetBlockHeight)
            : undefined;
        const latestStateProof: StateProofStruct = built?.stateProof ?? {
            milestones: []
        };
        const milestoneSnapshots = built?.evidence.milestoneSnapshots ?? [];
        // From the final point the peer replays and validates each later block.
        const latestFinalizedSnapshot =
            built?.finalizedSnapshot ?? latestForkGenesisSnapshot;

        const stateHash =
            latestFinalizedSnapshot.snapshotData.stateMachineStateHash;
        const latestFinalizedEncodedState =
            stateManager.storage.stateMachineStates.getStateMachineState(
                stateHash
            ) ??
            (stateHash ===
            latestForkGenesisSnapshot.snapshotData.stateMachineStateHash
                ? latestForkGenesisEncodedState
                : undefined);
        if (!latestFinalizedEncodedState) {
            throw new Error(
                `No encoded state found for state hash ${stateHash}`
            );
        }

        // the run above the local diamond's anchor when it is on this fork:
        // the requester's chain anchor is not behind it, and nothing below it
        // is kept. An anchor at or above the final point leaves nothing.
        const outboundStart =
            currentOnChainSnapshot.forkID === forkId
                ? currentOnChainSnapshot
                : latestForkGenesisSnapshot;
        const outboundMessageBlocksOfTheLatestFork =
            outboundStart.latestOutboundMessageBlockHeight >=
            latestFinalizedSnapshot.latestOutboundMessageBlockHeight
                ? []
                : stateManager.storage.outboundMessages.getMessageBlocksInRange(
                      {
                          upperBlockHash:
                              latestFinalizedSnapshot.latestOutboundMessageBlockHash,
                          lowerBlockHash:
                              outboundStart.latestOutboundMessageBlockHash
                      }
                  );
        // Return payload with all available data
        const syncPayload: SyncPayload = {
            disputeWindows,
            latestForkGenesisSnapshot: latestForkGenesisSnapshot.toStruct(),
            latestForkGenesisEncodedState,
            stateProof: latestStateProof,
            milestoneSnapshots,
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
            currentOnChainSnapshot.toStruct(),
            { blockNumber: 0, logIndex: 0 }
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
        return disputeWindows;
    }

    /**
     * The state the sync installs and the last-run index its replay starts
     * at: the walk's final point with this peer's own state or the served
     * state, else an earlier point of the last run (or the genesis before
     * block 0) whose served state the replay carries to the final point. An
     * earlier point must link by hash to the verified final block, so the
     * replay can only reach the verified state. A later point would skip
     * unfinalized blocks: none.
     */
    private getReplayBase(
        syncPayload: SyncPayload,
        walk: ProofTierWalk,
        lastRun: (Block | undefined)[]
    ): SyncReplayBase | undefined {
        const finalized = walk.finalizedSnapshot;
        const ownState =
            this.p2pManager.stateManager.storage.stateMachineStates.getStateMachineState(
                finalized.stateMachineStateHash
            );
        const servedState = syncPayload.latestFinalizedEncodedState as Bytes;
        const servedHash = hash(servedState);
        if (
            ownState !== undefined ||
            servedHash === finalized.stateMachineStateHash
        )
            return {
                snapshot: finalized,
                state: ownState ?? servedState,
                fromIndex: walk.replayBlockIndex
            };
        // the verified final block is the one before the walk's tail
        const finalIndex = walk.replayBlockIndex - 1;
        const linksToFinal = (from: number) => {
            for (let i = from; i < finalIndex; i++) {
                const [lower, upper] = [lastRun[i], lastRun[i + 1]];
                if (!lower || !upper || upper.previousBlockHash !== lower.hash)
                    return false;
            }
            return true;
        };
        const genesis = StateSnapshot.from(
            syncPayload.latestForkGenesisSnapshot
        );
        const first = lastRun[0];
        if (
            genesis.stateMachineStateHash === servedHash &&
            first?.height === 0 &&
            first.previousBlockHash === genesis.hash &&
            linksToFinal(0)
        )
            return { snapshot: genesis, state: servedState, fromIndex: 0 };
        for (const struct of syncPayload.milestoneSnapshots) {
            const snapshot = StateSnapshot.from(struct);
            if (snapshot.stateMachineStateHash !== servedHash) continue;
            const index = lastRun.findIndex(
                (block) => block?.stateSnapshotHash === snapshot.hash
            );
            if (index !== -1 && index < finalIndex && linksToFinal(index))
                return {
                    snapshot,
                    state: servedState,
                    fromIndex: index + 1,
                    block: lastRun[index]
                };
        }
        return undefined;
    }

    /**
     * Persists the verified sync: dispute windows, the genesis, outbound
     * runs, the proof material the walk verified (final history advances the
     * view), then installs the replay base unless this peer already holds
     * that point or a later one. Existing data is never overwritten. The
     * history is stored in the same synchronous step that installs the base,
     * so no task sees it before the fork swap. A runtime disposed before that
     * step persists and installs nothing (abort).
     */
    public async persistSyncPayload(
        syncPayload: SyncPayload,
        verified: VerifiedSync
    ): Promise<{ shouldAbort: boolean }> {
        const stateManager = this.p2pManager.stateManager;
        const { walk, evidence, base } = verified;
        return await stateManager.withMutex(
            async () => {
                if (stateManager.isDisposed) return { shouldAbort: true };
                this.logger.debug(`Persisting sync payload`, syncPayload);
                const storage = stateManager.storage;
                const forkId = base.snapshot.forkID;
                // verified history conflicting with what this peer holds: abort
                const persistProof =
                    stateManager.agreementManager.stageVerifiedProof(
                        syncPayload.stateProof,
                        evidence,
                        walk,
                        { replayFromIndex: base.fromIndex, advanceView: true }
                    );
                if (!persistProof) return { shouldAbort: true };
                const persistHistory = () => {
                    if (stateManager.isDisposed || !persistProof())
                        return false;
                    for (const dw of syncPayload.disputeWindows) {
                        for (const dispute of dw.disputeConfirmations) {
                            storage.disputes.storeDisputeConfirmation(dispute);
                        }
                        // a chain-final window ran no local reduction, so its
                        // reduction input is unverified: never stored
                        if (verified.chainFinalForkIds.has(dw.forkId)) continue;
                        storage.stateSnapshots.storeStateSnapshot(
                            StateSnapshot.from(dw.latestStateSnapshot)
                        );
                        storage.stateMachineStates.storeStateMachineState(
                            dw.latestEncodedStateMachineState
                        );
                        // only this sync's own reduction checked a window's inbound list; any
                        // other window's list is dropped and chain events deliver the genuine blocks
                        if (!verified.selfReducedForkIds.has(dw.forkId))
                            continue;
                        for (const inboundBlock of dw.inboundMessageBlocksAppliedInReduce) {
                            storage.inboundMessages.store(inboundBlock);
                        }
                    }
                    storage.stateSnapshots.storeStateSnapshot(
                        StateSnapshot.from(
                            syncPayload.latestForkGenesisSnapshot
                        )
                    );
                    storage.stateMachineStates.storeStateMachineState(
                        syncPayload.latestForkGenesisEncodedState,
                        {
                            hash: syncPayload.latestForkGenesisSnapshot
                                .snapshotData.stateMachineStateHash
                        }
                    );
                    for (const omb of syncPayload.outboundMessageBlocksUpToLatestGenesis)
                        storage.outboundMessages.store(omb);
                    for (const omb of syncPayload.outboundMessageBlocksOfTheLatestFork)
                        storage.outboundMessages.store(omb);
                    if (base.block) storage.blocks.storeBlock(base.block);
                    return true;
                };

                const baseHeight =
                    base.fromIndex === 0 ? -1 : base.snapshot.blockHeight;
                const localLatestHeight =
                    storage.blocks.getLatestBlock(forkId)?.height ?? -1;
                const holdsBase =
                    stateManager.forkId === forkId &&
                    storage.stateMachineStates.getStateMachineState(
                        base.snapshot.stateMachineStateHash
                    ) !== undefined &&
                    localLatestHeight >= baseHeight;
                if (holdsBase) {
                    if (!persistHistory()) return { shouldAbort: true };
                    this.logger.info(
                        "Sync keeps the local state: it already holds the installed point or a later one",
                        { forkId, baseHeight, localLatestHeight }
                    );
                    return { shouldAbort: false };
                }
                // a conflict found after the VM write restores the VM
                const installed =
                    await stateManager.stateApplicationService.unsafeSetLatestState(
                        base.snapshot.toStruct(),
                        base.state,
                        undefined,
                        persistHistory
                    );
                this.logger.debug(`Finished persisting sync payload`);
                return { shouldAbort: !installed };
            },
            { taskName: "persistSyncPayload" }
        );
    }

    public static orderOutboundSnapshots(
        a: StateSnapshot,
        b: StateSnapshot
    ): {
        lowerOutboundSnapshot: StateSnapshot;
        upperOutboundSnapshot: StateSnapshot;
    } {
        return a.latestOutboundMessageBlockHeight <=
            b.latestOutboundMessageBlockHeight
            ? { lowerOutboundSnapshot: a, upperOutboundSnapshot: b }
            : { lowerOutboundSnapshot: b, upperOutboundSnapshot: a };
    }

    private rejectSync(peerAddress: string, reason: string): false {
        this.logger.debug("applySyncResponse - rejecting sync", {
            peerAddress,
            reason
        });
        this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
            peerAddress,
            `sync payload rejected: ${reason}`
        );
        return false;
    }
}

export default SpectateService;

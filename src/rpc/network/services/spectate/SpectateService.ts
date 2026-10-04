import SpectateServiceRpcMethods from "./SpectateRpcMethods";
import type { BuiltStateProof } from "@/agreementManager/AgreementManager";
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
import { Codec, getChecksumAddress, hash, isSubset, Type } from "@/utils";
import { errorMessage } from "@/utils/errorMessage";
import { isLocalEvmExecutionFailure } from "@/utils/evmErrorHandler";
import type { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";

/** What a verified sync payload installs, beside the payload itself. */
type VerifiedSync = {
    start: StateSnapshot;
    stateSnapshot: StateSnapshot;
    encodedState: Bytes;
    historicalBlocks: Block[];
    finalPoints: { height: number; snapshot: StateSnapshot }[];
    /** windows that ran no local reduction: their reduction input is unverified */
    chainFinalForkIds: Set<ForkId>;
};

const participantSet = (snapshot: StateSnapshot) =>
    new Set(
        snapshot.snapshotData.participants.map((address) =>
            String(address).toLowerCase()
        )
    );

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
        // applySyncResponse rejects bad peer data itself; any error is ours
        return await this.applySyncResponse(
            normalizedPeerAddress,
            syncRequest,
            response.encodedSyncPayload
        );
    }

    /**
     * Validate and apply a sync payload returned by `onSpectateRequest`. Was the
     * body of the old `onSpectateResponse` endpoint; the request now lives in
     * `sync`'s closure, so the channel is taken from our own `syncRequest`
     * (never the peer's echo) and the previous channel-binding check is moot.
     * Validation failures reject the peer and return false. The caller owns
     * the lifecycle consequence of a failed sync.
     */
    public async applySyncResponse(
        peerAddress: string,
        syncRequest: SyncRequest,
        encodedSyncPayload: Bytes
    ): Promise<boolean> {
        const channelId = syncRequest.channelId;

        // Peer data that does not decode rejects the peer. Every other error
        // is a local failure and propagates.
        let syncPayload: SyncPayload;
        let windowDisputes: DisputeStruct[][];
        try {
            syncPayload = Codec.decode(encodedSyncPayload, Type.SyncPayload);
            windowDisputes = syncPayload.disputeWindows.map((dw) =>
                dw.disputeConfirmations.map((confirmation) =>
                    Codec.decode(
                        confirmation.signedDispute.encodedDispute,
                        Type.Dispute
                    )
                )
            );
        } catch {
            return this.rejectSync(peerAddress, "payload undecodable");
        }
        this.logger.debug(`Sync payload received`, { syncPayload });
        if (
            syncPayload.stateProof.milestones.some((milestone) =>
                milestone.blockConfirmations.some(
                    (bc) => !Block.tryFromBlockConfirmation(bc)
                )
            )
        )
            return this.rejectSync(peerAddress, "proof block undecodable");

        // Steps:
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
        //      2.9) verify stateProof proves latest state from the latest trusted final state (pruned history never needed) -> abort otherwise
        //      2.10) verify outboundMessageBlocks from the proof start to the installed state
        //      2.11) verify balance invariant of the latestFinalizedState -> abort otherwise
        // 3) no adoption is simulated against the live chain; the checks above are the verification
        // 4) Deconstruct the SyncPayload and persist its component normally in our local 'storage'
        // 5) set some syncFlag to true that will start executing the onBlockConfirmation pipeline with `SpectateStrategy` from un-finalized blocks
        // 6) if a state was requested, check the proved height reaches it

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
        // lands between reads, while a false decision safely reduces locally.
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
            await this.fetchAndPersistOnChainDisputeWindows(channelId, forkIds);

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
                return this.rejectSync(peerAddress, "kill period not expired");

            // 2.3) reduce them if they're not already reduced
            const isReducedAndFinal = finalizedByFork.get(dw.forkId);
            if (!isReducedAndFinal) {
                // a revert judges the peer's window; any other error is ours
                try {
                    await diamondStateMachine.localDiamondContract.reduceAndFinalize(
                        windowDisputes[syncPayload.disputeWindows.indexOf(dw)],
                        dw.latestStateSnapshot,
                        dw.latestEncodedStateMachineState,
                        dw.inboundMessageBlocksAppliedInReduce,
                        dw.reducedForkId
                    );
                } catch (error) {
                    if (!isLocalEvmExecutionFailure(error)) throw error;
                    return this.rejectSync(
                        peerAddress,
                        "dispute window reduction reverted"
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
            stateHashMatch &&
            (await this.matchesTrustedGenesis(
                channelId,
                syncPayload,
                onChainSnapshot
            ));

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
                return this.rejectSync(peerAddress, "latest fork is disputed");
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

        // 2.9) verify stateProof proves latest state -> abort otherwise
        // local tiers first, stale start fine
        const forkId = genesisSnapshot.forkID;
        const walk = await stateManager.agreementManager.verifyStateProof(
            { channelId, forkId, stateProof: syncPayload.stateProof },
            {
                genesisStateSnapshotData:
                    syncPayload.latestForkGenesisSnapshot.snapshotData,
                milestoneSnapshots: syncPayload.milestoneSnapshots
            }
        );
        if (walk.status === "invalid")
            return this.rejectSync(peerAddress, "milestones invalid");
        // only what the walk verified from its start is stored
        const start = walk.start ?? genesisSnapshot;
        const finalized = walk.finalizedSnapshot;
        const milestones = syncPayload.stateProof.milestones;
        const lastRun = (milestones.at(-1)?.blockConfirmations ?? []).map(
            (bc) => Block.fromBlockConfirmation(bc)
        );
        // State bytes bind to their own snapshot: the final point, or the
        // responder's earlier point of the last run that the tail replay
        // carries to it. Genesis sits before block 0.
        const heightOf = (snapshot: StateSnapshot) =>
            snapshot.hash === genesisSnapshot.hash ? -1 : snapshot.blockHeight;
        const encodedState = syncPayload.latestFinalizedEncodedState;
        const stateSnapshot = [
            finalized,
            ...syncPayload.milestoneSnapshots.map((s) => StateSnapshot.from(s)),
            genesisSnapshot
        ].find((s) => s.stateMachineStateHash === hash(encodedState));
        if (!stateSnapshot)
            return this.rejectSync(
                peerAddress,
                "finalized state hash mismatch"
            );
        const commitHeight = (snapshot: StateSnapshot) =>
            snapshot.hash === genesisSnapshot.hash
                ? -1
                : lastRun.find((b) => b.stateSnapshotHash === snapshot.hash)
                      ?.height;
        // a served state below the proof start is stale: its replay would
        // run through blocks the walk never checked
        if (
            start !== genesisSnapshot &&
            heightOf(stateSnapshot) < start.blockHeight
        )
            return this.rejectSync(
                peerAddress,
                "served state below the proof start"
            );
        const stateHeight = commitHeight(stateSnapshot);
        // sync completes only when replayable state reaches the final point
        if (
            stateSnapshot.hash !== finalized.hash &&
            (commitHeight(finalized) === undefined ||
                stateHeight === undefined ||
                stateHeight > heightOf(finalized))
        )
            return this.rejectSync(
                peerAddress,
                "served state does not reach the final point"
            );
        // the last-run tail enters storage only through its own replay
        const tail = lastRun.filter(
            (block) => block.height > heightOf(stateSnapshot)
        );

        // 2.10) verify outboundMessageBlocks of the latest fork from the proof start to the installed state
        const outboundAheadOfStart =
            stateSnapshot.latestOutboundMessageBlockHeight >=
            start.latestOutboundMessageBlockHeight;
        const outboundMessageBlocksOfTheLatestFork = outboundAheadOfStart
            ? await diamondStateMachine.localDiamondContract.pruneOutboundMessageBlocks(
                  syncPayload.outboundMessageBlocksOfTheLatestFork,
                  start.latestOutboundMessageBlockHash
              )
            : [];
        if (
            outboundAheadOfStart &&
            !(await diamondStateMachine.localDiamondContract.verifyOutboundMessageBlocks(
                outboundMessageBlocksOfTheLatestFork,
                start.snapshotData,
                stateSnapshot.snapshotData
            ))
        )
            return this.rejectSync(
                peerAddress,
                "latest-fork outbound blocks invalid"
            );

        // 2.11) verify balance invariant of the latestFinalizedState -> abort otherwise
        const isValidBalance =
            await stateManager.stateChannelManagerContract.verifyBalanceInvariantCheckSnapshot.staticCall(
                channelId,
                stateSnapshot.snapshotData,
                encodedState
            );
        if (!isValidBalance)
            return this.rejectSync(peerAddress, "balance invariant failed");

        // 4) Deconstruct the SyncPayload and persist its component normally in our local 'storage'
        // the walk drops a milestone wholly below its start: never stored
        const tailHashes = new Set(tail.map((block) => block.hash));
        const startHeight = start === genesisSnapshot ? 0 : start.blockHeight;
        const historicalBlocks: Block[] = [];
        const finalPoints: { height: number; snapshot: StateSnapshot }[] = [];
        milestones.forEach((milestone, index) => {
            const blocks = milestone.blockConfirmations.map((bc) =>
                Block.fromBlockConfirmation(bc)
            );
            if (blocks.at(-1)!.height < startHeight) return;
            // the walk checks a run holding the start only from the start up
            historicalBlocks.push(
                ...blocks.filter(
                    (block) =>
                        block.height >= startHeight &&
                        !tailHashes.has(block.hash)
                )
            );
            // such a run proves only the start, which is stored on its own
            if (blocks[0].height < startHeight) return;
            const snapshot = StateSnapshot.from(
                syncPayload.milestoneSnapshots[index]
            );
            // the last milestone's first block is final unless it is the
            // unfinal genesis block 0 (its tail starts at 0)
            if (
                snapshot.hash === blocks[0].stateSnapshotHash &&
                (index < milestones.length - 1 || walk.replayBlockIndex > 0)
            )
                finalPoints.push({ height: blocks[0].height, snapshot });
        });
        const { shouldAbort } = await this.persistSyncPayload(
            {
                ...syncPayload,
                disputeWindows: linkedDisputeWindows,
                outboundMessageBlocksUpToLatestGenesis,
                outboundMessageBlocksOfTheLatestFork
            },
            {
                stateSnapshot,
                encodedState,
                start,
                historicalBlocks,
                finalPoints,
                chainFinalForkIds: new Set(
                    linkedDisputeWindows
                        .map((dw) => dw.forkId)
                        .filter((forkId) => finalizedByFork.get(forkId))
                )
            }
        );
        if (shouldAbort)
            return this.rejectSync(peerAddress, "payload persistence aborted");

        // 5) Start executing the onBlockConfirmation pipeline with unfinalized blocks
        this.logger.debug(
            `Spectate sync - BlockConfirmation pipeline for ${tail.length} unfinalized blocks from height ${heightOf(stateSnapshot) + 1}`
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
            const latestHeight = lastRun.at(-1)?.height;
            if (latestHeight === undefined)
                return this.rejectSync(peerAddress, "state proof has no block");
            if (latestHeight < syncRequest.blockHeight)
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

        // Get the current fork ID
        let forkId = _forkId ?? stateManager.forkId;

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
                // than serve a proof we could not build. This responder is not
                // ready, the request is valid: throw so the requester is
                // refused, not excluded (undefined would blacklist it)
                this.logger.warn(
                    "generateSyncPayload - dispute window unavailable",
                    { channelId, forkId: currentForkId }
                );
                throw new Error(
                    `Dispute window unavailable for fork ${currentForkId}`
                );
            }
            // The requester accepts a window only once its kill period has
            // expired: until then evidence can still change the reduction.
            // Refuse, so the requester retries later instead of excluding
            // this responder.
            const killPeriod =
                await stateManager.reductionManager.isKillPeriodExpiredCached(
                    currentForkId
                );
            if (!killPeriod.isExpired) {
                this.logger.debug(
                    "generateSyncPayload - dispute window kill period not expired",
                    {
                        channelId,
                        forkId: currentForkId,
                        killPeriodEnd: killPeriod.killPeriodEnd
                    }
                );
                throw new Error(
                    `Kill period not expired for disputed fork ${currentForkId}`
                );
            }
            const currentWindowDisputeConfirmations =
                agreementManager.getForkDisputeConfirmations(
                    currentWindowCommitments
                );

            const currentWindowDisputes =
                await agreementManager.getForkDisputes(
                    currentWindowCommitments
                );

            // After collecting disputes for this window, reduce to get the next fork.
            // A reduce input missing from storage throws in the rebuild: the
            // same refusal as reduce data the rebuild reports unavailable
            let computation: ReductionComputation | undefined;
            try {
                computation =
                    await stateManager.reductionManager.computeReductionLocally(
                        currentForkId,
                        currentWindowDisputes
                    );
            } catch (error) {
                this.logger.warn(
                    "generateSyncPayload - reduce data rebuild failed for a disputed window",
                    {
                        channelId,
                        forkId: currentForkId,
                        error: errorMessage(error)
                    }
                );
            }
            if (!computation) {
                // we cannot rebuild the run this window's reduce consumed, so we
                // cannot prove the tip -> refuse to serve rather than serve a
                // proof we could not build. As above: refused, not excluded
                this.logger.warn(
                    "generateSyncPayload - reduce data unavailable for a disputed window",
                    { channelId, forkId: currentForkId }
                );
                throw new Error(
                    `Reduce data unavailable for disputed fork ${currentForkId}`
                );
            }
            const { reduceData, reducedForkId } = computation;
            latestComputation = computation;
            const computedGenesisTimestamp = killPeriod.killPeriodEnd;
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
        if (!_forkId) forkId = currentForkId;

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
        // A computed, uninstalled successor has no local blocks or milestones.
        let built: BuiltStateProof | undefined;
        try {
            built = hasInstalledGenesis
                ? await agreementManager.buildStateProof(
                      forkId,
                      targetBlockHeight
                  )
                : undefined;
        } catch (error) {
            this.logger.debug(
                `No state proof found for fork ${forkId} blockHeight ${targetBlockHeight}`,
                { error }
            );
            return undefined;
        }
        const latestStateProof = built?.stateProof ?? { milestones: [] };
        const milestoneSnapshots = built?.milestoneSnapshots ?? [];
        if (milestoneSnapshots.some((snapshot) => !snapshot))
            throw new Error("Missing milestone snapshot for provided proof");

        // The state served is the proof's own final point, as the walk reads it.
        const latestFinalizedSnapshot = built
            ? built.finalizedSnapshot
            : latestForkGenesisSnapshot;
        if (!latestFinalizedSnapshot)
            throw new Error(
                `Own state proof of fork ${forkId} does not verify`
            );

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
            milestoneSnapshots: milestoneSnapshots.map((ms) => ms!.toStruct()),
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

    /** Persist verified history, threshold and change points, and the installed state; never the tail. */
    public async persistSyncPayload(
        syncPayload: SyncPayload,
        verified: VerifiedSync
    ): Promise<{ shouldAbort: boolean }> {
        const stateManager = this.p2pManager.stateManager;
        const { stateSnapshot, historicalBlocks, finalPoints } = verified;
        return await stateManager.withMutex(
            async () => {
                this.logger.debug(`Persisting sync payload`, syncPayload);
                const storage = stateManager.storage;
                const forkId = stateSnapshot.forkID;
                const localLatestHeight =
                    storage.blocks.getLatestBlock(forkId)?.height ?? -1;

                if (localLatestHeight >= stateSnapshot.blockHeight) {
                    this.logger.info(
                        "Skipping sync payload persistence: local storage is already ahead of latest finalized snapshot",
                        {
                            finalizedForkId: forkId,
                            finalizedHeight: stateSnapshot.blockHeight,
                            localLatestHeight
                        }
                    );
                    return { shouldAbort: false };
                }

                if (
                    historicalBlocks.some((block) =>
                        this.hasBlockConflict(block)
                    )
                )
                    return { shouldAbort: true };

                for (const dw of syncPayload.disputeWindows) {
                    for (const dispute of dw.disputeConfirmations) {
                        storage.disputes.storeDisputeConfirmation(dispute);
                    }
                    // a chain-final window ran no local reduction, so its
                    // reduction input (snapshot, state, inbound blocks) is
                    // unverified: never stored (the inbound events load the
                    // real blocks)
                    if (verified.chainFinalForkIds.has(dw.forkId)) continue;
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
                // the walk's trusted start (the chain anchor): a later sync
                // replays it as an on-chain snapshot event, which must find
                // it known, not as a snapshot that removed a pending joiner
                storage.stateSnapshots.storeStateSnapshot(verified.start);
                // same exact block -> signatures merge
                for (const block of historicalBlocks)
                    storage.blocks.storeBlock(block);
                let participants = participantSet(verified.start);
                for (const { height, snapshot } of finalPoints) {
                    storage.stateSnapshots.storeStateSnapshot(snapshot);
                    const next = participantSet(snapshot);
                    if (
                        next.size !== participants.size ||
                        !isSubset(next, participants)
                    )
                        storage.participantSetChanges.storeChangePoint(
                            forkId,
                            height
                        );
                    participants = next;
                }
                for (const omb of syncPayload.outboundMessageBlocksUpToLatestGenesis)
                    storage.outboundMessages.store(omb);
                for (const omb of syncPayload.outboundMessageBlocksOfTheLatestFork)
                    storage.outboundMessages.store(omb);

                await stateManager.stateApplicationService.unsafeSetLatestState(
                    stateSnapshot.toStruct(),
                    verified.encodedState
                );
                this.logger.debug(`Finished persisting sync payload`);
                return { shouldAbort: false };
            },
            { taskName: "persistSyncPayload" }
        );
    }

    /**
     * The served genesis equals the trusted genesis in full, timestamp
     * included, as the chain's genesis timestamp rule defines it: a reduced
     * fork's genesis carries its window's kill-period end; a fork whose
     * genesis is the on-chain snapshot is that snapshot. With neither, the
     * chain holds no genesis to compare.
     */
    private async matchesTrustedGenesis(
        channelId: ChannelId,
        syncPayload: SyncPayload,
        onChainSnapshot: StateSnapshot
    ): Promise<boolean> {
        const localDiamond =
            this.p2pManager.stateManager.diamondStateMachine
                .localDiamondContract;
        const genesis = StateSnapshot.from(
            syncPayload.latestForkGenesisSnapshot
        );
        // every served window is adopted or linked here: the last one reduced
        // into the genesis fork, and its chain window is persisted locally
        const reducingWindow = syncPayload.disputeWindows.at(-1);
        if (reducingWindow) {
            const { killPeriodEnd } = await localDiamond.isKillPeriodExpired(
                channelId,
                reducingWindow.forkId
            );
            return BigInt(genesis.timestamp) === killPeriodEnd;
        }
        if (
            await localDiamond.isGenesisSnapshotWithoutTimeCheck(
                onChainSnapshot.toStruct()
            )
        )
            return genesis.hash === onChainSnapshot.hash;
        return true;
    }

    private hasBlockConflict(block: Block): boolean {
        const existingBlock =
            this.p2pManager.stateManager.storage.blocks.getBlock(
                block.forkId,
                block.height
            );
        if (existingBlock && !existingBlock.equals(block)) {
            this.logger.warn("Spectate sync storage conflict", {
                blockHash: block.hash,
                existingBlockHash: existingBlock.hash,
                forkId: block.forkId,
                height: block.height
            });
            return true;
        }
        return false;
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

import ARpcService from "@/rpc/ARpcService";
import {
    Address,
    Bytes,
    ChannelId,
    Timestamp,
    Hash,
    ForkId,
    BlockHeight
} from "@/types/types";
import { Block, StateSnapshot } from "@/models";
import Clock from "@/Clock";
import ATransport from "@/transport/ATransport";
import {
    Codec,
    getChecksumAddress,
    hash,
    tryDecodeCustomError,
    Type
} from "@/utils";
import { ethers } from "ethers";
import { StateProofStruct } from "@typechain-types/contracts/V1/types/ProofTypes";
import { StateSnapshotStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import SpectateServiceRpcMethods from "./SpectateRpcMethods";
import type P2PManager from "@/P2PManager";
import { Status } from "@/types";
import { HandshakeCompletedGuard } from "@/rpc/guards";
import { DisputeWindowVerification, SyncPayload } from "@/types";
export interface SyncRequest {
    channelId: ChannelId;
    initTime: Timestamp;
    forkId?: ForkId;
    blockHeight?: number;
}

export type SyncFailReason =
    | "in-flight-collision"
    | "request-failed"
    | "rtt-exceeded"
    | "chain-view-mismatch"
    | "storage-conflict"
    | "pipeline-rejected"
    | "internal-error"
    | "malformed-payload"
    | "invalid-proof";

export type SyncOutcome =
    | {
          ok: true;
          confirmedForkId: ForkId;
          confirmedHeight: BlockHeight;
          localWasAhead: boolean;
      }
    | { ok: false; reason: SyncFailReason };

// Result of `persistSyncPayload`. "already-current" is only reachable when
// BOTH the block-height check AND the active-state proof (fork + state hash)
// confirm the target snapshot (or later) is actually restored - see
// `persistSyncPayload` for why height alone is not proof. "incomplete"
// distinguishes a local write fault (e.g. unsafeSetLatestState throwing after
// partial writes) from peer fraud ("conflict") - it must never be classified
// as invalid-proof/malformed-payload, since it's our own storage failing, not
// evidence the peer lied.
export type PersistSyncResult =
    | { outcome: "applied" }
    | { outcome: "already-current" }
    | { outcome: "conflict" }
    | { outcome: "incomplete"; error: unknown };

// Classification rationale: a reason is peer-provable only when it's
// decidable from the payload itself plus data whose truth we establish
// independently (crypto hashes, our own request, or a contract call whose
// inputs AND body touch only payload-supplied data) - and no honest peer
// could produce it through a race or a stale chain view. Everything else
// (time-, chain-view-, or local-state-dependent) is ambiguous. See failSync
// below for the full policy and the operational test used to classify each
// failure site.
const PEER_PROVABLE_REASONS: ReadonlySet<SyncFailReason> = new Set([
    "malformed-payload",
    "invalid-proof"
]);

interface InFlightSync {
    promise: Promise<SyncOutcome>;
    resumeMode: boolean;
    forkId?: ForkId;
    blockHeight?: number;
}

class SpectateService extends ARpcService<SpectateServiceRpcMethods> {
    // Peers with a sync request currently in flight, keyed by checksummed
    // address. Guards against launching a second concurrent sync to the same
    // peer, and carries enough of the request (forkId/blockHeight) for
    // `syncAwaitable` to decide whether it's safe to ADOPT the in-flight
    // sync's outcome (same target) or must report a collision (different
    // target - adopting would mis-confirm a target that sync never sought).
    // Registration/deregistration happens in exactly one place: `runSync`'s
    // try/finally.
    private readonly inFlightByPeerAddress: Map<string, InFlightSync> =
        new Map();

    // Depth counter (not boolean) for the resume window: overlapping/nested
    // resumes must not let the first one's exit reopen destructive failure
    // policy while a second is still active. See `enterResumeWindow` /
    // `exitResumeWindow`.
    private resumeWindowDepth = 0;

    constructor(p2pManager: P2PManager) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "SpectateService"
            })
        );
        this.guards = [new HandshakeCompletedGuard(this)];
    }

    public createRPCMethods(transport: ATransport): SpectateServiceRpcMethods {
        return new SpectateServiceRpcMethods(transport, this);
    }

    // Called locally to initiate spectate sync. Fire-and-forget entry point: the
    // request/response exchange and payload verification run in the background.
    // Non-resume mode: keeps today's behavior exactly (request failure
    // blacklists the peer, applySyncResponse failures go through abort()'s
    // full side effects). Callers ignore the return value.
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

        if (this.inFlightByPeerAddress.has(normalizedPeerAddress)) {
            this.logger.debug(
                "spectateSync - sync already in-flight; ignoring",
                { peerAddress: normalizedPeerAddress }
            );
            return;
        }

        const timeoutMs =
            this.p2pManager.stateManager.timeConfig.agreementTime * 1000;

        void this.runSync(
            normalizedPeerAddress,
            channelId,
            { resumeMode: false, timeoutMs },
            forkId,
            blockHeight
        );
    }

    /**
     * Awaitable, correlatable sync entry point used by the resume path
     * (P2PManager.resumeFromBackground). The in-flight guard is checked
     * SYNCHRONOUSLY FIRST, before constructing/adding anything. A sync
     * already in-flight for this peer - started by the fire-and-forget
     * `sync()` path above or a previous `syncAwaitable` call - is safe to
     * ADOPT (await its promise, raced against our own timeout) only when it
     * targets the same forkId/blockHeight we're requesting; adopting a
     * different target's outcome would report OUR target as confirmed by a
     * sync that never sought it. A different-target collision is routed
     * through `failSync` (always resume-mode here) and resolves immediately
     * with 'in-flight-collision'.
     */
    public syncAwaitable(
        peerAddress: Address,
        channelId: ChannelId,
        opts: { resumeMode: true; timeoutMs: number },
        forkId?: ForkId,
        blockHeight?: number
    ): Promise<SyncOutcome> {
        const normalizedPeerAddress = getChecksumAddress(peerAddress);

        const existing = this.inFlightByPeerAddress.get(normalizedPeerAddress);
        if (existing) {
            const sameTarget =
                existing.forkId === forkId &&
                existing.blockHeight === blockHeight;
            if (!sameTarget) {
                this.logger.debug(
                    "spectateSync - sync already in-flight for a different target; resolving awaitable with in-flight-collision",
                    {
                        peerAddress: normalizedPeerAddress,
                        requestedForkId: forkId,
                        requestedBlockHeight: blockHeight,
                        inFlightForkId: existing.forkId,
                        inFlightBlockHeight: existing.blockHeight
                    }
                );
                return Promise.resolve(
                    this.failSync(
                        normalizedPeerAddress,
                        "in-flight-collision",
                        true
                    )
                );
            }

            this.logger.debug(
                "spectateSync - sync already in-flight for the same target; adopting its outcome",
                { peerAddress: normalizedPeerAddress }
            );
            return this.raceAgainstTimeout(existing.promise, opts.timeoutMs);
        }

        return this.runSync(
            normalizedPeerAddress,
            channelId,
            opts,
            forkId,
            blockHeight
        );
    }

    /**
     * Races an already-running sync's promise against our own timeout,
     * WITHOUT cancelling or otherwise affecting the underlying in-flight
     * sync - it keeps running (and stays registered) regardless of whether
     * we time out waiting on it.
     */
    private raceAgainstTimeout(
        promise: Promise<SyncOutcome>,
        timeoutMs: number
    ): Promise<SyncOutcome> {
        return new Promise<SyncOutcome>((resolve) => {
            const timer = setTimeout(() => {
                resolve({ ok: false, reason: "in-flight-collision" });
            }, timeoutMs);
            void promise.then((outcome) => {
                clearTimeout(timer);
                resolve(outcome);
            });
        });
    }

    /**
     * Shared request/response launcher for both `sync()` and `syncAwaitable()`.
     * Assumes the in-flight guard was already checked by the caller. The map
     * entry (add) is created before anything below awaits, and removed in the
     * `finally` below - this is the ONLY add/delete site for
     * `inFlightByPeerAddress`. Never rejects - every failure path resolves a
     * SyncOutcome so callers can never hang on this promise.
     *
     * Registration ordering: `outcome` is a manually-resolved deferred, not
     * `runSync`'s own async-function promise, specifically so the map entry
     * can be registered (with a live promise callers can await) strictly
     * before the request-sending await below - there is no way to obtain an
     * async function's own promise from inside itself, so a deferred is the
     * only way to avoid a window where the entry is either missing or holds
     * a stale placeholder.
     */
    private runSync(
        normalizedPeerAddress: string,
        channelId: ChannelId,
        opts: { resumeMode: boolean; timeoutMs: number },
        forkId?: ForkId,
        blockHeight?: number
    ): Promise<SyncOutcome> {
        const syncRequest: SyncRequest = {
            channelId,
            initTime: Clock.getTimeInSeconds(),
            forkId,
            blockHeight
        };

        let resolveOutcome!: (outcome: SyncOutcome) => void;
        const outcome = new Promise<SyncOutcome>((resolve) => {
            resolveOutcome = resolve;
        });
        this.inFlightByPeerAddress.set(normalizedPeerAddress, {
            promise: outcome,
            resumeMode: opts.resumeMode,
            forkId,
            blockHeight
        });

        (async () => {
            try {
                // Transport can change (e.g. WebRTC upgrade). Always send by
                // address. p2p sync is mutual-cooperation: a request must be
                // answered with a valid proof. Any rejection - timeout,
                // transport error, or the responder cutting us because it
                // can't prove the target - means the peer didn't help us
                // sync, so we blacklist it (outside an active resume
                // window). `applySyncResponse` handles payload-validation
                // failures itself (via failSync), so the catch here is the
                // request path plus a defensive backstop.
                const { encodedSyncPayload } =
                    await this.remoteRpc.spectateService
                        .onSpectateRequest(syncRequest)
                        .request(normalizedPeerAddress, {
                            timeoutMs: opts.timeoutMs
                        });

                resolveOutcome(
                    await this.applySyncResponse(
                        normalizedPeerAddress,
                        syncRequest,
                        encodedSyncPayload,
                        {
                            resumeMode: opts.resumeMode,
                            timeoutMs: opts.timeoutMs
                        }
                    )
                );
            } catch (error) {
                this.logger.debug("spectateSync - request failed", {
                    peerAddress: normalizedPeerAddress,
                    resumeMode: opts.resumeMode,
                    error:
                        error instanceof Error ? error.message : String(error)
                });
                // A reactive (resumeMode:false) sync whose request fails
                // while a resume window is open must be held to the same
                // non-destructive policy as a resumeMode:true failure - a
                // resume's own transport rejoin is exactly what triggers the
                // handshake that fires this reactive sync. Outside a window,
                // preserve the original non-resume behavior exactly:
                // unconditional blacklist.
                const ambiguousFailureGated =
                    opts.resumeMode || this.resumeWindowDepth > 0;
                if (ambiguousFailureGated) {
                    this.logger.warn(
                        "spectateSync - suppressing punishment for request failure (resume mode or resume window active)",
                        {
                            peerAddress: normalizedPeerAddress,
                            resumeMode: opts.resumeMode,
                            resumeWindowDepth: this.resumeWindowDepth
                        }
                    );
                } else {
                    this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
                        normalizedPeerAddress
                    );
                }
                resolveOutcome({ ok: false, reason: "request-failed" });
            } finally {
                this.inFlightByPeerAddress.delete(normalizedPeerAddress);
            }
        })().catch((e: unknown) => {
            // Defensive backstop only - the try/catch above already resolves
            // `outcome` on every path, so this should never fire.
            this.logger.error("spectateSync - unexpected runSync failure", {
                peerAddress: normalizedPeerAddress,
                error: e instanceof Error ? e.message : String(e)
            });
        });

        return outcome;
    }

    /**
     * Validate and apply a sync payload returned by `onSpectateRequest`. Was the
     * body of the old `onSpectateResponse` endpoint; the request now lives in
     * `runSync`'s closure, so the channel is taken from our own `syncRequest`
     * (never the peer's echo) and the previous channel-binding check is moot.
     * Any failure fails the spectate sync via `failSync`, which returns a
     * distinguishable {ok:false, reason} instead of colliding with success.
     */
    public async applySyncResponse(
        peerAddress: string,
        syncRequest: SyncRequest,
        encodedSyncPayload: Bytes,
        opts: { resumeMode: boolean; timeoutMs: number }
    ): Promise<SyncOutcome> {
        const channelId = syncRequest.channelId;

        // A malicious/broken peer can return bytes that aren't a valid
        // Codec.encode(SyncPayload). Decoded in its own try/catch (not the big
        // one below) because that's unambiguously the peer's fault - no
        // legitimate on-chain race explains undecodable bytes, unlike the
        // chain-view-/local-state-dependent reasons below - so `failSync`
        // punishes it (malformed-payload is peer-provable) even in resume
        // mode.
        let syncPayload: SyncPayload;
        try {
            syncPayload = Codec.decode(encodedSyncPayload, Type.SyncPayload);
        } catch (e) {
            this.logger.warn("applySyncResponse - malformed sync payload", {
                peerAddress,
                error: e instanceof Error ? e.message : String(e)
            });
            return this.failSync(
                peerAddress,
                "malformed-payload",
                opts.resumeMode
            );
        }
        this.logger.debug(`Sync payload received`, { syncPayload });

        try {
            const localTime = Clock.getTimeInSeconds();
            const rtt = localTime - syncRequest.initTime;

            this.logger.debug(
                `applySyncResponse - RTT: ${rtt}s, initTime: ${syncRequest.initTime}, responseTime: ${localTime}`
            );

            // If RTT is too high, abort. Resume mode is bounded by the
            // resume attempt's own timeout, not the (unrelated, and often
            // longer) agreement-time config - FO3.
            const rttLimitSeconds = opts.resumeMode
                ? opts.timeoutMs / 1000
                : this.p2pManager.stateManager.timeConfig.agreementTime;
            if (rtt > rttLimitSeconds) {
                this.logger.debug(
                    `applySyncResponse - RTT too high (${rtt}s), aborting`
                );
                return this.failSync(
                    peerAddress,
                    "rtt-exceeded",
                    opts.resumeMode
                );
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
                await this.fetchAndPersistOnChainSnapshot(channelId);
            let finalForkId = onChainSnapshot.forkID;

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
                const { windowExists, isExpired } =
                    await diamondStateMachine.localDiamondContract.isKillPeriodExpired(
                        channelId,
                        dw.forkId
                    );
                if (!windowExists || !isExpired)
                    return this.failSync(
                        peerAddress,
                        "chain-view-mismatch",
                        opts.resumeMode
                    );

                // 2.3) reduce them if they're not already reduced
                const isReducedAndFinal =
                    await diamondStateMachine.localDiamondContract.isReduceChallengePeriodExpired(
                        channelId,
                        dw.forkId
                    );
                if (!isReducedAndFinal) {
                    disputeWindowsThatNeedToBeReducedOnChain.push(dw);
                    // A2: peer-supplied dispute bytes may not decode. Own
                    // try/catch (not the outer one) - undecodable bytes are
                    // unambiguously the peer's fault, unlike the surrounding
                    // chain-view-dependent checks.
                    let decodedDisputes;
                    try {
                        decodedDisputes = dw.disputeConfirmations.map(
                            (disputeConfirmation) =>
                                Codec.decode(
                                    disputeConfirmation.signedDispute
                                        .encodedDispute,
                                    Type.Dispute
                                )
                        );
                    } catch (e) {
                        this.logger.warn(
                            "applySyncResponse - malformed dispute payload in reduction window",
                            {
                                peerAddress,
                                error:
                                    e instanceof Error ? e.message : String(e)
                            }
                        );
                        return this.failSync(
                            peerAddress,
                            "malformed-payload",
                            opts.resumeMode
                        );
                    }
                    await diamondStateMachine.localDiamondContract.reduceAndFinalize(
                        decodedDisputes,
                        dw.latestStateSnapshot,
                        dw.latestEncodedStateMachineState,
                        dw.inboundMessageBlocksAppliedInReduce,
                        dw.reducedForkId
                    );
                    // 2.4) ** If more than 1  has to be reduced -> abort **
                    if (++notReducedCount > 1)
                        return this.failSync(
                            peerAddress,
                            "chain-view-mismatch",
                            opts.resumeMode
                        );
                }

                // 2.5) verify that they reduce to the correct forks as given in the SyncPayload
                const _dw = (
                    await diamondStateMachine.localDiamondContract.getDisputeWindows(
                        channelId,
                        [dw.forkId]
                    )
                )[0];
                if (_dw.reducedResult.forkId != dw.reducedForkId)
                    return this.failSync(
                        peerAddress,
                        "chain-view-mismatch",
                        opts.resumeMode
                    );
                // if the above call fails -> local evm will throw -> catch and abort
                finalForkId = dw.reducedForkId;
            }

            // 2.6) verify final genesisSnapshot is correct -> abort otherwise
            // Three checks: forkId resolves to this snapshot, forkId == keccak256(snapshotData)
            // and encoded state matches the declared hash.
            // Row F split: the fork-match conjunct is chain-view-dependent
            // (finalForkId is derived from onChainSnapshot and possibly
            // advanced through the dispute-window reduction loop above), so
            // it's evaluated - and classified - separately from the
            // genesis-validity/state-hash conjuncts, which are decidable
            // purely from the payload.
            const finalForkIdMatchesGenesisForkId =
                finalForkId === syncPayload.latestForkGenesisSnapshot.forkId;
            if (!finalForkIdMatchesGenesisForkId)
                return this.failSync(
                    peerAddress,
                    "chain-view-mismatch",
                    opts.resumeMode
                );

            const isGenesisValid =
                await diamondStateMachine.localDiamondContract.isGenesisSnapshotWithoutTimeCheck(
                    syncPayload.latestForkGenesisSnapshot
                );
            const stateHashMatch =
                syncPayload.latestForkGenesisSnapshot.snapshotData
                    .stateMachineStateHash ===
                hash(syncPayload.latestForkGenesisEncodedState);
            if (!(isGenesisValid && stateHashMatch))
                return this.failSync(
                    peerAddress,
                    "invalid-proof",
                    opts.resumeMode
                );

            // optimization: if the on-chain snapshot is on the same fork but more advanced than what
            // peers proved, reject before running any contract verification.
            const latestFinalizedSnapshot =
                syncPayload.milestoneSnapshots.length > 0
                    ? syncPayload.milestoneSnapshots.at(-1)!
                    : syncPayload.latestForkGenesisSnapshot;
            if (
                onChainSnapshot.forkID ===
                    syncPayload.latestForkGenesisSnapshot.forkId &&
                onChainSnapshot.blockHeight >
                    Number(latestFinalizedSnapshot.blockHeight)
            ) {
                this.logger.debug(
                    `applySyncResponse - on-chain block height (${onChainSnapshot.blockHeight}) exceeds proved height (${Number(latestFinalizedSnapshot.blockHeight)}); aborting`
                );
                return this.failSync(
                    peerAddress,
                    "chain-view-mismatch",
                    opts.resumeMode
                );
            }

            // 2.7) verify outboundMessageBlocks from onChainSnapshot (lower/older) to final genesisSnapshot (upper/newer)
            const genesisSnapshot = StateSnapshot.from(
                syncPayload.latestForkGenesisSnapshot
            );
            const { lowerOutboundSnapshot, upperOutboundSnapshot } =
                SpectateService.orderOutboundSnapshots(
                    onChainSnapshot,
                    genesisSnapshot
                );

            let areValidExitBlocks =
                await diamondStateMachine.localDiamondContract.verifyOutboundMessageBlocks(
                    syncPayload.outboundMessageBlocksUpToLatestGenesis,
                    lowerOutboundSnapshot.toStruct().snapshotData,
                    upperOutboundSnapshot.toStruct().snapshotData
                );

            if (!areValidExitBlocks)
                return this.failSync(
                    peerAddress,
                    "chain-view-mismatch",
                    opts.resumeMode
                );

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
                    return this.failSync(
                        peerAddress,
                        "chain-view-mismatch",
                        opts.resumeMode
                    );
            } else {
                // 2.8.2) (requested)
                if (finalForkId != syncRequest.forkId)
                    return this.failSync(
                        peerAddress,
                        "invalid-proof",
                        opts.resumeMode
                    );
            }

            // 2.9) verify stateProof proves latest state -> abort otherwise
            const isValid =
                await diamondStateMachine.localDiamondContract.verifyMilestones.staticCall(
                    syncPayload.latestForkGenesisSnapshot.forkId,
                    syncPayload.stateProof.milestones,
                    syncPayload.milestoneSnapshots,
                    syncPayload.latestForkGenesisSnapshot
                );
            if (!isValid)
                return this.failSync(
                    peerAddress,
                    "chain-view-mismatch",
                    opts.resumeMode
                );

            if (
                latestFinalizedSnapshot.snapshotData.stateMachineStateHash !=
                hash(syncPayload.latestFinalizedEncodedState)
            )
                return this.failSync(
                    peerAddress,
                    "invalid-proof",
                    opts.resumeMode
                );

            // 2.10) verify outboundMessageBlocks from final genesisSnapshot to latestFinalizedSnapshot
            areValidExitBlocks =
                await diamondStateMachine.localDiamondContract.verifyOutboundMessageBlocks(
                    syncPayload.outboundMessageBlocksOfTheLatestFork,
                    syncPayload.latestForkGenesisSnapshot.snapshotData,
                    latestFinalizedSnapshot.snapshotData
                );
            if (!areValidExitBlocks)
                return this.failSync(
                    peerAddress,
                    "invalid-proof",
                    opts.resumeMode
                );

            // 2.11) verify balance invariant of the latestFinalizedState -> abort otherwise
            const isValidBalance =
                await stateManager.stateChannelManagerContract.verifyBalanceInvariantCheckSnapshot.staticCall(
                    channelId,
                    latestFinalizedSnapshot.snapshotData,
                    syncPayload.latestFinalizedEncodedState
                );
            if (!isValidBalance)
                return this.failSync(
                    peerAddress,
                    "chain-view-mismatch",
                    opts.resumeMode
                );

            // 3) Finally - staticcall multicall to deduct failure/success -> on failure abort
            const multicallResult = await this.tryMulticallSnapshotUpdate(
                channelId,
                onChainSnapshot.toStruct(),
                syncPayload,
                disputeWindowsThatNeedToBeReducedOnChain
            );
            if (!multicallResult.ok)
                return this.failSync(
                    peerAddress,
                    multicallResult.reason,
                    opts.resumeMode
                );

            // 4) Deconstruct the SyncPayload and persist its component normally in our local 'storage'
            const persistResult = await this.persistSyncPayload(syncPayload);
            if (persistResult.outcome === "conflict")
                return this.failSync(
                    peerAddress,
                    "storage-conflict",
                    opts.resumeMode
                );
            if (persistResult.outcome === "incomplete")
                return this.failSync(
                    peerAddress,
                    "internal-error",
                    opts.resumeMode
                );
            const localWasAhead = persistResult.outcome === "already-current";

            // 5) Start executing the onBlockConfirmation pipeline with unfinalized blocks
            const blockConfirmations =
                await diamondStateMachine.localDiamondContract.getUnfinalizedBlockConfirmationsFromStateProof(
                    syncPayload.stateProof
                );
            this.logger.debug(
                `Spectate sync - next block height before pipeline ${stateManager.storage.blocks.getNextBlockHeight(finalForkId)}`
            );
            this.logger.debug(
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
                try {
                    const isOk =
                        await stateManager.onBlockConfirmationStruct(bc);
                    if (!isOk)
                        return this.failSync(
                            peerAddress,
                            "pipeline-rejected",
                            opts.resumeMode
                        );
                } catch (e) {
                    this.logger.error(
                        `Error processing block confirmation during spectate sync`,
                        { error: e }
                    );
                    return this.failSync(
                        peerAddress,
                        "pipeline-rejected",
                        opts.resumeMode
                    );
                }
            }
            this.logger.debug(
                `Spectate sync - next block height after pipeline ${stateManager.storage.blocks.getNextBlockHeight(finalForkId)}`
            );
            // 6) If state requested (forkId,blockHeight) - check if blockHeight reached
            if (syncRequest.blockHeight !== undefined) {
                const [hasBlock, latestBlock] =
                    await diamondStateMachine.localDiamondContract.getLatestBlockFromStateProof(
                        syncPayload.stateProof
                    );
                if (!hasBlock)
                    return this.failSync(
                        peerAddress,
                        "invalid-proof",
                        opts.resumeMode
                    );
                if (
                    Number(latestBlock.transaction.header.transactionCnt) !=
                    syncRequest.blockHeight
                )
                    return this.failSync(
                        peerAddress,
                        "invalid-proof",
                        opts.resumeMode
                    );
            }
            this.logger.debug(
                "Spectator successfully synced to latest proven state"
            );

            const confirmedHeight =
                stateManager.storage.blocks.getNextBlockHeight(finalForkId) - 1;
            return {
                ok: true,
                confirmedForkId: finalForkId,
                confirmedHeight,
                localWasAhead
            };
        } catch (e) {
            this.logger.warn(e);
            return this.failSync(
                peerAddress,
                "internal-error",
                opts.resumeMode
            );
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

        // Get the current fork ID
        const forkId = _forkId ?? stateManager.forkId;

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
            const computation =
                await stateManager.reductionManager.computeReductionLocally(
                    currentForkId,
                    currentWindowDisputesHashes
                );
            const { reduceData, reducedForkId } = computation;

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
                await diamondStateMachine.localDiamondContract.isForkDisputed(
                    channelId,
                    currentForkId
                );
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

        const { lowerOutboundSnapshot, upperOutboundSnapshot } =
            SpectateService.orderOutboundSnapshots(
                currentOnChainSnapshot,
                latestForkGenesisSnapshot
            );

        const outboundMessageBlocksUpToLatestGenesis =
            stateManager.storage.outboundMessages.getMessageBlocksInRange({
                upperBlockHash:
                    upperOutboundSnapshot.latestOutboundMessageBlockHash,
                lowerBlockHash:
                    lowerOutboundSnapshot.latestOutboundMessageBlockHash
            });

        const latestBlockHeight =
            stateManager.storage.blocks.getNextBlockHeight(forkId) - 1;

        // An above-latest target is unprovable - and must NOT be silently
        // downgraded to a proof for `latestBlockHeight` (that would forge a
        // valid-looking proof for a different height). Return undefined so the
        // caller cuts the requester; we don't serve a different height.
        if (_blockHeight !== undefined && _blockHeight > latestBlockHeight) {
            return undefined;
        }

        // There are blocks, so we can do a same-fork update.
        // `??` not `||`: a requested height of 0 is valid and must be pinned,
        // not fall through to the latest block.
        const targetBlockHeight = _blockHeight ?? latestBlockHeight;
        const latestStateProof = await agreementManager.tryGetStateProof(
            forkId,
            targetBlockHeight
        );

        if (!latestStateProof) {
            this.logger.debug(
                `No state proof found for fork ${forkId} blockHeight ${targetBlockHeight}`
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
    }

    public async tryMulticallSnapshotUpdate(
        channelId: ChannelId,
        onChainSnapshot: StateSnapshotStruct,
        syncPayload: SyncPayload,
        disputeWindowsThatNeedToBeReducedOnChain: DisputeWindowVerification[]
    ): Promise<
        | { ok: true }
        | { ok: false; reason: "malformed-payload" | "chain-view-mismatch" }
    > {
        const stateManager = this.p2pManager.stateManager;
        const stateChannelManagerContract =
            stateManager.stateChannelManagerContract;
        const contractInterface =
            stateChannelManagerContract.interface as ethers.Interface;
        // Encode data for multicall
        const calldata: string[] = [];
        for (const dw of disputeWindowsThatNeedToBeReducedOnChain) {
            // A3: same peer-supplied-bytes concern as the reduction loop in
            // applySyncResponse - own try/catch, malformed-payload on failure.
            let disputes;
            try {
                disputes = dw.disputeConfirmations.map((disputeConfirmation) =>
                    Codec.decode(
                        disputeConfirmation.signedDispute.encodedDispute,
                        Type.Dispute
                    )
                );
            } catch (e) {
                this.logger.warn(
                    "tryMulticallSnapshotUpdate - malformed dispute payload",
                    { error: e instanceof Error ? e.message : String(e) }
                );
                return { ok: false, reason: "malformed-payload" };
            }
            const reduceCalldata =
                stateManager.reductionManager.buildReduceAndFinalizeCalldata(
                    disputes,
                    dw.latestStateSnapshot,
                    dw.latestEncodedStateMachineState,
                    dw.inboundMessageBlocksAppliedInReduce,
                    dw.reducedForkId
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
            const lowerHash =
                onChainSnapshot.snapshotData.latestOutboundMessageBlockHash;

            const outboundBlocksForSameFork =
                await stateManager.diamondStateMachine.localDiamondContract.pruneOutboundMessageBlocks(
                    syncPayload.outboundMessageBlocksOfTheLatestFork,
                    lowerHash
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
                return { ok: false, reason: "chain-view-mismatch" };
            }
        }
        return { ok: true };
    }

    public async persistSyncPayload(
        syncPayload: SyncPayload
    ): Promise<PersistSyncResult> {
        const stateManager = this.p2pManager.stateManager;
        return await stateManager.withMutex(
            async () => {
                this.logger.debug(`Persisting sync payload`, syncPayload);
                const storage = stateManager.storage;

                const latestFinalizedSnapshot =
                    syncPayload.milestoneSnapshots.length > 0
                        ? syncPayload.milestoneSnapshots.at(-1)!
                        : syncPayload.latestForkGenesisSnapshot;

                const finalizedForkId = latestFinalizedSnapshot.forkId;
                const finalizedHeight = Number(
                    latestFinalizedSnapshot.blockHeight
                );
                const localLatestBlock =
                    storage.blocks.getLatestBlock(finalizedForkId);
                const localLatestHeight = localLatestBlock?.height ?? -1;

                // "already-current" requires BOTH a block-height check AND
                // proof that ACTIVE state was actually restored. Stored
                // block rows alone are NOT proof: a prior attempt can have
                // written blocks up to (or past) the target height and then
                // thrown out of unsafeSetLatestState, leaving active state
                // stale. The active-state-hash match (with matching fork) is
                // the only path to "already-current" - height-alone must
                // fall through and redo the writes.
                if (localLatestHeight >= finalizedHeight) {
                    const activeForkMatches =
                        stateManager.forkId === finalizedForkId;
                    const activeStateHash = activeForkMatches
                        ? await stateManager.getActiveStateHash()
                        : undefined;
                    const activeStateMatches =
                        activeForkMatches &&
                        activeStateHash ===
                            latestFinalizedSnapshot.snapshotData
                                .stateMachineStateHash;

                    if (activeStateMatches) {
                        this.logger.info(
                            "Skipping sync payload persistence: active state already proves the latest finalized snapshot",
                            {
                                finalizedForkId,
                                finalizedHeight,
                                localLatestHeight
                            }
                        );
                        return { outcome: "already-current" };
                    }

                    this.logger.info(
                        "Local block rows are at/past target height, but active state does not prove it (prior partial write?) - redoing sync payload persistence",
                        {
                            finalizedForkId,
                            finalizedHeight,
                            localLatestHeight
                        }
                    );
                }

                const finalizedBlocks = this.getFinalizedBlocksFromStateProof(
                    syncPayload.stateProof
                );
                if (this.hasAnyBlockConflict(finalizedBlocks)) {
                    return { outcome: "conflict" };
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
                this.persistFinalizedBlocks(finalizedBlocks);
                for (const snapshot of syncPayload.milestoneSnapshots)
                    storage.stateSnapshots.storeStateSnapshot(
                        StateSnapshot.from(snapshot)
                    );
                for (const omb of syncPayload.outboundMessageBlocksUpToLatestGenesis)
                    storage.outboundMessages.store(omb);
                for (const omb of syncPayload.outboundMessageBlocksOfTheLatestFork)
                    storage.outboundMessages.store(omb);

                // All the writes above are content-hash-keyed puts, so
                // they're idempotent on replay - if unsafeSetLatestState
                // throws here (e.g. after a partial write), a retry of this
                // same payload safely redoes them rather than corrupting
                // anything. This is a local storage/state-machine fault, not
                // peer fraud - it must be reported distinctly ("incomplete")
                // rather than propagating to applySyncResponse's outer catch
                // (which would misclassify it as an internal-error via a
                // path shared with peer-fraud reasons) or surfacing as
                // invalid-proof/malformed-payload.
                try {
                    await stateManager.unsafeSetLatestState(
                        latestFinalizedSnapshot,
                        syncPayload.latestFinalizedEncodedState
                    );
                } catch (error) {
                    this.logger.error(
                        "persistSyncPayload - unsafeSetLatestState failed after partial writes; local storage/state-machine fault, not peer fraud",
                        {
                            finalizedForkId,
                            finalizedHeight,
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error)
                        }
                    );
                    return { outcome: "incomplete", error };
                }
                this.logger.debug(`Finished persisting sync payload`);
                return { outcome: "applied" };
            },
            { taskName: "persistSyncPayload" }
        );
    }

    private getFinalizedBlocksFromStateProof(
        stateProof: StateProofStruct
    ): Block[] {
        const finalizedBlocks: Block[] = [];
        // for all milestones except the last persist all blocks
        for (let i = 0; i < stateProof.milestones.length - 1; i++) {
            for (const blockConfirmation of stateProof.milestones[i]
                .blockConfirmations) {
                const block = Block.fromBlockConfirmation(blockConfirmation);
                finalizedBlocks.push(block);
            }
        }
        // for the last milestone persist just the first (finalized) block
        const lastMilestone = stateProof.milestones.at(-1);
        const finalizedBlockConfirmation = lastMilestone?.blockConfirmations[0];
        if (finalizedBlockConfirmation) {
            const block = Block.fromBlockConfirmation(
                finalizedBlockConfirmation
            );
            finalizedBlocks.push(block);
        }
        return finalizedBlocks;
    }

    private hasAnyBlockConflict(blocks: Block[]): boolean {
        return blocks.some((block) => this.hasBlockConflict(block));
    }

    private persistFinalizedBlocks(blocks: Block[]): void {
        const storage = this.p2pManager.stateManager.storage;
        for (const block of blocks) storage.blocks.storeBlock(block);
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

    /**
     * Fail (and log) a spectate sync, returning the distinguishable outcome
     * `failSync`'s callers should propagate.
     *
     * Punishment asymmetry is not symmetric in cost. False positive
     * (blacklisting an honest peer during resume): the client burns
     * candidates from an already-tiny set (MAX_RESUME_SYNC_PEERS=3), can end
     * up unable to resync at all, and is pushed toward the on-chain dispute
     * path with stale local state - a funds-adjacent liveness failure and a
     * self-inflicted eclipse. False negative (a Byzantine peer serving
     * garbage stays connected): one wasted attempt slot, bounded by the
     * attempt cap and deadline - the peer is still cut from that attempt.
     * Therefore: punish only on peer-provable fraud - a contradiction
     * decidable from the payload itself plus data whose truth we establish
     * independently (cryptographic hashes, our own request, contract calls
     * whose inputs AND body touch only payload-supplied data) - and which no
     * honest peer could produce through a race or a stale view. Anything
     * time-, chain-view-, or local-state-dependent is ambiguous and never
     * punished on the resume path.
     *
     * Operational test: does this check consume any input we fetched
     * ourselves, or does its contract body read live chain storage? If yes ->
     * ambiguous, regardless of how "cryptographic" it looks. A staticcall is
     * not evidence of fraud if its result depends on when you called it.
     *
     * Non-resume mode is unchanged: every failure still routes through
     * `abort()`, which blacklists/aborts via the existing
     * PARTICIPATING/PENDING_PARTICIPANT branch. Resume mode never calls
     * `abort()` - a peer-provable reason disconnects+blacklists directly; an
     * ambiguous reason is only logged, so a resuming client's already-scarce
     * peer set survives an honest peer's stale chain view.
     */
    private failSync(
        peerAddress: string,
        reason: SyncFailReason,
        resumeMode: boolean
    ): SyncOutcome {
        // A reactive (resumeMode:false) sync firing while a resume window is
        // open (see `enterResumeWindow`/`exitResumeWindow`) must be held to
        // the same non-destructive policy as a resume-mode failure - local
        // state may be mid-restore, and this is the path that can never be
        // allowed to hard-abort the state manager while that's happening.
        if (resumeMode || this.resumeWindowDepth > 0) {
            if (PEER_PROVABLE_REASONS.has(reason)) {
                this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
                    peerAddress
                );
            } else {
                this.logger.warn(
                    "applySyncResponse - suppressing punishment for ambiguous resume-sync failure",
                    { peerAddress, reason }
                );
            }
            return { ok: false, reason };
        }
        this.abort(peerAddress);
        return { ok: false, reason };
    }

    /**
     * Opens (or re-enters) the resume window: while depth > 0, ambiguous
     * spectate-sync failures - including from a reactive (resumeMode:false)
     * sync racing a resume's transport rejoin - are held to resume's
     * non-destructive failure policy (warn, never blacklist, never
     * `abort()`) instead of the destructive non-resume policy. Depth-based
     * so nested/overlapping resumes can't have the first one's exit reopen
     * destructive policy while a second is still active. Callers must pair
     * every call with `exitResumeWindow()`, typically in a `finally`.
     */
    public enterResumeWindow(): void {
        this.resumeWindowDepth++;
    }

    /**
     * Closes (or un-nests) the resume window opened by `enterResumeWindow`.
     * Never decrements below 0.
     */
    public exitResumeWindow(): void {
        if (this.resumeWindowDepth > 0) {
            this.resumeWindowDepth--;
        }
    }

    /**
     * True if a sync is currently in flight for `peerAddress` (fire-and-forget
     * `sync()` or an awaitable `syncAwaitable()` that hasn't settled yet).
     */
    public isSyncInFlight(peerAddress: Address): boolean {
        const normalizedPeerAddress = getChecksumAddress(peerAddress);
        return this.inFlightByPeerAddress.has(normalizedPeerAddress);
    }

    public abort(peerAddress: string) {
        // HandshakeCompletedGuard guarantees stable peer identity.
        // If we're not actively participating, treat this as a fatal sync failure.
        this.logger.warn(`Aborting spectate sync with peer ${peerAddress}`, {
            peerAddress,
            myStatus: Status[this.p2pManager.stateManager.getStatus()]
        });

        const status = this.p2pManager.stateManager.getStatus();
        if (
            status !== Status.PARTICIPATING &&
            status !== Status.PENDING_PARTICIPANT
        ) {
            this.p2pManager.stateManager.abort();
            return;
        }

        // If participating, punish only the offending peer.
        return this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
            peerAddress
        );
    }
}

export default SpectateService;
